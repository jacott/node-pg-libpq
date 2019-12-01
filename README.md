# node-pg-libpq

Native interface to PostgreSQL via
[libpq](https://www.postgresql.org/docs/current/static/libpq.html). This module uses independent
[libuv](https://http://docs.libuv.org) threads for each database connection which ensures that node
is not blocked while database activity is being processed.

ES6 Promises are supported by not passing a callback to the query commands.

## Install

You need to be using node 8.11 or higher.  You may need libpq development libraries installed and
the `pg_config` script should be in your executable path.

```sh
$ pg_config --version && npm i pg-libpq --save
```

## Use

```js
const PG = require('pg-libpq');

const client = PG.connect((err, client) => {});
client.exec("SELECT 'world' AS hello", (err, rows) => {
    console.log(rows);
    client.finish();
});
```

or with promises

```js
const PG = require('pg-libpq');

PG.connect().then(client => {
  client.exec("SELECT 'world' AS hello")
    .then(rows => {
      console.log(rows);
      client.finish();
    });
});
```

or with async/await

```js
const PG = require('pg-libpq');

(async ()=>{
  const client = await PG.connect();
  try {
    const rows = await client.exec("SELECT 'world' AS hello");
    console.log(rows);
  } finally {
    client.finish();
  }
})();
```

## API

Most methods have an optional callback. When no callback is supplied the method will return a
Promise.

### Connecting

This package does not include a connection pool. You can use
[generic-pool](https://www.npmjs.com/package/generic-pool) or similar like so:

```js
const PG = require('pg-libpq');
const genericPool = require('generic-pool');

const pool = genericPool.createPool({
  create() {
    return PG.connect("postgresql://localhost/testdb");
  },
  destroy(client) {
    client.finish();
  }
}, {max: 10});
```

#### `PG.connect([conninfo], [function callback(err, client)])`

Returns a connection `client` to the database. `conninfo` is an optional connection string; see
[libpq - Connection
strings](https://www.postgresql.org/docs/current/static/libpq-connect.html#LIBPQ-CONNSTRING) for
details.

#### `client.finish()`

Cancels any command that is in progress and disconnects from the server. The `client` instance is
unusable afterwards.

### Queries / Commands

See [libpq - Command execution functions](http://www.postgresql.org/docs/current/interactive/libpq-exec.html)

#### `client.isReady()`

Return true if `client` connection is established and is idle.

#### `client.isClosed()`

Return true if `client` connection is disconnected.

#### `client.resultErrorField(name)`

Returns an error field associated with the last error where `name` is string in upper case
corresponding to the `PG_DIAG_` fields but without the `PG_DIAG_` prefix; for example
`client.resultErrorField('SEVERITY')`.

For convenience the `SQLSTATE` field is set on the last error as the field `sqlState`.

#### `client.execParams(command, params, [callback])`

params are converted to strings before passing to libpq. No type information is passed along with the
parameters; it is left for the PostgreSQL server to derive the type. Arrays are naturally converted to
json format but calling `PG.sqlArray(array)` will convert to array format `{1,2,3}`.

For updating calls such as INSERT, UPDATE and DELETE the callback will be called with the number of
rows affected. For SELECT it is called with an array of rows. Each row is a key/value pair object
where key is the column name and value is the javascript equivalent to the postgres column types
listed below. If the value is `null` no entry will be given for that column.

The following types are automatically converted:

|js type|pg type  |(Oid) |
|-------|---------|------|
|boolean|bool     |(16)  |
|number |int2     |(21)  |
|       |int4     |(23)  |
|       |oid      |(26)  |
|       |int8<sup>*</sup> |(20)|
|float  |float4   |(700) |
|       |float8   |(701) |
|Buffer |bytea    |(17)  |
|object |json     |(114) |
|       |jsonb    |(3807)|
|Date   |date     |(1802)|
|       |time     |(1802)|
|       |timestamp|(1114)|


<sup>*</sup> int8 is converted only if the text length is <= 15

Arrays of the above types are also converted. All other types will be returned in text format unless
a type converter is registered (see [PG.registerType](#pgregistertypetypeoid-parsefunction)):


#### `client.exec(command, [callback])`

Same as `execParams` but with no params.

#### `client.prepare(name, command, [callback])`

Create a prepared statement named `name`. Parameters are specified in the command the same as
`execParams`. To specify a type for params use the format `$n::type` where `n` is the parameter
position and `type` is the sql type; for example `$1::text`, `$2::integer[]`, `$3::jsonb`.  To
discard a prepared statement run `client.exec('DEALLOCATE "name"')`.

#### `client.execPrepared(name, params, [callback])`

The same as `execParams` except the prepared statement name, from `prepare`, is given instead of the
command.

#### `escaped = client.escapeLiteral(string)`

Returns an escaped version of `string` including surrounding with single quotes. The escaping makes
an untrustworthy string safe to include as part of a sql query. It is preferable to use such strings
as a param in the `client.execParams` command.

#### `stream = client.copyFromStream(command, [params], callback)`

Copies data from a Writable stream into the database using the `COPY table FROM STDIN` statement.
There is no promise version of this command.

Example:

```js
const dbStream = client.copyFromStream('COPY mytable FROM STDIN WITH (FORMAT CSV) ',
    err => {console.log("finished", err)});

dbStream.write('123,"name","address"\n');
dbStream.end();
```

#### `stream = client.copyToStream(command)`

Copies data to a Readable stream from the database using the `COPY table TO STDOUT` statement.

Example:

```js
const dbStream = client.copyToStream('COPY mytable TO STDOUT WITH (FORMAT CSV, HEADER)');

dbStream.on('error', err => {
  console.error(err);
});

dbStream.on('end', () => {
  console.log("copy finished"); // will now execute next query
})

dbStream.on('readable', () => {
  let chunk;
  while (null !== (chunk = sbStream.read())) {
    console.log(`Received ${chunk.length} bytes of data.`);
  }
});
```


### Utility methods

#### `textValue = PG.sqlArray(jsArray)`

Turn a Javascript Array into a text value suitable as an array parameter.

#### `PG.registerType(typeOid, parseFunction)`

Register a function that will convert values of the given `typeOid` into the desired type. For array
typeOids the parseFunction is the same as the non-array typeOid; it is not responsible for parsing
the array format. Calling `registerType` without a parseFunction will de-register the typeOid.

The previous parseFunction (if any) is returned.

Note: most primitive types are converted natively before being parsed.

Example:

```js
    const toUpper v => v.toUpperCase();
    const prev = PG.registerType(1015, toUpper);
    PG.registerType(1043, toUpper);

    const rows = await pg.exec(`SELECT 'hello'::varchar AS a, '{a,b}'::varchar[] AS b`);
    assert.equal(rows[0].a, 'HELLO');
    assert.deepEqual(rows[0].b, ['A', 'B']);
```

### Not implemented

* `PQdescribePrepared`
* `PQdescribePortal`
* Retrieving Query Results Row-By-Row. Use cursors instead.
* Asynchronous Notification -- LISTEN, UNLISTEN, NOTIFY


## Testing / Developing

```sh
$ tools/run-tests
```

To run the tests you need a PostgreSQL back-end reachable by typing `psql` with no connection
parameters in your terminal. The tests expect PostgreSQL to be running on the same machine as the
tests.


## License

The MIT License (MIT)

Copyright (c) 2015-2019 Geoff Jacobsen <geoffjacobsen@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
