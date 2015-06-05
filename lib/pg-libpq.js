var PGLibPQ = require('bindings')('pg_libpq.node').PGLibPQ;
var pgTypes = require('pg-types');

module.exports = PG;

pgTypes.setTypeParser(1114, 'text', parseDate);
pgTypes.setTypeParser(1082, 'text', parseDate);

function parseDate(value) {
  return new Date(value+'Z');
}

function PG(params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = '';
  }
  var pg = this;
  pg.pq = new PGLibPQ();
  pg.pq.setTypeConverter(typeConverter);

  pg.pq.connectDB(params, function (err) {
    if (err) return callback(err);
    callback(null, pg);
  });
}

function typeConverter(type, stringVal) {
  return pgTypes.getTypeParser(type, 'text')(stringVal);
}

PG.prototype = {
  constructor: PG,

  finish: function () {
    this.pq.finish();
    this.pq = null;
  },

  exec: function (command, callback) {
    this.pq.exec(command, function (err, result) {
      if (err)
        callback(new Error(err));
      else
        callback(null, result);
    });
  },

  sqlArray: function (array) {
    if (! Array.isArray(array))
      throw new Error('argument must be an array');

    return '{'+array.map(toSql).join(',')+'}';
  },

  execParams: function (command, params, callback) {
    if (! Array.isArray(params))
      throw new Error('params must be an array');

    params = params.map(toSql);
    this.pq.execParams(command, params, function (err, result) {
      if (err)
        callback(new Error(err));
      else
        callback(null, result);
    });
  },
}

function toSql(obj) {
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
