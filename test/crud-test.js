const PG = require('../');
const assert = require('assert');

describe('crud', ()=>{
  let pg;
  before(done =>{
    pg = new PG("host=/var/run/postgresql");
    pg.exec("CREATE TEMPORARY TABLE node_pg_test (_id integer, foo text, bar jsonb, baz date)", done);
  });

  after(()=>{
    pg && pg.finish();
    pg = null;
  });

  afterEach(done =>{
    pg && pg.exec("truncate node_pg_test", done);
  });

  it('should count updates and deletes', done =>{
    pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                  [1, 'one', {one: 1}])
    .then(count =>{
      assert.equal(count, 1);
      return pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                           [2, 'two', {two: 2}]);

    }).then(count =>{
      assert.equal(count, 1);
      return pg.exec('SELECT * FROM node_pg_test');
    }).then(rows =>{
      assert.equal(rows.length, 2);
    }).then(()=>{
      return pg.execParams("UPDATE node_pg_test SET foo = $2, bar = $3 WHERE _id = $1",
                           [1, 'two', {one: 2}]);
    }).then(count =>{
      assert.equal(count, 1);
      return pg.execParams("UPDATE node_pg_test SET bar = $2 WHERE foo = $1",
                           ['two', null]);
    }).then(count =>{
      assert.equal(count, 2);

      return pg.exec("DELETE FROM node_pg_test WHERE bar IS NULL");
    }).then(count =>{
      assert.equal(count, 2);
      done();
    }).catch(done);
  });

  it('should run execs consecutively', done =>{
    pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                  [1, 'one', {one: 1}]);
    pg.exec('SELECT 1 FROM node_pg_test')
      .then(rows => rows.length)
      .catch(done)
      .then(rowsLength =>{
        assert.equal(rowsLength, 1);
        done();
      })
      .catch(done);
  });


  it('should return nulls correctly', done =>{
    pg.execParams("INSERT INTO node_pg_test (_id, foo, bar, baz) VALUES($1,$2,$3,$4)",
                  [null, null, null, null])
      .then(count =>{
        assert.equal(count, 1);

        return pg.execParams("INSERT INTO node_pg_test (_id, foo, bar, baz) VALUES($1,$2,$3,$4)",
                             [1, 'x', {bar: [2]}, new Date(2015, 0, 2)]);
      }).then(count =>{
        assert.equal(count, 1);

        return pg.exec('SELECT * FROM node_pg_test');
      }).then(results =>{
        let result = results[0];
        assert.deepEqual(result, {});

        result = results[1];
        assert.equal(result._id, 1);
        assert.equal(result.foo, 'x');
        assert.equal(result.bar.bar[0], 2);
        assert.equal(result.baz.getFullYear(), 2015);
        done();
      }).catch(done);
  });
});
