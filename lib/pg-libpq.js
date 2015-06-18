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
  var pgConn = this;
  pgConn.pq = new PGLibPQ();
  pgConn.pq.setTypeConverter(typeConverter);

  if (callback) {
    pgConn.pq.connectDB(params, function (err) {
      callback(err, pgConn);
    });
    return;
  }

  this._promise = new Promise(function (resolve, reject) {
    pgConn.pq.connectDB(params, function (err) {
      if (err) reject(err);
      else resolve();
    });
  });
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
    if (promise) {
      this._promise = null;
      return promise.then(resolved, rejected);
    } else {
      return whenReady(this).then(resolved, rejected);
    }
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

function whenReady(pgConn) {
  if (pgConn._promise)
    return pgConn;
  if (pgConn.isClosed())
    return Promise.reject(connectionClosedError());
  else if (pgConn.isReady())
    return Promise.resolve(pgConn);
  else if (pgConn._readyPromise)
    return new Promise(function (resolve, reject) {
      pgConn._readyPromise.then(resolve, reject);
    });
  else {
    return pgConn._readyPromise = new Promise(function (resolve, reject) {
      pgConn._resolveReadyPromise = function () {
        resolve(pgConn);
      };
    });
  }
}

copyIO(PG, handleCallback);

function connectionClosedError() {
  var ex = new Error("connection is closed");
  ex.sqlState = '08003';
  return ex;
}

function handleCallback(pgConn, callback) {
  if (! callback) throw new Error("Callback missing");
  return function (err, result) {
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
    } else
      callback(null, result);

    var resolver = pgConn._resolveReadyPromise;
    if (resolver) {
      global.setImmediate(function () {
        if (pgConn.isReady()) {
          pgConn._resolveReadyPromise = pgConn._readyPromise = null;
          resolver(pgConn);
        }
      });
    }
  };
}

function promisify(pgConn, callback, func) {
  if (pgConn.isClosed()) throw connectionClosedError();
  if (callback) {
    pgConn._promise = null;
    func.call(pgConn, handleCallback(pgConn, callback));
  } else
    return pgConn._promise = new Promise(function (resolve, reject) {
      try {
        func.call(pgConn, handleCallback(pgConn, function (err, result) {
          if (err) reject(err);
          else resolve(result);
        }));
      } catch(ex) {
        reject(ex);
      }
    });
}
