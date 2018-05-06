const PG = require('../');
const assert = require('assert');

describe('escaping', ()=>{
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

  it("should escape literals", ()=>{
    assert.equal(pg.escapeLiteral("John's dinner"), "'John''s dinner'");
    assert.equal(pg.escapeLiteral("234"), "'234'");
  });
});
