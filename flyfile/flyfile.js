/* jshint esnext: true, moz: true, globalstrict: true */

"use strict";

const HTTP_STATUS_TEXT = {
  200: "OK",
  206: "Partial Content",
  404: "Not Found",
  416: "Requested Range Not Satisfiable",
  500: "Internal Server Error",
  501: "Not Implemented",
};

class HTTPError extends Error {
  constructor(message, resp) {
    super(message);
    this.name = "HTTPError";
    this.message = message;
    resp = resp || {};
    let status = resp.status || 500;
    this.resp = new Response(resp.body, {
      status: status,
      statusText: resp.statusText || HTTP_STATUS_TEXT[status],
      headers: resp.headers,
    });
  }
}

function LOG() {
  var text_array = [];
  for (var i = 0; i < arguments.length; i++) {
    text_array.push("" + arguments[i]);
  }
  var text = text_array.join('');
  var lines = text.split("\n");

  var log_div = document.getElementById('log');
  var logentry_div = document.createElement('div');
  logentry_div.setAttribute('class', 'logentry');
  lines.forEach(function (line) {
    var logentry_text = document.createTextNode(line);
    var br = document.createElement('br');
    logentry_div.appendChild(logentry_text);
    logentry_div.appendChild(br);
  });
  if (log_div.children.length === 0) {
    log_div.appendChild(logentry_div);
  } else {
    log_div.insertBefore(logentry_div, log_div.children[0]);
  }
}

function get_share_name() {
  return document.getElementById('sharename').value;
}
function get_shared_files() {
  return document.getElementById('sharedfiles').files;
}

function main() {
  LOG("Loaded.");
}

function fileChanged() {
  LOG("File changed.");
}

function share() {
  if (get_shared_files().length === 0) {
    LOG("Select one or more files to share!");
    return;
  }

  var share_name = get_share_name();
  if (share_name.length === 0) {
    LOG("Share name not given!");
    return;
  }

  LOG("Share name: " + share_name);
  navigator.publishServer(share_name).then(function (server) {
    // Attach handlers to the
    LOG("Published server.");
    server.onfetch = function (event) {
      handleRequest(event.request).then(resp => {
        event.respondWith(resp);
      }).catch(error => {
        LOG(error.message);
        console.log(error);
        event.respondWith(error.resp);
      });
    };

  }).catch(function (error) {
    LOG("Faile to publish server: " + error);
  });
}

function handleRequest(req) {
  // only allow GET and HEAD methods
  if (req.method != "GET" && req.method != "HEAD") {
    return Promise.reject(new HTTPError(`${req.method} method not implemented`, {
      status: 501,
      body: "501 Not Implemented",
    }));
  }

  LOG("Got fetch request for " + req.url);

  if (req.url == "/files") {
    return listFiles();
  } else if (req.url.startsWith("/file/")) {
    return serveFileDownload(req);
  } else {
    return serveStaticFile(req.url == "/" ? "/index.html" : req.url);
  }
}

function serveStaticFile (file) {
  return new Promise((resolve, reject) => {
    fetch("./client" + file).then(function (resp) {
      resolve(resp);
    }).catch(function (error) {
      reject(new HTTPError(error.message, {
        status: 404,
        body: "404 Not Found",
      }));
    });
  });
}

function listFiles () {
  var files = get_shared_files();
  var respObj = {files: []};
  for (var id = 0; id < files.length; id++) {
    var file = files[id];
    respObj.files.push({name:file.name, size:file.size, id:id});
  }
  var headers = new Headers({'Content-Type': 'application/json'});
  return Promise.resolve(new Response(JSON.stringify(respObj), {
    headers: headers,
  }));
}

function serveFileDownload (req) {
  const id = Number.parseInt(req.url.split("/")[2]);
  const files = get_shared_files();

  if (id < 0 || id >= files.length) {
    return Promise.reject(new HTTPError(`Requested file index out of bounds: ${id}`, {
      status: 404,
      body: "404 Not Found",
    }));
  }

  let headers = {};
  let msg = [];
  const file = files[id];
  const type = file.type || "binary/octet-stream";

  headers["Content-Type"] = type;
  headers["Content-Disposition"] = `inline; filename*=UTF-8''${encodeRFC5987ValueChars(file.name)}`;
  headers["Accept-Ranges"] = "bytes";

  msg.push(`Sending file ${file.name}`);

  if (!req.headers.has("range")) {
    return Promise.resolve(new Response(file, {headers: headers}));
  }

  const filesize = file.size;
  const range = parseRangeHeader(req.headers.get("range"), filesize);
  let status = range.status;
  let body;

  if (status == 200) {
    body = file;
  } else if (status == 416) {
    msg.push("416 Requested Range Not Satisfiable");
    headers["Content-Range"] = `bytes */${filesize}`;
    body = "416 Requested Range Not Satisfiable";
  } else if (status == 206) {
    if (!range.multipart) {
      let satisfiable = range.satisfiable[0];
      msg.push(`range: ${satisfiable.map(prettyPrintSize).join("-")}`);
      headers["Content-Range"] = `bytes ${satisfiable.join("-")}/${filesize}`;
      body = file.slice(satisfiable[0], satisfiable[1] + 1);
    } else {
      let satisfiable = range.satisfiable;
      const boundary = Date.now();
      msg.push(`multipart/byteranges: ${satisfiable.
        map(e => e.map(prettyPrintSize).join("-")).
        join(",")}`);
      headers["Content-Type"] = `multipart/byteranges; boundary=${boundary}`;
      let parts = [];
      satisfiable.forEach(e => {
        parts.push(`\r\n--${boundary}\r\n` +
                   `Content-type: ${type}\r\n` +
                   `Content-range: bytes ${e.join("-")}/${filesize}\r\n\r\n`);
        parts.push(file.slice(e[0], e[1] + 1));
      });
      parts.push(`\r\n--${boundary}--\r\n`);
      body = new Blob(parts);
    }
  } else {
    status = 500;
    body = "500 Internal Server Error";
    headers = {};
  }

  LOG(msg.join(", "));
  return Promise.resolve(new Response(body, {
    status: status,
    statusText: HTTP_STATUS_TEXT[status],
    headers: headers,
  }));
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent
function encodeRFC5987ValueChars (str) {
  return encodeURIComponent(str).
    // Note that although RFC3986 reserves "!", RFC5987 does not,
    // so we do not need to escape it
    replace(/['()]/g, escape). // i.e., %27 %28 %29
    replace(/\*/g, '%2A').
    // The following are not required for percent-encoding per RFC5987,
    // so we can allow for a little better readability over the wire: |`^
    replace(/%(?:7C|60|5E)/g, unescape);
}

// RFC 7233
function parseRangeHeader (range, filesize) {
  // An origin server MUST ignore a Range header field that contains a range
  // unit it does not understand.
  if (!range.startsWith("bytes=")) {
    return {
      "status": 200,
    };
  }

  var ranges = [];

  for (var r of range.slice(6).split(",")) {
    if (!/^\s*(\d+-\d*|-\d+)\s*$/.test(r)) {
      // not valid byte-range-spec or suffix-byte-range-spec
      // ignore whole range header
      return {
        "status": 200,
      };
    }

    r = r.trim().split("-");

    if (r[0] === "") {
      // suffix-byte-range-spec
      // -xxx
      // last xxx bytes
      r[0] = filesize - Number.parseInt(r[1]);
      r[1] = filesize - 1;
    } else {
      // byte-range-spec
      // xxx-xxx or xxx-
      r[0] = Number.parseInt(r[0]);
      r[1] = r[1] === "" ? filesize - 1 : Number.parseInt(r[1]);
    }
    if (r[0] < 0) {
      r[0] = 0;
    }
    if (r[1] >= filesize) {
      r[1] = filesize - 1;
    }
    ranges.push(r);
  }

  var satisfiable = findSatisfiableRanges(ranges);

  if (ranges.length === 0) {
    return {
      "status": 200,
    };
  } else if (satisfiable.length === 0) {
    return {
      "status": 416,
    };
  } else {
    return {
      "status": 206,
      "satisfiable": satisfiable,
      "multipart": ranges.length > 1,
    };
  }
}

function findSatisfiableRanges (ranges) {
  //  When multiple ranges are requested, a server MAY coalesce any of the
  //  ranges that overlap, or that are separated by a gap that is smaller
  //  than the overhead of sending multiple parts, regardless of the order
  //  in which the corresponding byte-range-spec appeared in the received
  //  Range header field.  Since the typical overhead between parts of a
  //  multipart/byteranges payload is around 80 bytes, depending on the
  //  selected representation's media type and the chosen boundary
  //  parameter length, it can be less efficient to transfer many small
  //  disjoint parts than it is to transfer the entire selected
  //  representation.
  //
  //  When a multipart response payload is generated, the server SHOULD
  //  send the parts in the same order that the corresponding
  //  byte-range-spec appeared in the received Range header field,
  //  excluding those ranges that were deemed unsatisfiable or that were
  //  coalesced into other ranges.
  return ranges.reduce(function (result, cur) {
    if (cur[0] > cur[1]) {
      return result;
    }

    if (result.length === 0) {
      return [cur];
    }

    var last = result.pop();
    // given a.start <= a.end and b.start <= b.end
    // a and b are overlapped, or separated by a small gap (e.g. 80 bytes)
    // if and only if !(a.end < b.start - 80 || b.end < a.start - 80)
    //   ->  a.end > b.start - 80 && a.start - 80 < b.end
    if (last[1] > cur[0] - 80 && last[0] - 80 < cur[1]) {
      return [...result, [Math.min(last[0], cur[0]), Math.max(last[1], cur[1])]];
    } else {
      return [...result, last, cur];
    }
  }, []);

  // XXX: todo
  //
  // 6.1.  Denial-of-Service Attacks Using Range
  //
  //   Unconstrained multiple range requests are susceptible to denial-of-
  //   service attacks because the effort required to request many
  //   overlapping ranges of the same data is tiny compared to the time,
  //   memory, and bandwidth consumed by attempting to serve the requested
  //   data in many parts.  Servers ought to ignore, coalesce, or reject
  //   egregious range requests, such as requests for more than two
  //   overlapping ranges or for many small ranges in a single set,
  //   particularly when the ranges are requested out of order for no
  //   apparent reason.  Multipart range requests are not designed to
  //   support random access.
}

// use _ as thousands separators to pretty print filesizes
// e.g. 1234567890 => 1_234_567_890
function prettyPrintSize (size) {
  return size.toLocaleString("en-US").replace(/,/g, "_");
}
