var PG = require('../');
var assert = require('assert');

describe('connecting', function() {

  it('connects using defaults', function (done) {
    new PG(function (err, pg) {
      assert.ifError(err);
      pg.exec("SELECT 1", function (err, res) {
        assert.ifError(err);
        assert.equal(res[0]['?column?'], 1);
        pg.finish();
        done();
      });
    });
  });

  it('connects using tcp socket', function (done) {
    new PG("host=localhost password=rubbish", function (err, res) {
      assert(/password authentication failed/.test(err.message), err.message);
      done();
    });
  });

  it('connects asynchronously', function(done) {
    var other = 1;
    var count = 2;
    var pg = new PG("host=/var/run/postgresql", function(err) {
      assert.ifError(err);
      pg.exec("SELECT 1 AS b, 'world' as hello", function (err, result) {
        assert.ifError(err);
        assert.equal(JSON.stringify(result), JSON.stringify([{b: 1, hello: 'world'}]));
        --count;
      });
      pg.exec("SELECT 2 AS x", function (err, result) {
        assert.ifError(err);
        assert.equal(JSON.stringify(result), JSON.stringify([{x: 2}]));
        assert.equal(--count, 0);
        if (other === 0) done();
      });
    });
    var oPg = new PG("host=/var/run/postgresql", function(err) {
      assert.ifError(err);
      oPg.exec("SELECT 'other' bad bad", function (err, result) {
        --other;
        assert(/syntax/.test(err.message));
        if (count === 0) done();
      });
    });
  });
});
