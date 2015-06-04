var PG = require('../');
var assert = require('assert');

describe('execParams', function() {

  it('should accept numbers and strings', function(done) {
    new PG(function(err, pg) {
      assert.ifError(err);
      pg.execParams("SELECT $1 AS number, $2 as string", [1, 'text'], function (err, result) {
        assert.ifError(err);
        assert.equal(result[0].number, 1);
        assert.equal(result[0].string, 'text');
        done();
      });
    });
  });

  // it('should accept dates', function(done) {
  //   new PG(function(err, pg) {
  //     assert.ifError(err);
  //     pg.exec("SELECT DATE '2015-06-05' as date", function (err, result) {
  //       assert.ifError(err);
  //       var actDate = result[0].date;
  //       assert.equal(actDate.getFullYear(), 2015);
  //       assert.equal(actDate.getMonth()+1, 6);
  //       assert.equal(actDate.getDate(), 5);
  //       done();
  //     });
  //   });
  // });

  // it('should accept arrays', function(done) {
  //   new PG(function(err, pg) {
  //     assert.ifError(err);
  //     pg.exec("SELECT ARRAY[1,2,3] as array", function (err, result) {
  //       assert.ifError(err);
  //       var actArray = result[0].array;
  //       assert.equal(actArray[0], 1);
  //       assert.equal(actArray[1], 2);
  //       assert.equal(actArray[2], 3);
  //       assert.equal(actArray.length, 3);
  //       done();
  //     });
  //   });
  // });

  // it('should accept objects', function(done) {
  //   new PG(function(err, pg) {
  //     assert.ifError(err);
  //     pg.exec("SELECT '{\"a\": 1, \"b\": [1,2]}'::jsonb as object", function (err, result) {
  //       assert.ifError(err);
  //       var actObject = result[0].object;
  //       assert.equal(actObject.a, 1);
  //       assert.equal(actObject.b[0], 1);
  //       assert.equal(actObject.b[1], 2);
  //       assert.equal(actObject.b.length, 2);
  //       done();
  //     });
  //   });
  // });

});
