var PGLibPQ = require('bindings')('pg_libpq.node').PGLibPQ;
var pgTypes = require('pg-types');
var copyIO = require('./copy-io');

module.exports = PG;

var ERROR_FIELDS = PGLibPQ.ERROR_FIELDS = {
  SEVERITY: 'S',
  SQLSTATE: 'C',
  MESSAGE_PRIMARY: 'M',
  MESSAGE_DETAIL: 'D',
  MESSAGE_HINT: 'H',
  STATEMENT_POSITION: 'P',
  INTERNAL_POSITION: 'p',
  INTERNAL_QUERY: 'q',
  CONTEXT: 'W',
  SCHEMA_NAME: 's',
  TABLE_NAME: 't',
  COLUMN_NAME: 'c',
  DATATYPE_NAME: 'd',
  CONSTRAINT_NAME: 'n',
  SOURCE_FILE: 'F',
  SOURCE_LINE: 'L',
  SOURCE_FUNCTION: 'R',
};

for(var k in ERROR_FIELDS) {
  ERROR_FIELDS[k] = ERROR_FIELDS[k].charCodeAt(0);
}

function PG(params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = '';
  }
  const pgConn = this;
  pgConn.pq = new PGLibPQ();
  pgConn.pq.setTypeConverter(typeConverter);

  pgConn._queueHead = pgConn._queueTail = {func: null, next: null};

  pgConn._promise = null;

  if (callback) {
    pgConn.pq.connectDB(params, function (err) {
      runNext(pgConn);
      callback && callback(err, pgConn);
    });
    return;
  }

  var promise = this._promise = new Promise(function (resolve, reject) {
    if (promise === pgConn._promise)
      pgConn._promise = null;
    pgConn.pq.connectDB(params, function (err) {
      runNext(pgConn);
      if (err) reject(err);
      else resolve();
    });
  });
}

function runNext(pgConn) {
  if (pgConn._queueHead === null) return;
  pgConn._queueHead = pgConn._queueHead.next;
  if (pgConn._queueHead) {
    var func = pgConn._queueHead.func;
    func();
  } else
    pgConn._queueTail = null;
}

function queueFunc(pgConn, func) {
  var node = {func: func, next: null};
  if (! pgConn._queueHead) {
    pgConn._queueHead = pgConn._queueTail = node;
    func();
  } else {
    pgConn._queueTail.next = node;
    pgConn._queueTail = node;
  }
}

function typeConverter(type, stringVal) {
  return pgTypes.getTypeParser(type, 'text')(stringVal);
}

PG._toSql = function(obj) {
  switch(typeof obj) {
  case 'undefined':
    return null;
  case 'object':
    if (obj === null) return null;
    return JSON.stringify(obj);
  default:
    return obj.toString();
  }
}

PG.prototype = {
  constructor: PG,

  finish: function () {
    if (this.abortCopy)
      this.abortCopy('connection closed');
    var pq = this.pq;
    this.pq = null;
    this._queueHead = this._queueTail = null;
    pq && pq.finish();
  },

  isClosed: function () {
    return this.pq == null;
  },

  isReady: function () {
    return ! this.isClosed() && this.pq.isReady();
  },

  then: function (resolved, rejected) {
    var promise = this._promise;
    if (promise)
      return this._promise = promise.then(resolved, rejected);

    return this._promise = Promise.resolve(resolved && resolved());
  },

  catch: function (func) {
    return this.then(null, func);
  },

  escapeLiteral: function (value) {
    return this.pq.escapeLiteral(value);
  },

  exec: function (command, callback) {
    return promisify(this, callback, function (callback) {
      this.pq.execParams(command, null, callback);
    });
  },

  sqlArray: function (array) {
    if (! Array.isArray(array))
      throw new Error('argument must be an array');

    return '{'+array.map(PG._toSql).join(',')+'}';
  },

  execParams: function (command, params, callback) {
    if (! Array.isArray(params))
      throw new Error('params must be an array');

    params = params.map(PG._toSql);
    return promisify(this, callback, function (callback) {
      this.pq.execParams(command, params, callback);
    });
  },

  prepare: function (name, command, callback) {
    return promisify(this, callback, function (callback) {
      this.pq.prepare(name, command, callback);
    });
  },

  execPrepared: function (name, params, callback) {
    if (! Array.isArray(params))
      throw new Error('params must be an array');

    params = params.map(PG._toSql);
    return promisify(this, callback, function (callback) {
      this.pq.execPrepared(name, params, callback);
    });
  },

  resultErrorField: function (field) {
    return this.pq.resultErrorField(ERROR_FIELDS[field]);
  },

  _connectionClosedError: connectionClosedError,
};

copyIO(PG, handleCallback);

function connectionClosedError() {
  var ex = new Error("connection is closed");
  ex.sqlState = '08003';
  return ex;
}

function handleCallback(pgConn, callback) {
  if (! callback) throw new Error("pg-libpq: Callback missing");
  return function (err, result) {
    runNext(pgConn);
    if (err) {
      if (err.sqlState) {
        callback(err);
        return;
      }
      if (! pgConn.pq) {
        var ex = connectionClosedError();
      } else try {
        var ex = new Error(err.message);
        ex.sqlState = pgConn.pq.resultErrorField(ERROR_FIELDS.SQLSTATE);
      } catch(err) {
        ex = err;
      }
      callback(ex);
    } else {
      callback(null, result);
    }
  };
}

function promisify(pgConn, callback, func) {
  if (pgConn.isClosed()) throw connectionClosedError();
  var cPromise = pgConn._promise;
  if (callback && ! cPromise) {
    queueFunc(pgConn, function () {
      func.call(pgConn, handleCallback(pgConn, callback));
    });
    return;
  }
  var newPromise = new Promise(function (resolve, reject) {
    if (pgConn._promise === newPromise)
      pgConn._promise = null;
    queueFunc(pgConn, function () {
      try {
        func.call(pgConn, handleCallback(pgConn, function (err, result) {
          if (err) reject(err);
          else resolve(result);
        }));
      } catch(ex) {
        reject(ex);
        }
    });
  });
  if (callback) return pgConn._promise =
    cPromise
    .then(newPromise)
    .then(
      function (result) {callback(null, result)},
      function (err) {callback(err)}
    );
  return pgConn._promise = newPromise;
}
