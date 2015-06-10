var PG = require('../');
var assert = require('assert');
var fs = require('fs');

describe('copy streaming', function() {
  var pg;
  beforeEach(function (done) {
    pg = new PG(function(err) {
      assert.ifError(err);
      pg.exec("CREATE TEMPORARY TABLE node_pg_test (_id integer, foo text, bar date)", function (err, count) {
        assert.ifError(err);
        done();
      });
    });
  });

  afterEach(function () {
    pg && pg.finish();
    pg = null;
  });

  it("can cancel in progress", function (done) {
    var wasReady;
    assert.equal(pg.isReady(), true);
    var dbStream = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', function (err) {
      assert.equal(wasReady, false);
      assert.equal(err.message, 'connection is closed');
      assert.equal(err.sqlState, '08003');
      assert.equal(pg.isReady(), false);
      dbStream.on('error', function (error) {
        try {
          assert.equal(error, 'connection closed');
          done();
        } catch(ex) {
          done(ex);
        }
      });
      dbStream.end('123,"name","2015-01-01"\n'); // should trigger above error
    });
    dbStream.write('123,"line 1","2015-02-02"\n');
    assert.equal(pg.isReady(), false);
    setTimeout(function () {
      try {
        wasReady = pg.isReady();
        dbStream.write('456,"line 2","2015-02-02"\n');
        pg.finish();
      } catch(ex) {
        done(ex);
      }
    }, 10);
  });

  it("should handle nesting", function (done) {
    var dbStream = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', function (err) {
      assert.ifError(err);
      if (! pg) return;
      var dbStream2 = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', function (err) {
        assert.ifError(err);
        done();
      });
      dbStream2.write('123,"name","2015-03-03"\n');
      dbStream2.end();
    });
    dbStream.write('123,"name","2015-11-18"\n');
    dbStream.write('456,"another","2010-05-18"\n');
    dbStream.end();
  });

  it("should copy from buffer", function (done) {
    var fromFilename = __filename.replace(/\.js$/, '-from-data.csv');
    var fromStream = fs.createReadStream(fromFilename);
    var dbStream = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', function (err) {
      assert.ifError(err);
      pg.exec('SELECT * FROM node_pg_test WHERE _id = 2', function (err, rows) {
        assert.ifError(err);
        assert.equal(rows[0].foo, 'row 2');
        assert.equal(rows[0].bar.getDate(), 2);
        done();
      });
    });
    fromStream.on('error', failError);
    fromStream.pipe(dbStream).on('error', failError);
  });
});

function failError(err) {
  assert.ifError(err);
  assert(false, 'expected error');
}
