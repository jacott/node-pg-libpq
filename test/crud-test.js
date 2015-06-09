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
                  [1, 'one', {one: 1}])

      .then(function (count) {
        assert.equal(count, 1);
        return pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                             [2, 'two', {two: 2}]);

      }).then(function () {
        return pg.execParams("UPDATE node_pg_test SET foo = $2, bar = $3 WHERE _id = $1",
                             [1, 'two', {one: 2}]);
      }).then(function (count) {
        assert.equal(count, 1);
        return pg.execParams("UPDATE node_pg_test SET bar = $2 WHERE foo = $1",
                             ['two', null]);
      }).then(function (count) {
        assert.equal(count, 2);

        return pg.exec("DELETE FROM node_pg_test WHERE bar IS NULL");
      }).then(function (count) {
        assert.equal(count, 2);
        done();
      }).catch(function (err) {
        done(err);
      });
  });

  it('should return nulls correctly', function (done) {
    pg.execParams("INSERT INTO node_pg_test (_id, foo, bar, baz) VALUES($1,$2,$3,$4)",
                  [null, null, null, null])
      .then(function (count) {
        assert.equal(count, 1);

        return pg.execParams("INSERT INTO node_pg_test (_id, foo, bar, baz) VALUES($1,$2,$3,$4)",
                             [1, 'x', {bar: [2]}, new Date(2015, 0, 2)]);
      }).then(function (count) {
        assert.equal(count, 1);

        return pg.exec('SELECT * FROM node_pg_test');
      }).then(function (results) {
        var result = results[0];
        assert.equal(result._id, null);
        assert.equal(result.foo, null);
        assert.equal(result.bar, null);
        assert.equal(result.baz, null);

        result = results[1];
        assert.equal(result._id, 1);
        assert.equal(result.foo, 'x');
        assert.equal(result.bar.bar[0], 2);
        assert.equal(result.baz.getFullYear(), 2015);
        done();
      }).catch(function (err) {done(err)});
  });
});
