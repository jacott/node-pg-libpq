var PG = require('../');
var assert = require('assert');
var fs = require('fs');

describe('copy streaming', function() {
  var pg;
  before(function (done) {
    pg = new PG(function(err) {
      assert.ifError(err);
      pg.exec("CREATE TEMPORARY TABLE node_pg_test (_id integer, foo text, bar date)",
              function (err, count) {
                assert.ifError(err);
                done();
              });
    });
  });

  after(function () {
    pg && pg.finish();
    pg = null;
  });

  it("should handle nesting", function (done) {
    var count = 3;
    var dbStream = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', function (err) {
      if (! pg) return;
      var dbStream2 = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', function (err) {
        assert.ifError(err);
        finished();
      });
      dbStream2.write('123,"name","address"\n');
      dbStream2.end();
    });
    dbStream.write('123,"name","2015-11-18"\n');
    dbStream.write('456,"another","2010-05-18"\n');
    dbStream.end();
    var dbStream2 = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', function (err) {
      assert.ifError(err);
      finished();
    });
    dbStream2.write('123,"name","address"\n');
    dbStream2.end();
    // pg.exec('SELECT 1 AS a', function (err) {
    finished();
    // });

    function finished() {
      if (--count === 0)
        done();
    }
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
