const PG = require('../');
const assert = require('assert');

describe('execParams', ()=>{
  let pg;
  before(done =>{
    pg = new PG(err =>{
      assert.ifError(err);
      done();
    });
  });

  after(()=>{
    pg && pg.finish();
    pg = null;
  });

  it('should accept numbers and strings', done =>{
    pg.execParams("SELECT $1::integer AS number, $2::text as string", [1, 'text'], (err, result)=>{
      assert.ifError(err);
      assert.equal(result[0].number, 1);
      assert.equal(result[0].string, 'text');
      done();
    });
  });

  it('should accept utc dates', done =>{
    const utcdate = new Date(Date.UTC(2015, 2, 30));
    pg.execParams("SELECT $1::date as utcdate", [utcdate], (err, result)=>{
      assert.ifError(err);
      var actDate = result[0].utcdate;
      assert.equal(actDate.getUTCFullYear(), 2015);
      assert.equal(actDate.getUTCMonth()+1, 3);
      assert.equal(actDate.getUTCDate(), 30);
      done();
    });
  });

  it('should accept arrays', done =>{
    const array = [1,2,3];
    pg.execParams("SELECT $1::integer[] as array", [pg.sqlArray(array)], (err, result)=>{
      assert.ifError(err);
      const actArray = result[0].array;
      assert.equal(actArray[0], 1);
      assert.equal(actArray[1], 2);
      assert.equal(actArray[2], 3);
      assert.equal(actArray.length, 3);
      done();
    });
  });

  it('should accept objects', done =>{
    const json = {a: 1, b: [1,2]};
    pg.execParams("SELECT $1::jsonb as object", [json], (err, result)=>{
      assert.ifError(err);
      const actObject = result[0].object;
      assert.equal(actObject.a, 1);
      assert.equal(actObject.b[0], 1);
      assert.equal(actObject.b[1], 2);
      assert.equal(actObject.b.length, 2);
      done();
    });
  });

});
