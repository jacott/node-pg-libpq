var queues = new WeakMap;

exports.clearQueue = function (pgConn) {
  var pqueue = queues.get(pgConn);
  if (pqueue) queues.set(pgConn, null);
};

exports.queue = function (pgConn, func) {
  var tail = queues.get(pgConn);
  if (tail) {
    var item = [func, pgConn];
    tail.push(item);
    queues.set(pgConn, item);
  } else {
    queues.set(pgConn, tail = [func, pgConn]);
    execItem(tail);
  }
};

function execItem(item) {
  try {
    if (item[1].pq == null)
      throw new Error("connection is closed");

    item[0](item[1], item);
  } catch(ex) {
    exports.clearQueue(item[1]);
    throw ex;
  }
}

exports.nextItem = function (item) {
  if (item[2]) {
    execItem(item[2]);
  } else
    exports.clearQueue(item[1]);
};
