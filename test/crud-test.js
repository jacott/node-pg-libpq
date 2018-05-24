const PG = require('../');
const assert = require('assert');

describe('crud', ()=>{
  let pg;
  before(async ()=>{
    pg = await PG.connect("host=/var/run/postgresql");
    await pg.exec("CREATE TEMPORARY TABLE node_pg_test (_id integer, foo text, bar jsonb, baz date)");
  });

  after(()=>{
    pg && pg.finish();
    pg = null;
  });

  afterEach(async ()=>{
    pg && await pg.exec("truncate node_pg_test");
  });

  it('should count updates and deletes', async ()=>{
    assert.equal(
      await pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                          [1, 'one', {one: 1}]), 1);

    assert.equal(
      await pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                          [2, 'two', {two: 2}]), 1);

    assert.equal((await pg.exec('SELECT * FROM node_pg_test')).length, 2);

    assert.equal(
      await pg.execParams("UPDATE node_pg_test SET foo = $2, bar = $3 WHERE _id = $1",
                          [1, 'two', {one: 2}]), 1);

    assert.equal(
      await pg.execParams("UPDATE node_pg_test SET bar = $2 WHERE foo = $1",
                          ['two', null]), 2);

    assert.equal(
      await pg.exec("DELETE FROM node_pg_test WHERE bar IS NULL"), 2);
  });

  it('should run execs consecutively', async ()=>{
    pg.execParams("INSERT INTO node_pg_test (_id, foo, bar) VALUES($1,$2,$3)",
                  [1, 'one', {one: 1}]);
    const rows = await pg.exec('SELECT 1 FROM node_pg_test');
    assert.equal(rows.length, 1);
  });

  it('should return nulls correctly', async ()=>{
    assert.equal(
      await pg.execParams("INSERT INTO node_pg_test (_id, foo, bar, baz) VALUES($1,$2,$3,$4)",
                    [null, null, null, null]), 1);

    assert.equal(
      await pg.execParams("INSERT INTO node_pg_test (_id, foo, bar, baz) VALUES($1,$2,$3,$4)",
                          [1, 'x', {bar: [2]}, new Date(2015, 0, 2)]), 1);

    const results = await pg.exec('SELECT * FROM node_pg_test');
    let result = results[0];
    assert.deepEqual(result, {});

    result = results[1];
    assert.equal(result._id, 1);
    assert.equal(result.foo, 'x');
    assert.equal(result.bar.bar[0], 2);
    assert.equal(result.baz.getFullYear(), 2015);
  });
});
