var PG = require('../');
var assert = require('assert');

describe('connecting', function() {

  it('connects asynchronously', function(done) {
    console.log('DEBUG', PG);
    var pg = new PG(function(err) {
      assert.ifError(err);
      pg.exec('SELECT 1 AS a', function (err, result) {
        assert.ifError(err);
        assert.equal(result, [{a: 1}]);
        done();
      });
    });
  });
});
