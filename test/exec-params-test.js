var PG = require('../');
var assert = require('assert');

describe('execParams', function() {
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
    pg.execParams("SELECT $1::integer AS number, $2::text as string", [1, 'text'], function (err, result) {
      assert.ifError(err);
      assert.equal(result[0].number, 1);
      assert.equal(result[0].string, 'text');
      done();
    });
  });

  it('should accept utc dates', function(done) {
    var utcdate = new Date(Date.UTC(2015, 2, 30));
    pg.execParams("SELECT $1::date as utcdate", [utcdate], function (err, result) {
      assert.ifError(err);
      var actDate = result[0].utcdate;
      assert.equal(actDate.getUTCFullYear(), 2015);
      assert.equal(actDate.getUTCMonth()+1, 3);
      assert.equal(actDate.getUTCDate(), 30);
      done();
    });
  });

  it('should accept arrays', function(done) {
    var array = [1,2,3];
    pg.execParams("SELECT $1::integer[] as array", [pg.sqlArray(array)], function (err, result) {
      assert.ifError(err);
      var actArray = result[0].array;
      assert.equal(actArray[0], 1);
      assert.equal(actArray[1], 2);
      assert.equal(actArray[2], 3);
      assert.equal(actArray.length, 3);
      done();
    });
  });

  it('should accept objects', function(done) {
    var json = {a: 1, b: [1,2]};
    pg.execParams("SELECT $1::jsonb as object", [json], function (err, result) {
      assert.ifError(err);
      var actObject = result[0].object;
      assert.equal(actObject.a, 1);
      assert.equal(actObject.b[0], 1);
      assert.equal(actObject.b[1], 2);
      assert.equal(actObject.b.length, 2);
      done();
    });
  });

});
