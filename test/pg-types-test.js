const PG = require('../');
const assert = require('assert');

const selectType = async (pg, type, it)=> (await pg.execParams(`SELECT $1::${type} as a`, [it]))[0].a;

describe('toSql', ()=>{
  it('should convert Uint8Array to hex', ()=>{
    assert.equal(PG.toSql(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 254, 255])),
                 '\\x000102030405060708feff');
  });
  it('should convert Buffer to hex', ()=>{
    assert.equal(PG.toSql(Buffer.from(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 254, 255]))),
                 '\\x000102030405060708feff');
  });
});

describe('sqlArray', ()=>{
  it('should convert nested', ()=>{
    assert.equal(PG.sqlArray([[[1,2,3]]]), '{{{1,2,3}}}');
    assert.equal(PG.sqlArray([[[{a: 1},{b: 2}]]]), '{{{"{\\"a\\":1}","{\\"b\\":2}"}}}');
  });

  it('should handle null', ()=>{
    assert.strictEqual(PG.sqlArray(), undefined);
    assert.strictEqual(PG.sqlArray(null), null);
  });
});

describe('return types', ()=>{
  let pg;
  before(done =>{
    pg = new PG(done);
  });

  after(()=>{
    pg && pg.finish();
    pg = null;
  });

  it('can register type', async ()=>{
    const int8 = PG.registerType(20, v => v/2);
    const varchar = PG.registerType(1015, v => v.toUpperCase());
    afterEach(()=>{
      PG.registerType(20, int8);
      PG.registerType(1015, varchar);
    });
    assert.equal(await selectType(pg, 'int8', 105), 52.5);
    assert.deepEqual(await selectType(pg, 'varchar[]', '{a,b}'), ['A', 'B']);
    assert.deepEqual(await selectType(pg, 'varchar[]', '{{a,b},{c,d}}'), [['A','B'], ['C','D']]);
  });

  it('should handle nested arrays', async ()=>{
    assert.deepStrictEqual(await selectType(pg, 'int2[]', '{}'), []);
    assert.deepStrictEqual(await selectType(pg, 'int2[]', '{{1,2},{3,4}}'), [[1,2], [3,4]]);
  });

  it('should convert binary', async ()=>{
    assert.equal(
      (await pg.execParams(
        "SELECT $1::bytea as a", [Buffer.from([0,1,2,255])]))[0].a.toString('hex'),
      '000102ff'
    );
    assert.deepEqual(
      (await pg.execParams(
        "SELECT $1::bytea[] as a", [PG.sqlArray([Buffer.from([0,1,2,255])])]))[0].a
        .map(v => v.toString('hex')),
      ['000102ff']
    );
  });

  it('should convert boolean', async ()=>{
    assert.strictEqual(await selectType(pg, 'bool', true), true);
    assert.strictEqual(await selectType(pg, 'bool', false), false);

    assert.deepStrictEqual(await selectType(pg, 'bool[]', '{t,f}'), [true, false]);
  });

  it('should convert numbers', async ()=>{
    assert.strictEqual(await selectType(pg, 'int2', 1234), 1234);
    assert.deepStrictEqual(await selectType(pg, 'int2[]', '{-1234,23}'), [-1234,23]);

    assert.strictEqual(await selectType(pg, 'int4', 1234), 1234);
    assert.deepStrictEqual(await selectType(pg, 'int4[]', '{-1234,23}'), [-1234,23]);

    assert.strictEqual(await selectType(pg, 'int8', Number.MAX_SAFE_INTEGER),
                       ''+Number.MAX_SAFE_INTEGER);
    assert.strictEqual(await selectType(pg, 'int8', 1234567891), 1234567891);
    assert.deepStrictEqual(await selectType(pg, 'int8[]', '{912345678912345,9123456789123456}'),
                           [912345678912345, '9123456789123456']);

    assert.strictEqual(await selectType(pg, 'oid', 1234), 1234);
    assert.deepStrictEqual(await selectType(pg, 'oid[]', '{1234,23}'), [1234,23]);

    assert.strictEqual(await selectType(pg, 'float4', 12.34), 12.34);
    assert.deepStrictEqual(await selectType(pg, 'float4[]', '{1234e-20,12.1,-0.45}'),
                           [1234e-20,12.1,-0.45]);

    assert.strictEqual(await selectType(pg, 'float8', -1234e-200), -1234e-200);
    assert.deepStrictEqual(await selectType(pg, 'float8[]', '{-1234e-200,2e200}'),
                           [-1234e-200, 2e200]);
  });

  it('should return strings', async ()=>{
    assert.strictEqual(await selectType(pg, 'text', 'hello'), 'hello');
    assert.deepStrictEqual(await selectType(pg, 'text[]', '{"hello world",1234}'),
                           ["hello world", "1234"]);

    assert.strictEqual(await selectType(pg, 'varchar', 'hello'), 'hello');
    assert.strictEqual(await selectType(pg, 'char', 'w'), 'w');
    assert.deepStrictEqual(await selectType(pg, 'char[]', '{h,e,l,"\\""}'),
                           'hel"'.split(''));
    assert.deepStrictEqual(await selectType(pg, 'varchar[]', '{"hello world",1234}'),
                           ["hello world", "1234"]);
  });

  it('should convert json', async ()=>{
    assert.strictEqual(await selectType(pg, 'json', true), true);
    assert.deepStrictEqual(await selectType(pg, 'json', [1,false,"a"]), [1,false,"a"]);

    assert.deepStrictEqual(await selectType(pg, 'json[]', '{"{\\"a\\": 1}","{\\"b\\": 2}"}'), [{a: 1}, {b: 2}]);

    assert.strictEqual(await selectType(pg, 'jsonb', true), true);
    assert.deepStrictEqual(await selectType(pg, 'jsonb', [1,false,"a"]), [1,false,"a"]);

    assert.deepStrictEqual(await selectType(pg, 'jsonb[]', '{"{\\"a\\": 1}","{\\"b\\": 2}"}'), [{a: 1}, {b: 2}]);
  });

  const assertDate = async (n, txt)=>{
    const d = new Date(n);
    assert.equal(+(await selectType(pg, 'timestamp', d)), +d);
    assert.equal((await selectType(pg, 'text', d)), txt);
  };

  it('should convert infinity dates', async ()=>{
    assert.equal((await selectType(pg, 'date', 'Infinity')),
                Infinity);

    assert.equal((await selectType(pg, 'date', '-Infinity')),
                -Infinity);
  });

  it('should convert dates', async ()=>{
    const year0 = -62135596800000;

    await assertDate(year0, '0001-01-01T00:00:00.000Z');
    await assertDate(year0, '0001-01-01T00:00:00.000Z');
    await assertDate(year0 + 1, '0001-01-01T00:00:00.001Z');
    await assertDate(year0 - 1, '0001-12-31T23:59:59.999 BC');
    await assertDate(0, '1970-01-01T00:00:00.000Z');
    await assertDate(-1, '1969-12-31T23:59:59.999Z');

    assert.equal((await selectType(pg, 'date', new Date(Date.UTC(2015, 6, 5)))).toISOString(),
                 '2015-07-05T00:00:00.000Z');

    assert.deepEqual((await selectType(pg, 'date[]', PG.sqlArray([new Date(Date.UTC(2015, 6, 5))])))
                     .map(d => d.toISOString()),
                 ['2015-07-05T00:00:00.000Z']);

    assert.equal(
      (await selectType(pg, 'timestamp',
                        new Date(Date.UTC(2016, 11, 24, 20, 58, 45, 123))))
        .toISOString(), "2016-12-24T20:58:45.123Z");

    assert.deepStrictEqual(
      (await selectType(pg, 'timestamp[]',
                        '{"2016-12-24T20:08:45.1Z", "2016-12-24T20:58:05.12Z","2015-12-24T20:58:45.123Z","January 8, 99 bc"}'))
        .map(d => +d === +d ? d.toISOString() : d),
      ["2016-12-24T20:08:45.100Z","2016-12-24T20:58:05.120Z", "2015-12-24T20:58:45.123Z", "-000098-01-08T00:00:00.000Z"]);
  });

  it('should convert timestamp with zone', async ()=>{
    await pg.exec("set timezone to 'NZ'");

    assert.equal(
      (await selectType(pg, 'timestamptz',
                        new Date(Date.UTC(2016, 11, 24, 20, 58, 45, 123))))
        .toISOString(), "2016-12-24T20:58:45.123Z");
    assert.deepStrictEqual(
      (await selectType(pg, 'timestamptz[]',
                        '{"January 8, 99 bc 20:57:45.123Z", "January 8, 1299 bc 20:57:45 NZDT"}'))
        .map(d => +d === +d ? d.toISOString() : d),
      ['-000098-01-08T20:57:45.123Z', '-001298-01-08T07:57:45.000Z']);

  });

  it('should return arrays', async ()=>{
    assert.deepStrictEqual(
      (await pg.exec("SELECT ARRAY[1,2,3] as array"))[0].array,
      [1,2,3]);

    const input = PG.sqlArray([
      "tricky,,{}}{\"\\string", null, "simpleString", 123, undefined, ",", "{", "}", "\\", "\""
    ]);
    assert.equal(input, `{"tricky,,{}}{\\"\\\\string",NULL,simpleString,123,NULL,",","{","}","\\\\","\\""}`);

    const result = await pg.execParams("SELECT $1::text[] as array", [input]);
    assert.deepStrictEqual(
      (await pg.execParams("SELECT $1::text[] as array", [input]))[0].array,
      [
        "tricky,,{}}{\"\\string", null, "simpleString", "123", null, ",", "{", "}", "\\", "\""
      ]);
  });

  it('should return objects', done =>{
    pg.exec("SELECT '{\"a\": 1, \"b\": [1,2]}'::jsonb as object").then(result => {
      const actObject = result[0].object;
      assert.equal(actObject.a, 1);
      assert.equal(actObject.b[0], 1);
      assert.equal(actObject.b[1], 2);
      assert.equal(actObject.b.length, 2);
    }).then(done, done);
  });

});
