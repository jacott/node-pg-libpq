var PG = require('../');
var assert = require('assert');

describe('crud', function() {
  var pg;
  before(function (done) {
    pg = new PG(function(err) {
      assert.ifError(err);
      pg.exec("CREATE TEMPORARY TABLE node_pg_test (_id integer, foo text, bar jsonb, baz date)",
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

  it('should count updates and deletes', function(done) {
    pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                  [1, 'one', {one: 1}], function (err, count) {
                    assert.ifError(err);
                    assert.equal(count, 1);
                  });
    pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                  [2, 'two', {two: 2}], function (err, count) {
                    assert.ifError(err);
                  });
    pg.execParams("UPDATE node_pg_test SET foo = $2, bar = $3 WHERE _id = $1",
                  [1, 'two', {one: 2}], function (err, count) {
                    assert.ifError(err);
                    assert.equal(count, 1);
                  });
    pg.execParams("UPDATE node_pg_test SET bar = $2 WHERE foo = $1",
                  ['two', null], function (err, count) {
                    assert.ifError(err);
                    assert.equal(count, 2);
                  });

    pg.exec("DELETE FROM node_pg_test WHERE bar IS NULL", function (err, count) {
      assert.ifError(err);
      assert.equal(count, 2);
      done();
    });
  });
});
