var util = require('util');
var stream = require('stream');

module.exports = function (PG, handleCallback) {
  PG.prototype.copyFromStream = function (command, params, callback) {
    if (arguments.length === 2) {
      callback = params;
      params = null;
    }

    var pq = this.pq;
    var readMore = null;
    var ready = false;
    var waitingChunk;

    var fromStream = stream.Writable();
    fromStream._write = function (chunk, enc, next) {
      if (typeof ready !== 'boolean') {
        next(ready);
        return;
      }
      readMore = next;
      waitingChunk = chunk.toString();
      ready && sendWaiting();
    };
    callback = handleCallback(this, callback);

    fromStream.on('finish', function () {
      if (ready)
        try {
          pq.putCopyEnd(null, callback);
        } catch(ex) {
          callback(ex);
        }
      else
        ready = 'finish';
    });
    try {
      pq.copyFromStream(command, params, readyCallback);
    } catch(ex) {
      callback(ex);
    }
    return fromStream;

    function fetchMore(err) {
      if (! readMore) return;
      var next = readMore;
      readMore = null;
      next(err);
    }

    function sendWaiting() {
      var chunk = waitingChunk;
      ready = false;
      waitingChunk = null;
      try {
        pq.putCopyData(chunk, readyCallback);
      } catch(ex) {
        callback(ex);
      }
      fetchMore();
    }

    function readyCallback(err) {
      if (err) {
        callback(err);
        fetchMore(err);
      } else if (ready === 'finish') {
        try{
          pq.putCopyEnd(null, callback);
        } catch(ex) {
          callback(ex);
        }
      } else if (waitingChunk){
        sendWaiting();
      } else {
        ready = true;
        fetchMore();
      }
    }

    return fromStream;
  };
}
