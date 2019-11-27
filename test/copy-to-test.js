const PG = require('../');
const assert = require('assert');
const fs = require('fs');

describe('copy to streaming', ()=>{
  let pg;
  before(async ()=>{
    pg = await PG.connect();
    await pg.exec("CREATE TEMPORARY TABLE node_pg_test (_id integer, foo text, bar date)");
    await pg.exec("insert into node_pg_test values(1,'a','2019/11/27')");
    await pg.exec(`insert into node_pg_test values(2,'b','2019/11/28')`);
    await pg.exec(`insert into node_pg_test values(3,'c','2019/10/01')`);
  });

  after(()=>{
    pg.finish();
    pg = null;
  });

  it("should allow multiple pushes", async ()=>{
    const dbStream = pg.copyToStream('COPY node_pg_test TO STDOUT WITH (FORMAT csv, header)');
    const orig_read = dbStream._read;
    let ans = '';
    let res;
    try {
      dbStream.push = data =>{
        ans += data.toString();
        res();
        return false;
      };
      dbStream._read = (size)=>{
      };
      const mkp = (resolve, reject)=>{res = resolve};
      orig_read.call(dbStream, 16);
      await new Promise(mkp);
      assert.equal(ans, '_id,foo,bar\n1,a,');
      orig_read.call(dbStream, 4);
      await new Promise(mkp);
      assert.equal(ans, '_id,foo,bar\n1,a,2019');
      orig_read.call(dbStream, 9);
      await new Promise(mkp);
      assert.equal(ans, '_id,foo,bar\n1,a,2019-11-27\n2,');
      dbStream.destroy(); // before query finished
      const sel = await pg.exec("select count(*) from node_pg_test");
      assert.equal(sel[0].count, 3);
    } finally {
      dbStream.destroy();
    }
  });

  it("should handle just one line and push", async ()=>{
    const dbStream = pg.copyToStream('COPY (select * from node_pg_test where _id = 1) TO STDOUT');
    const orig_read = dbStream._read;
    let ans = '';
    let res;
    try {
      dbStream.push = data =>{
        if (data === null) {
          dbStream.destroy();
          return false;
        }
        ans += data.toString();
        res();
        return false;
      };
      dbStream._read = (size)=>{
      };
      const mkp = (resolve, reject)=>{res = resolve};
      orig_read.call(dbStream, 100);
      await new Promise(mkp);
      assert.equal(ans, '1\ta\t2019-11-27\n');
      orig_read.call(dbStream, 100);
      const sel = await pg.exec("select count(*) from node_pg_test");
      assert.equal(sel[0].count, 3);
    } finally {
      dbStream.destroy();
    }
  });

  it("should copy to stream", async ()=>{
    const dbStream = pg.copyToStream('COPY node_pg_test TO STDOUT WITH (FORMAT csv, header)');
    let ans = '';
    dbStream.on('data', chunk =>{
      ans += chunk;
    });
    const sel = pg.exec("select count(*) from node_pg_test");
    await new Promise((resolve, reject)=>{
      dbStream.on('end', resolve);
      dbStream.on('error', reject);
    });
    assert.deepEqual(ans, `_id,foo,bar
1,a,2019-11-27
2,b,2019-11-28
3,c,2019-10-01
`);
    assert.equal((await sel)[0].count, 3);
  });

  it("should hanlde empty result", async ()=>{
    const dbStream = pg.copyToStream('COPY (select * from node_pg_test where _id = 0) TO STDOUT');
    let ans = '';
    dbStream.on('data', chunk =>{
      ans += chunk;
    });
    await new Promise((resolve, reject)=>{
      dbStream.on('end', resolve);
      dbStream.on('error', reject);
    });
    assert.equal(ans, '');
  });


  it("should handle wrong query", async ()=>{
    const dbStream = pg.copyToStream(
      `select _id from node_pg_test where foo = 'a'`
    );
    let ans = '';
    dbStream.on('data', chunk =>{
      ans += chunk;
    });
    const err = await new Promise((resolve, reject)=>{
      dbStream.on('end', () => reject(new Error("expected error")));
      dbStream.on('error', resolve);
    });
    assert.equal(err.sqlState, void 0);
    assert.equal(err.message, 'Not a COPY_OUT result');
  });

  it("should handle syntax errors", async ()=>{
    const dbStream = pg.copyToStream(
      `COPY (select _id from node_pg_test where fooz = 'a') TO STDOUT`
    );
    let ans = '';
    dbStream.on('data', chunk =>{
      ans += chunk;
    });
    const err = await new Promise((resolve, reject)=>{
      dbStream.on('end', () => reject(new Error("expected error")));
      dbStream.on('error', resolve);
    });
    assert.equal(err.sqlState, '42703');
    assert(/"fooz" does not exist/.test(err.message));
  });

  it("should cancel in progress", async ()=>{
    const dbStream = pg.copyToStream(
      `COPY node_pg_test TO STDOUT`
    );
    let ans = '';
    dbStream.on('data', chunk =>{
      ans += chunk;
    });
    const err = await new Promise((resolve, reject)=>{
      dbStream.on('end', () => reject(new Error("expected error")));
      dbStream.on('error', resolve);
      pg.finish();
    });
    assert.equal(err.sqlState, '08003');
    assert.equal(ans, '');
  });
});

const failError = err=>{
  assert.ifError(err);
  assert(false, 'expected error');
};
