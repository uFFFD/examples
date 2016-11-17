"use strict";

class HTTPError extends Error {
  constructor(message, resp) {
    super(message);
    this.name = "HTTPError";
    this.message = message;
    resp = resp || {};
    this.resp = new Response(resp.body, {
      status: resp.status,
      statusText: resp.statusText,
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
  if (log_div.children.length == 0) {
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
  if (get_shared_files().length == 0) {
    LOG("Select one or more files to share!");
    return;
  }

  var share_name = get_share_name();
  if (share_name.length == 0) {
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
      statusText: "Not Implemented",
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
        statusText: "Not Found",
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
    respObj.files.push({name:file.name, size:file.size, id:id})
  }
  var headers = new Headers({'Content-Type': 'application/json'});
  return Promise.resolve(new Response(JSON.stringify(respObj), {
    headers: headers,
  }));
}

function serveFileDownload (req) {
  var id = Number.parseInt(req.url.split("/")[2]);
  var files = get_shared_files();
  var status;
  var statusText;
  var headers = new Headers();
  var body;
  var msg = [];

  if (id >= 0 && id < files.length) {
    var file = files[id];
    var filesize = file.size;
    var type = file.type || "binary/octet-stream";

    headers.set("Content-Type", type);
    headers.set("Content-Disposition",
                "inline; filename*=UTF-8''" +
                encodeRFC5987ValueChars(file.name));
    headers.set("Accept-Ranges", "bytes");

    msg.push("Sending file " + file.name);

    if (req.headers.has("range")) {
      var range = parseRangeHeader(req.headers.get("range"), filesize);
      status = range.status;
      statusText = range.statusText;

      if (status == 416) {
        msg.push("416 Requested Range Not Satisfiable");
        headers.set("Content-Range", "bytes */" + filesize);
        body = "416 Requested Range Not Satisfiable";
      } else if (status == 206) {
        if (range.multipart) {
          var satisfiable = range.satisfiable;
          var boundary = Date.now();
          msg.push("multipart/byteranges: " + satisfiable.map(function (el) {
            return el.map(prettyPrintSize).join("-");
          }).join(","));
          headers.set("Content-Type",
                      "multipart/byteranges; boundary=" + boundary);
          var CRLF = "\r\n";
          var parts = [];
          for (var el of satisfiable) {
            parts.push(CRLF + "--" + boundary + CRLF);
            parts.push("Content-type: " + type + CRLF);
            parts.push("Content-range: bytes " +
                       el.join("-") + "/" + filesize + CRLF);
            parts.push(CRLF);
            parts.push(file.slice(el[0], el[1] + 1));
          }
          parts.push(CRLF + "--" + boundary + "--" + CRLF);
          body = new Blob(parts);
        } else {
          var satisfiable = range.satisfiable[0];
          msg.push("range: " + satisfiable.map(prettyPrintSize).join("-"));
          headers.set("Content-Range",
                      "bytes " + satisfiable.join("-") + "/" + filesize);
          body = file.slice(satisfiable[0], satisfiable[1] + 1);
        }
      } else {
        body = file;
      }
    } else {
      status = 200;
      statusText = "OK";
      body = file;
    }
  } else {
    return Promise.reject(new HTTPError(`Requested file index out of bounds: ${id}`, {
      status: 404,
      statusText: "Not Found",
      body: "404 Not Found",
    }));
  }

  LOG(msg.join(", "));
  return Promise.resolve(new Response(body, {
    status: status,
    statusText: statusText,
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
      "statusText": "OK",
    };
  }

  var ranges = [];

  for (var r of range.slice(6).split(",")) {
    if (!/^\s*(\d+-\d*|-\d+)\s*$/.test(r)) {
      // not valid byte-range-spec or suffix-byte-range-spec
      // ignore whole range header
      return {
        "status": 200,
        "statusText": "OK",
      };
    }

    r = r.trim().split("-");

    if (r[0] == "") {
      // suffix-byte-range-spec
      // -xxx
      // last xxx bytes
      r[0] = filesize - Number.parseInt(r[1]);
      r[1] = filesize - 1;
    } else {
      // byte-range-spec
      // xxx-xxx or xxx-
      r[0] = Number.parseInt(r[0]);
      r[1] = r[1] == "" ? filesize - 1 : Number.parseInt(r[1]);
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

  if (ranges.length == 0) {
    return {
      "status": 200,
      "statusText": "OK",
    };
  } else if (satisfiable.length == 0) {
    return {
      "status": 416,
      "statusText": "Requested Range Not Satisfiable",
    };
  } else {
    return {
      "status": 206,
      "statusText": "Partial Content",
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

    if (result.length == 0) {
      return [cur];
    }

    var last = result.pop();
    // given a.start <= a.end and b.start <= b.end
    // a and b are overlapped, or separated by a small gap (e.g. 80 bytes)
    // if and only if !(a.end < b.start - 80 || b.end < a.start - 80)
    //   ->  a.end > b.start - 80 && a.start - 80 < b.end
    if (last[1] > cur[0] - 80 && last[0] - 80 < cur[1]) {
      return [...result, [Math.min(last[0], cur[0]), Math.max(last[1], cur[1])]]
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
