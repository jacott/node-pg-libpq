const PG = require('../');
const assert = require('assert');
const fs = require('fs');

describe('copy streaming', ()=>{
  let pg;
  beforeEach(done =>{
    pg = new PG(err =>{
      if (err) done(err);
      pg.exec("CREATE TEMPORARY TABLE node_pg_test (_id integer, foo text, bar date)",  (err, count)=>{
        done(err);
      });
    });
  });

  afterEach(()=>{
    pg && pg.finish();
    pg = null;
  });

  it("can cancel in progress", done =>{
    let wasReady;
    assert.equal(pg.isReady(), true);
    const dbStream = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', err =>{
      assert.equal(err.message, 'connection is closed');
      assert.equal(err.sqlState, '08003');
      assert.equal(wasReady, false);
      assert.equal(pg.isReady(), false);
      dbStream.on('error', error =>{
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
    setTimeout(()=>{
      try {
        wasReady = pg.isReady();
        dbStream.write('456,"line 2","2015-02-02"\n');
        pg.finish();
      } catch(ex) {
        done(ex);
      }
    }, 10);
  });

  it("should handle nesting", done =>{
    const dbStream = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', err =>{
      assert.ifError(err);
      if (! pg) return;
      const dbStream2 = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', err =>{
        done(err);
      });
      dbStream2.write('123,"name","2015-03-03"\n');
      dbStream2.end();
    });
    dbStream.write('123,"name","2015-11-18"\n');
    dbStream.write('456,"another","2010-05-18"\n');
    dbStream.end();
  });

  it("should copy from buffer", done =>{
    const fromFilename = __filename.replace(/\.js$/, '-from-data.csv');
    const fromStream = fs.createReadStream(fromFilename);
    const dbStream = pg.copyFromStream('COPY node_pg_test FROM STDIN WITH (FORMAT csv) ', err =>{
      assert.ifError(err);
      pg.exec('SELECT * FROM node_pg_test WHERE _id = 2',  (err, rows)=>{
        try {
          assert.ifError(err);
          assert.equal(rows[0].foo, 'row 2');
          assert.equal(rows[0].bar.getDate(), 2);
          done();
        } catch(ex) {
          done(ex);
        }
      });
    });
    fromStream.on('error', failError);
    fromStream.pipe(dbStream).on('error', failError);
  });
});

const failError = err=>{
  assert.ifError(err);
  assert(false, 'expected error');
};
