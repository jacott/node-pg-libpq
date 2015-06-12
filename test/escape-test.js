var PG = require('../');
var assert = require('assert');

describe('escaping', function() {
  var pg;
  before(function (done) {
    pg = new PG(function(err) {
      assert.ifError(err);
      done();
    });
  });

  after(function () {
    pg && pg.finish();
    pg = null;
  });

  it("should escape literals", function () {
    assert.equal(pg.escapeLiteral("John's dinner"), "'John''s dinner'");
    assert.equal(pg.escapeLiteral("234"), "'234'");
  });
});
