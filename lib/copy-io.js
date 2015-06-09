var util = require('util');
var stream = require('stream');
var ExecQ = require('./queue');

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
    ExecQ.queue(this, function qcopy(pgConn, qItem) {
      callback = handleCallback(qItem, callback);

      // fromStream.abort = function (error) {
      //   pq.putCopyEnd(error||'abort', callback);
      // };
      fromStream.on('finish', function () {
        if (ready)
          pq.putCopyEnd(null, callback);
        else
          ready = 'finish';
      });
      pq.copyFromStream(command, params, readyCallback);
      return fromStream;
    });

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
      pq.putCopyData(chunk, readyCallback);
      fetchMore();
    }

    function readyCallback(err) {
      if (err) {
        callback(err);
        fetchMore(err);
      } else if (ready === 'finish') {
        pq.putCopyEnd(null, callback);
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
