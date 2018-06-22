const PG = require('../');
const assert = require('assert');

describe('execPrepared', ()=>{
  let pg;
  before(done =>{
    pg = new PG(done);
  });

  after(()=>{
    pg && pg.finish();
    pg = null;
  });

  it('should accept numbers and strings', done =>{
    pg.prepare("p1", "SELECT $1::integer AS number, $2::text as string")
      .then(()=> pg.execPrepared("p1", [1, 'text']))
      .then(result =>{
        assert.equal(result[0].number, 1);
        assert.equal(result[0].string, 'text');
        return pg.execPrepared("p1", [4, 'foo']);
      }).then(result =>{
        assert.equal(result[0].number, 4);
        assert.equal(result[0].string, 'foo');
      }).then(done, done);
  });

  it('should convert args to strings', done =>{
    pg.prepare(Buffer.from("p2"), {toString: ()=> "SELECT $1::integer AS number, $2::text as string"})
      .then(()=> pg.execPrepared({toString: () => "p2"}, [1, 'text']))
      .then(result =>{
        assert.equal(result[0].number, 1);
        assert.equal(result[0].string, 'text');
      }).then(done, done);
  });
});
