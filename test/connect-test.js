const PG = require('../');
const assert = require('assert');

describe('connecting', ()=>{

  it('connects using defaults', done =>{
    const pg = new PG(err => {assert.ifError(err)});
    pg.exec("SELECT 1", (err, res) => {
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

  it('connects using tcp socket', done =>{
    new PG("host=localhost password=bad sslmode=disable")
      .then(()=>{assert(false, "should have thrown exception");})
      .catch(err =>{
        try {
          assert(/password authentication failed/.test(err.message), err.message);
          done();
        } catch(ex) {
          done(ex);
        }
      });
  });

  it('connects asynchronously', done =>{
    let me = true;
    let other = true;
    const pg = new PG("host=/var/run/postgresql");
    assert.equal(pg.isReady(), false);
    pg.then(() => {
      assert.equal(pg.isReady(), true);
      return pg.exec("SELECT 1 AS b, 'world' as hello");
    }).then(result => {
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
    const oPg = new PG("host=/var/run/postgresql");
    oPg
      .then(()=> oPg.exec("SELECT 'other' bad bad"))
      .catch(err =>{
        try {
          assert(/syntax/.test(err.message));
          assert.equal(err.sqlState, '42601');
          assert.equal(oPg.resultErrorField('SEVERITY'), 'ERROR');
          oPg.finish();
          other = false;
          me || done();
        } catch(ex) {
          done(ex);
        }
      });
  });
});
