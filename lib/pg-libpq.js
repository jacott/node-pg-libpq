const util = require('util');
const stream = require('stream');
const fs = require('fs');

const PARSERS = require('./parsers');
const PGLibPQ = (()=>{
  try {
    return require('../build/Release/pg_libpq.node');
  } catch(err) {
    return require('../build/Debug/pg_libpq.node');
  }
})();

const pq$ = Symbol(), abortCopy$ = Symbol(),
      queueHead$ = Symbol(), queueTail$ = Symbol();

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

const toNum = n => +n;
const identity = n => n;

const connectionClosedError = ()=>{
  const ex = new Error("connection is closed");
  ex.sqlState = '08003';
  return ex;
};

const zero = '000000000';
const ab = new ArrayBuffer(4);
const dv = new DataView(ab);
const iu8 = new Uint8Array(ab);
const u32 = new Uint32Array(ab);

const toHex = (buffer)=> '\\x'+buffer.toString('hex');

const threePad = n => n < 100 ? n < 10 ? '00'+n : '0'+n : ''+n;
const fourPad = n => n < 1000 ? '0'+threePad(n) : ''+n;

const dateToSql = d =>{
  const year = d.getUTCFullYear();
  if (year > 0) return d.toISOString();
  return fourPad(1-year)+'-'+(d.getUTCMonth()+1)+'-'+d.getUTCDate()+
    'T'+d.getUTCHours() + ':' + d.getUTCMinutes() + ':'
    + d.getUTCSeconds() + '.' + threePad(d.getUTCMilliseconds()) + ' BC';
};

const toSql = (obj)=>{
  switch(typeof obj) {
  case 'undefined':
    return null;
  case 'object':
    if (obj === null) return null;
    const {constructor} = obj;
    if (constructor === Uint8Array) return toHex(Buffer.from(obj));
    if (constructor === Buffer) return toHex(obj);
    if (constructor === Date) return dateToSql(obj);
    return JSON.stringify(obj);
  default:
    return obj.toString();
  }
};

const quoteArrayValueRE = /[\\,"}{\s]/;

const wrapArrayValue = v => v == null
      ? 'NULL' : (
        Array.isArray(v)
          ? sqlArray(v) : (
            v === '' || v === 'NULL' || v === 'null' || quoteArrayValueRE.test(v = toSql(v))
              ? JSON.stringify(v) : v.toString()));

const convertArray = (v, converter)=>{
  for(let i = v.length-1; i >= 0; --i) {
    const item = v[i];
    if (Array.isArray(item))
      convertArray(item, converter);
    else
      v[i] = converter(item);
  }
};

const sqlArray  = array =>{
  if (array == null) return array;
  if (! Array.isArray(array))
    throw new Error('argument must be an array');

  return '{'+array.map(v => Array.isArray(v) ? sqlArray(v) : wrapArrayValue(v)).join(',')+'}';
};


class PG {
  constructor(params='', callback) {
    if (callback === void 0 && typeof params === 'function') {
      callback = params;
      params = '';
    }

    if (typeof callback !== 'function' && callback !== void 0)
      throw new Error("callback must be a function");

    const pq = this[pq$] = new PGLibPQ();

    this[queueHead$] = this[queueTail$] = {func: null, next: null};

    if (typeof params !== 'string')
      throw new Error("invalid params argument");

    pq.connectDB(params, err=>{
      if (err != null) this.finish();
      try {
        if (callback === void 0) {
          if (err != null) throw err;
        } else
          callback(err, this);
      } catch(err) {
        console.error('Unhandled Error', err);
      }
      if (err == null)
        runNext(this);
    });
  }

  static connect(params='', callback) {
    if (callback !== void 0)
      return new PG(params, callback);

    if (typeof params === 'function')
      return new PG('', params);

    return new Promise((resolve, reject)=>{
      new PG(params, (err, pg)=>{
        if (err == null)
          resolve(pg);
        else {
          reject(err);
        }
      });
    });
  }

  static registerType(typeOid, parseFunction) {
    const prev = PARSERS[typeOid];
    PARSERS[typeOid] = parseFunction;
    return prev;
  }

  finish() {
    if (this[abortCopy$])
      this[abortCopy$]('connection closed');
    const pq = this[pq$];
    if (pq === null) return;
    this[pq$] = null;
    pq.finish();

    while (this[queueHead$] !== null)
      runNext(this);
  }

  isClosed() {return this[pq$] === null}

  isReady() {return ! this.isClosed() && this[pq$].isReady()}

  escapeLiteral(value) {return this[pq$].escapeLiteral(value.toString())}

  exec(command, callback) {
    return promisify(this, callback, cb =>{this[pq$].execParams(command.toString(), null, cb)});
  }

  execParams(command, params, callback) {
      if (! Array.isArray(params))
        throw new Error('params must be an array');

    return promisify(this, callback, cb =>{
      this[pq$].execParams(command.toString(), params.map(toSql), cb);
    });
  }

  prepare(name, command, callback) {
    return promisify(this, callback, cb =>{
      this[pq$].prepare(name.toString(), command.toString(), cb);
    });
  }

  execPrepared(name, params, callback) {
    if (! Array.isArray(params))
      throw new Error('params must be an array');

    params = params.map(toSql);

    return promisify(this, callback, cb =>{
      this[pq$].execPrepared(name.toString(), params, cb);
    });
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
      pq.copyFromStream(command.toString(), params, readyCallback);
    } catch(ex) {
      callback(ex);
    }

    return fromStream;
  }
}

PG.toSql = toSql;
PG.sqlArray = sqlArray;

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
    queueFunc(pgConn, ()=>{
      const cb = handleCallback(pgConn, callback);
      if (pgConn.isClosed())
        cb(connectionClosedError());
      else
        func.call(pgConn, cb);
    });
    return;
  }
  return new Promise((resolve, reject)=>{
    queueFunc(pgConn, ()=>{
      try {
        const cb = handleCallback(pgConn, (err, result)=>{
          if (err) reject(err);
          else resolve(result);
        });
        if (pgConn.isClosed())
          cb(connectionClosedError());
        else func.call(pgConn, cb);
      } catch(ex) {
        reject(ex);
      }
    });
  });
};

const handleCallback = (pgConn, callback)=>{
  if (! callback) throw new Error("pg-libpq: Callback missing");
  return (err, result)=>{
    try {
    runNext(pgConn);
    if (err) {
      if (err.sqlState) {
        callback(err);
        return;
      }
      let ex;
      if (! pgConn[pq$]) {
        ex = connectionClosedError();
      } else try {
        ex = err;
        ex.sqlState = pgConn[pq$].resultErrorField(ERROR_FIELDS.SQLSTATE);
      } catch(err) {
        ex = err;
      }
      callback(ex);
    } else {
      if (Array.isArray(result)) {
        const info = result[0], infolen = info.length, rows = result[1], rowlen = rows.length;
        for(let j = 0; j < infolen; ++j) {
          const meta = info[j];
          const name = meta[0], oid = meta[1];
          const converter = PARSERS[oid];
          if (converter !== void 0) for(let i = 0; i < rowlen; ++i) {
            const row = rows[i];
            const v = row[name];
            if (v !== void 0) {
              if (typeof v === 'string') {
                row[name] = converter(v);
              } else {
                if (Array.isArray(v)) {
                  convertArray(v, converter);
                } else {
                  row[name] = converter(v);
                }
              }
            }
          }
        }
        callback(null, rows);
      } else {
        callback(null, result);
      }
    }
    } catch(err) {
      console.error('Unhandled Error', err);
    }
  };
};

module.exports = PG;
