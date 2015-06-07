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
    new PG("host=localhost password=rubbish", function (err) {
      assert(/password authentication failed/.test(err.message), err.message);
      done();
    });
  });

  it("should throw error if connection is used in wrong state", function (done) {
    new PG(function (err, pg) {
      try {
        pg.pq.connectDB(function (err) {
          assert(false, "should not get here");
        });
        assert(false, "should have thrown exception");
      } catch(ex) {
        assert.equal(ex.message, "connection in unexpected state");
      }
      var pq = pg.pq;
      pg.finish();
      try {
        pg.exec("SELECT 1 AS a", function (err) {
          assert(false, "should not get here");
        });
      } catch(ex) {
        assert.equal(ex.message, "connection is closed");
      }
      try {
        pq.exec("SELECT 1 AS a", function (err) {
          assert(false, "should not get here");
        });
      } catch(ex) {
        assert.equal(ex.message, "connection in unexpected state");
        done();
      }
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
        pg.finish();
        if (other === 0) done();
      });
      pg.exec("I WONT RUN", function (err) {
        assert.ifError(err);
      });
    });
    var oPg = new PG("host=/var/run/postgresql", function(err) {
      assert.ifError(err);
      oPg.exec("SELECT 'other' bad bad", function (err, result) {
        --other;
        assert(/syntax/.test(err.message));
        assert.equal(err.sqlState, '42601');
        assert.equal(oPg.resultErrorField('SEVERITY'), 'ERROR');
        oPg.finish();
        if (count === 0) done();
      });
    });
  });
});
