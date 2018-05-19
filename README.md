# node-pg-libpq

Native, interface to PostgreSQL through
[libpq](http://www.postgresql.org/docs/9.4/static/libpq.html). This module uses node's worker
threads to make this package asynchronous instead of libpq's async routines as they still sometimes
block but also makes the interface much simpler.

ES6 Promises are supported by not passing a callback to the query commands.

## Install

You must be using node 8 or higher.  You need libpq-dev installed and the `pg_config` program should
be in your path.  You may also need [node-gyp](https://github.com/TooTallNate/node-gyp) installed.

```sh
$ npm i node-pg-libpq
```

## Use

```js
const Libpq = require('pg-libpq');

const pgConn = new Libpq((err, pgConn) => {});
pgConn.exec("SELECT 'world' AS hello", (err, rows) => {
    console.log(rows);
    pgConn.finish();
});
```

or with promises

```js
const Libpq = require('pg-libpq');

const pgConn = new Libpq;
pgConn.exec("SELECT 'world' AS hello")
 .then(rows => {
    console.log(rows);
    pgConn.finish();
});
```


## API

Most methods have an optional callback. When no callback is supplied the method will return a
Promise.

### Connecting

This package does not include a connection pool. You can use
[generic-pool](https://www.npmjs.com/package/generic-pool) or similar like so:

```js
const Libpq = require('pg-libpq');
const poolModule = require('generic-pool');

const pool = poolModule.Pool({
  name: 'PostgreSQL',
  create(callback) {
    new Libpq("postgresql://localhost/testdb", callback);
  },
  destroy(pgConn) {
    pgConn.finish();
  },
  max: 10,
});
```

#### `new Libpq([conninfo], [function callback(err, pgConn)])`

Returns a connection (pgConn) to the database. `conninfo` is an optional string; see [libpq -
PQconnectdb](http://www.postgresql.org/docs/9.4/interactive/libpq-connect.html) for details.

If a callback function is supplied it is called with the database connection `pgConn` if successful
otherwise `err` explains why the connection failed.

#### `pgConn.finish()`

Cancels any command that is in progress and disconnects from the server. This pgConn instance is
unusable afterwards.

### Queries / Commands

See [libpq - Command execution functions](http://www.postgresql.org/docs/9.4/interactive/libpq-exec.html)

An exception will be thrown if more than one command at a time is sent to the same
pgConn.

#### `pgConn.isReady()`

Return true if connection is ready to receive a query/command.

#### `pgConn.then(function)`

Run function when the connection is ready. This method will wait for any currently running query
chain to finish.

#### `pgConn.resultErrorField(name)`

Returns an error field associated with the last error where `name` is string in upper case
corresponding to the `PG_DIAG_` fields but without the `PG_DIAG_` prefix; for example
`pgConn.resultErrorField('SEVERITY')`.

For convenience the `SQLSTATE` field is set on the last error as the field `sqlState`.

#### `pgConn.execParams(command, params, [callback])`

params are coverted to strings before passing to libpq. No type information is passed along with the
paramters; it is left for the PostgreSQL server to derive the type. Arrays are naturally converted to
json format but calling `PG.sqlArray(array)` will convert to array format `{1,2,3}`.

For updating calls such as INSERT, UPDATE and DELETE the callback will be called with the number of
rows affected. For SELECT it is called with an array of rows. Each row is a key/value pair object
where key is the column name and value is calculated using the
[pg-types](https://www.npmjs.com/package/pg-types) npm package. If the value is `null` no entry will
be given for that column.

#### `pgConn.exec(command, [callback])`

Same as `execParams` but with no params.

#### `pgConn.prepare(name, command, [callback])`

Create a prepared statement named `name`. Parameters are specified in the command the same as
`execParams`. To specify a type for params use the format `$n::type` where `n` is the parameter
position and `type` is the sql type; for example `$1::text`, `$2::integer[]`, `$3::jsonb`.  To
discard a prepared statement run `pgConn.exec('DEALLOCATE "name"')`.

#### `pgConn.execPrepared(name, params, [callback])`

The same as `execParams` except the prepared statment name, from `prepare`, is given instead of the
command.

#### `escaped = pgConn.escapeLiteral(string)`

Returns an escaped version of `string` including surrounding with single quotes. The escaping makes
an untrustworthy string safe to include as part of a sql query. It is preferable to use such strings
as a param in the `pgConn.execParams` command.

#### `stream = pgConn.copyFromStream(command, [params], callback)`

Copies data from a Writable stream into the database using the `COPY table FROM STDIN` statement.
There is no promise version of this command.

Example:

```js
const dbStream = pgConn.copyFromStream('COPY mytable FROM STDIN WITH (FORMAT csv) ',
    err =>{console.log("finished", err)});

dbStream.write('123,"name","address"\n');
dbStream.end();

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
* `PQgetCopyData`
* Binary format -- for sending and receiving fields as binary data instead of text.
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

Copyright (c) 2015-2018 Geoff Jacobsen <geoffjacobsen@gmail.com>

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
