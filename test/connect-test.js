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
    new PG("host=localhost password=bad")
      .catch(function (err) {
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
        assert.equal(ex.message, "connection not in INIT state");
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
        pq.execParams("SELECT 1 AS a", null, function (err) {
          assert(false, "should not get here");
        });
      } catch(ex) {
        assert.equal(ex.message, "connection not in READY state");
        done();
      }
    });
  });

  it('connects asynchronously', function(done) {
    var me = true;
    var other = true;
    var pg = new PG("host=/var/run/postgresql");
    assert.equal(pg.isReady(), false);
    pg.then(function() {
      assert.equal(pg.isReady(), true);
      return pg.exec("SELECT 1 AS b, 'world' as hello");

    }).then(function (result) {
      assert.equal(JSON.stringify(result), JSON.stringify([{b: 1, hello: 'world'}]));
      return pg.exec("SELECT 2 AS x");

    }).then(function (result) {
      assert.equal(JSON.stringify(result), JSON.stringify([{x: 2}]));
      pg.finish();
      me = false;
      other || done();

    }).catch(function (err) {done(err)});
    var oPg = new PG("host=/var/run/postgresql");
    oPg.then(function() {
      return oPg.exec("SELECT 'other' bad bad");
    }).catch(function (err) {
      assert(/syntax/.test(err.message));
      assert.equal(err.sqlState, '42601');
      assert.equal(oPg.resultErrorField('SEVERITY'), 'ERROR');
      oPg.finish();
      other = false;
      me || done();
    });
  });
});
