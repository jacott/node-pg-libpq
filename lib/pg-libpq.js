var PGLibPQ = require('bindings')('pg_libpq.node').PGLibPQ;

module.exports = PG;

function PG(params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = '';
  }
  var pg = this;
  pg.pq = new PGLibPQ();

  pg.pq.connectDB(params, function (err) {
    if (err) return callback(err);
    callback(null, pg);
  });
}

PG.prototype = {
  constructor: PG,

  exec: function (command, callback) {
    this.pq.exec(command, callback);
  },
}
