const PG = require('../');
const assert = require('assert');

describe('escaping', ()=>{
  let pg;
  before(done =>{
    pg = PG.connect('', done);
  });

  after(()=>{
    pg && pg.finish();
    pg = null;
  });

  it("should escape literals", ()=>{
    assert.equal(pg.escapeLiteral("John's dinner"), "'John''s dinner'");
    assert.equal(pg.escapeLiteral("234"), "'234'");
    assert.equal(pg.escapeLiteral(234), "'234'");
  });
});
