var PGLibPQ = require('bindings')('pg_libpq.node').PGLibPQ;
var pgTypes = require('pg-types');

module.exports = PG;

pgTypes.setTypeParser(1114, 'text', function (value) {
  return new Date(value+'Z');
});


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

  exec: function (command, callback) {
    this.pq.exec(command, callback);
  },

  execParams: function (command, params, callback) {
    this.pq.execParams(command, params, callback);
  },
}
