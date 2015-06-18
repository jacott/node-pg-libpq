var PG = require('../');
var assert = require('assert');

describe('execPrepared', function() {
  var pg;
  before(function (done) {
    pg = new PG(function(err) {
      assert.ifError(err);
      done();
    });
  });

  after(function () {
    pg && pg.finish();
    pg = null;
  });

  it('should accept numbers and strings', function(done) {
    pg.prepare("p1", "SELECT $1::integer AS number, $2::text as string").then(function () {
      return pg.execPrepared("p1", [1, 'text']);
    }).then(function (result) {
      assert.equal(result[0].number, 1);
      assert.equal(result[0].string, 'text');
      return pg.execPrepared("p1", [4, 'foo']);
    }).then(function (result) {
      assert.equal(result[0].number, 4);
      assert.equal(result[0].string, 'foo');
      done();
    }).catch(done);
  });
});
