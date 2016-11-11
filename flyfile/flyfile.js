
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
      handleRequest(event.request, event);
    };

  }).catch(function (error) {
    LOG("Faile to publish server: " + error);
  });
}

function handleRequest(req, event) {
  // only allow GET and HEAD methods
  if (req.method != "GET" && req.method != "HEAD") {
    event.respondWith(new Response("501 Not Implemented", {
      "status": 501,
      "statusText": "Not Implemented",
    }));
    return;
  }

  LOG("Got fetch request for " + req.url);

  if (req.url == "/") {
    fetch("./client/index.html").then(function (response) {
      event.respondWith(response);
    });

  } else if (req.url == "/files") {
    var files = get_shared_files();
    var respObj = {files: []};
    for (var id = 0; id < files.length; id++) {
      var file = files[id];
      respObj.files.push({name:file.name, size:file.size, id:id})
    }
    var headers = new Headers({'Content-Type': 'application/json'});
    event.respondWith(new Response(JSON.stringify(respObj),
                                   {"headers": headers}));

  } else if (req.url.startsWith("/file/")) {
    var id = Number.parseInt(req.url.split("/")[2]);
    var files = get_shared_files();
    if (id >= 0 && id < files.length) {
      var file = files[id];
      var type = file.type || "binary/octet-stream";
      var headers = new Headers({
        'Content-Type': type,
        'Content-Disposition': "inline; filename*=UTF-8''" +
                               encodeRFC5987ValueChars(file.name),
      });
      LOG("Sending file " + file.name);
      event.respondWith(new Response(file, {"headers": headers}));
    } else {
      LOG("Requested file index out of bounds");
      event.respondWith(new Response("404 Not Found!", {
        "status": 404,
        "statusText": "Not Found",
      }));
    }

  } else {
    fetch("./client/" + req.url).then(function (response) {
      event.respondWith(response);
    }).catch(function (error) {
      LOG(error.message);
      event.respondWith(new Response("404 Not Found!", {
        "status": 404,
        "statusText": "Not Found",
      }));
    });
  }
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
