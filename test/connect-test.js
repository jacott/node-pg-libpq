const PG = require('../');
const assert = require('assert');

describe('connecting', ()=>{
  let pg = null;
  after(()=>{
    pg && pg.finish();
    pg = null;
  });

  it('connects using defaults', done =>{
    pg = new PG(err => {err && done(err)});
    pg.exec(Buffer.from("SELECT 1"), (err, res) => {
      try {
        assert.ifError(err);
        assert.equal(res[0]['?column?'], 1);
        pg.finish();
        done();
      } catch(ex) {
        done(ex);
      }
    });
  });

  it('logs callback exceptions', done =>{
    const origLog = console.log;
    pg = new PG(err => {err && done(err)});
    let ex;
    after(()=>{console.log = origLog});
    console.error = (arg1, arg2) =>{
      try {
        assert.equal(arg1, 'Unhandled Error');
        assert.equal(arg2, ex);
        done();
      } catch(ex2) {
        done(ex2);
      }
    };
    pg.exec("SELECT 1", (err, res) => {
      throw ex = new Error('test');
    });
  });

  it('connects using tcp socket', async ()=>{
    try {
      pg = await PG.connect("host=localhost password=bad sslmode=disable");
    } catch(err) {
      assert(/password authentication failed/.test(err.message), err.message);
    }
  });

  it('connects asynchronously', done =>{
    let me = true;
    let other = true;
    const pg = PG.connect("host=/var/run/postgresql", err => {err && done(err)});
    assert.equal(pg.isReady(), false);
    pg.exec("SELECT 1 AS b, 'world' as hello").then(result => {
      assert.equal(pg.isReady(), true);
      assert.equal(JSON.stringify(result), JSON.stringify([{b: 1, hello: 'world'}]));
      return pg.exec("SELECT 2 AS x");

    }).then(result => {
      assert.equal(JSON.stringify(result), JSON.stringify([{x: 2}]));
      assert.equal(pg.isReady(), true);
      pg.finish();
      assert.equal(pg.isReady(), false);
      me = false;
      other || done();

    }).catch(done);
    const oPg = new PG("host=/var/run/postgresql", err => {err && done(err)});
    oPg.exec("SELECT 'other' bad bad")
     .catch(err =>{
       try {
         assert(/syntax/.test(err.message));
         assert.equal(err.sqlState, '42601');
         assert.equal(oPg.resultErrorField('SEVERITY'), 'ERROR');
         oPg.finish();
         other = false;
         me || done();
       } catch(ex) {
         oPg.finish();
         done(ex);
       }
     });
  });
});
