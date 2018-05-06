const PGLibPQ = require('bindings')('pg_libpq');
const pgTypes = require('pg-types');
const util = require('util');
const stream = require('stream');

const pq$ = Symbol(), abortCopy$ = Symbol(),
      queueHead$ = Symbol(), queueTail$ = Symbol(),
      promise$ = Symbol();

const ERROR_FIELDS = {
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

for(const k in ERROR_FIELDS) {
  ERROR_FIELDS[k] = ERROR_FIELDS[k].charCodeAt(0);
}

const connectionClosedError = ()=>{
  const ex = new Error("connection is closed");
  ex.sqlState = '08003';
  return ex;
};

const typeConverter = (type, stringVal)=> pgTypes.getTypeParser(type, 'text')(stringVal);

class PG {
  constructor(params='', callback) {
    if (typeof params === 'function') {
      callback = params;
      params = '';
    }

    const pq = this[pq$] = new PGLibPQ();

    this[queueHead$] = this[queueTail$] = {func: null, next: null};

    if (typeof params !== 'string')
      throw new Error("invalid params argument");

    if (typeof callback === 'function') {
      pq.connectDB(params, err=>{
        if (err != null) this[pq$] = null;
        callback(err, this);
        runNext(this);
      });
      return;
    }

    this[promise$] = new Promise((resolve, reject)=>{
      pq.connectDB(params, err =>{
        this[promise$] = undefined;
        if (err) reject(err);
        else resolve();
        runNext(this);
      });
    });
  }

  static _toSql(obj) {
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

  finish() {
    if (this[abortCopy$])
      this[abortCopy$]('connection closed');
    const pq = this[pq$];
    this[pq$] = null;
    this[queueHead$] = this[queueTail$] = null;
    pq === null || pq.finish();
  }

  then(resolved, rejected) {
    const promise = this[promise$];
    if (promise !== undefined)
      return promise.then(resolved, rejected);

    return Promise.resolve().then(resolved, rejected);
  }

  catch(func) {
    return this.then(null, func);
  }

  isClosed() {return this[pq$] == null}

  isReady() {return ! this.isClosed() && this[pq$].isReady()}

  escapeLiteral(value) {return this[pq$].escapeLiteral(value)}

  exec(command, callback) {
    return promisify(this, callback, cb =>{this[pq$].execParams(command, null, cb)});
  }

  sqlArray(array) {
    if (! Array.isArray(array))
      throw new Error('argument must be an array');

    return '{'+array.map(PG._toSql).join(',')+'}';
  }

  execParams(command, params, callback) {
      if (! Array.isArray(params))
        throw new Error('params must be an array');

    params = params.map(PG._toSql);
    return promisify(this, callback, cb =>{this[pq$].execParams(command, params, cb);});
  }

  prepare(name, command, callback) {
    return promisify(this, callback, cb =>{this[pq$].prepare(name, command, cb)});
  }

  execPrepared(name, params, callback) {
    if (! Array.isArray(params))
      throw new Error('params must be an array');

    params = params.map(PG._toSql);

    return promisify(this, callback, cb =>{this[pq$].execPrepared(name, params, cb)});
  }

  resultErrorField(field) {return this[pq$].resultErrorField(ERROR_FIELDS[field])}

  copyFromStream(command, params, callback) {
    if (arguments.length === 2) {
      callback = params;
      params = null;
    }

    const pq = this[pq$];
    let readMore = null, ready = false, waitingChunk;

    this[abortCopy$] = (errorMsg='abort')=>{
      this[abortCopy$] = null;
      if (ready === true)
        pq.putCopyEnd(errorMsg.toString(), callback);
      else
        ready = errorMsg;
    };

    const fetchMore = err =>{
      if (! readMore) return;
      const next = readMore;
      readMore = null;
      next(err);
    };

    const sendWaiting = ()=>{
      const chunk = waitingChunk;
      ready = false;
      waitingChunk = null;
      try {
        pq.putCopyData(chunk, readyCallback);
      } catch(ex) {
        callback(ex);
      }
      fetchMore();
    };

    const readyCallback = err =>{
      if (err) {
        callback(err);
        fetchMore(err);
      } else if (typeof ready === 'string') {
        try{
          this[abortCopy$] = null;
          pq.putCopyEnd(ready || null, callback);
        } catch(ex) {
          callback(ex);
        }
      } else if (waitingChunk){
        sendWaiting();
      } else {
        ready = true;
        fetchMore();
      }
    };

    const fromStream = stream.Writable();
    fromStream._write = (chunk, enc, next)=>{
      if (typeof ready !== 'boolean') {
        next(ready);
        return;
      }
      readMore = next;
      waitingChunk = chunk;
      ready && sendWaiting();
    };
    callback = handleCallback(this, callback);

    fromStream.on('finish', ()=>{
      if (ready === true)
        try {
          this[abortCopy$] = null;
          pq.putCopyEnd(null, callback);
        } catch(ex) {
          callback(ex);
        }
      else
        ready = '';
    });
    try {
      pq.copyFromStream(command, params, readyCallback);
    } catch(ex) {
      callback(ex);
    }

    return fromStream;
  }
}

const runNext = pgConn =>{
  if (pgConn[queueHead$] === null) return;
  pgConn[queueHead$] = pgConn[queueHead$].next;
  if (pgConn[queueHead$] !== null) {
    const {func} = pgConn[queueHead$];
    func();
  } else
    pgConn[queueTail$] = null;
};

const queueFunc = (pgConn, func)=>{
  const node = {func: func, next: null};
  if (pgConn[queueHead$] === null) {
    pgConn[queueHead$] = pgConn[queueTail$] = node;
    func();
  } else {
    pgConn[queueTail$].next = node;
    pgConn[queueTail$] = node;
  }
};

const promisify = (pgConn, callback, func)=>{
  if (pgConn.isClosed()) throw connectionClosedError();

  if (typeof callback === 'function') {
    queueFunc(pgConn, ()=>{func.call(pgConn, handleCallback(pgConn, callback))});
    return;
  }
  return new Promise((resolve, reject)=>{
    queueFunc(pgConn, ()=>{
      try {
        func.call(pgConn, handleCallback(pgConn, (err, result)=>{
          if (err) reject(err);
          else resolve(result);
        }));
      } catch(ex) {
        reject(ex);
      }
    });
  });
};

const handleCallback = (pgConn, callback)=>{
  if (! callback) throw new Error("pg-libpq: Callback missing");
  return function (err, result) {
    runNext(pgConn);
    if (err) {
      if (err.sqlState) {
        callback(err);
        return;
      }
      if (! pgConn[pq$]) {
        var ex = connectionClosedError();
      } else try {
        var ex = err;
        ex.sqlState = pgConn[pq$].resultErrorField(ERROR_FIELDS.SQLSTATE);
      } catch(err) {
        ex = err;
      }
      callback(ex);
    } else {
      if (Array.isArray(result)) {
        const info = result[0], infolen = info.length, rows = result[1], rowlen = rows.length;
        for(let i = 0; i < rowlen; ++i) {
          const row = rows[i];
          const obj = {};
          for(let j = 0; j < infolen; ++j) {
            const meta = info[j];
            const v = row[j];
            if (v !== null)
              obj[meta[0]] = typeConverter(meta[1], v);
          }

          rows[i] = obj;
        }
        callback(null, rows);
      } else {
        callback(null, result);
      }
    }
  };
};

module.exports = PG;
