const PGLibPQ = require('bindings')('pg_libpq');
const util = require('util');
const stream = require('stream');
const fs = require('fs');

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

const parseJSON = value => JSON.parse(value);

const BC_TIME_RE = /^(\d{1,})-(\d{2})-(\d{2}) (?:(\d{2}):(\d{2}):(\d{2})(\.\d{1,})?(?:[+-]\d*)?)? BC$/;

const parseDate = value =>{
  if (value === "infinity") return Infinity;
  if (value === "-infinity") return -Infinity;
  if (value.slice(-3) === " BC") {
    const m = BC_TIME_RE.exec(value);
    if (m !== null) {
      return new Date(Date.UTC(
        -m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6], m[7] === undefined ? 0 : +(m[7].slice(1))));
    }
  }
  return new Date(value);
};

const TYPES = {
  114: parseJSON,
  199: parseJSON,
  1082: parseDate,
  1114: parseDate,
  1115: parseDate,
  1182: parseDate,
  1184: parseDate,
  1185: parseDate,
  3802: parseJSON,
  3807: parseJSON,
};

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

const toSql = (obj)=>{
  switch(typeof obj) {
  case 'undefined':
    return null;
  case 'object':
    if (obj === null) return null;
    const {constructor} = obj;
    if (constructor === Uint8Array) return toHex(Buffer.from(obj));
    if (constructor === Buffer) return toHex(obj);
    if (constructor === Date) return obj.toISOString();
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

let pipeFd = -1;
const initPipe = ()=>{
  const fd = pipeFd = PGLibPQ.initPipe();
  const buf = Buffer.alloc(1);

  const readLoop = ()=>{
    fs.read(fd, buf, 0, 1, null, (err, bytesRead)=>{
      if (err == null && bytesRead == 1) {
        PGLibPQ.runCallbacks();
        readLoop();
      }
      else pipeFd = -1;
    });
  };

  readLoop();
};
const closePipe = ()=>{
  if (pipeFd == -1) return;
  PGLibPQ.closePipe();
  pipeFd = -1;
};

class PG {
  constructor(params='', callback) {
    if (pipeFd == -1) initPipe();
    if (callback === undefined && typeof params === 'function') {
      callback = params;
      params = '';
    }

    if (typeof callback !== 'function')
      throw new Error(callback ? "callback must be a function" : "callback missing");

    const pq = this[pq$] = new PGLibPQ();

    this[queueHead$] = this[queueTail$] = {func: null, next: null};

    if (typeof params !== 'string')
      throw new Error("invalid params argument");

    pq.connectDB(params, err=>{
      if (err != null) this[pq$] = null;
      callback(err, this);
      runNext(this);
    });
  }

  static connect(params='', callback) {
    if (callback !== undefined)
      return new PG(params, callback);

    if (typeof params === 'function')
      return new PG('', params);

    return new Promise((resolve, reject)=>{
      new PG(params, (err, pg)=>{err == null ? resolve(pg) : reject(err)});
    });
  }

  static registerType(typeOid, parseFunction) {
    const prev = TYPES[typeOid];
    TYPES[typeOid] = parseFunction;
    return prev;
  }

  static close() {
    closePipe();
  }

  finish() {
    if (this[abortCopy$])
      this[abortCopy$]('connection closed');
    const pq = this[pq$];
    this[pq$] = null;
    this[queueHead$] = this[queueTail$] = null;
    pq === null || pq.finish();
  }

  isClosed() {return this[pq$] == null}

  isReady() {return ! this.isClosed() && this[pq$].isReady()}

  escapeLiteral(value) {return this[pq$].escapeLiteral(value)}

  exec(command, callback) {
    return promisify(this, callback, cb =>{this[pq$].execParams(command, null, cb)});
  }

  execParams(command, params, callback) {
      if (! Array.isArray(params))
        throw new Error('params must be an array');

    return promisify(this, callback, cb =>{this[pq$].execParams(command, params.map(toSql), cb);});
  }

  prepare(name, command, callback) {
    return promisify(this, callback, cb =>{this[pq$].prepare(name, command, cb)});
  }

  execPrepared(name, params, callback) {
    if (! Array.isArray(params))
      throw new Error('params must be an array');

    params = params.map(toSql);

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
        for(let i = 0; i < rowlen; ++i) {
          const row = rows[i];
          for(let j = 0; j < infolen; ++j) {
            const meta = info[j];
            const name = meta[0], oid = meta[1];
            const v = row[name];
            if (v !== undefined) {
              if (typeof v === 'string') {
                const converter = TYPES[oid];
                row[name] = converter === undefined
                  ? v : converter(v);
              } else {
                const converter = TYPES[oid];
                if (Array.isArray(v)) {
                  if (converter !== undefined) {
                    convertArray(v, converter);
                  }
                } else if (converter !== undefined) {
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
  };
};

module.exports = PG;
