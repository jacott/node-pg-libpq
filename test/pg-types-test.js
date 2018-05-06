const PG = require('../');
const assert = require('assert');

describe('return types', function() {
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


  it('should return numbers and strings', done =>{
    pg.exec("SELECT 1 AS number, 'text' as string", (err, result)=>{
      assert.ifError(err);
      assert.equal(result[0].number, 1);
      assert.equal(result[0].string, 'text');
      done();
    });
  });

  it('should return dates', done =>{
    pg.exec("SELECT DATE '2015-06-05' as date", (err, result)=> {
      assert.ifError(err);
      const actDate = result[0].date;
      assert.equal(actDate.getFullYear(), 2015);
      assert.equal(actDate.getMonth()+1, 6);
      assert.equal(actDate.getDate(), 5);
      done();
    });
  });

  it('should return arrays', done =>{
    pg.exec("SELECT ARRAY[1,2,3] as array", (err, result)=>{
      assert.ifError(err);
      const actArray = result[0].array;
      assert.equal(actArray[0], 1);
      assert.equal(actArray[1], 2);
      assert.equal(actArray[2], 3);
      assert.equal(actArray.length, 3);
      done();
    });
  });

  it('should return objects', done =>{
    pg.exec("SELECT '{\"a\": 1, \"b\": [1,2]}'::jsonb as object", (err, result)=>{
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
