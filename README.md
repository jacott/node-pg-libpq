# node-pg-libpq

Native, asynchronous, non-blocking interface to PostgreSQL through
[libpq](http://www.postgresql.org/docs/9.4/static/libpq.html). This module uses node's worker
threads to make this package asynchronous instead of libpq's async routines as they still sometimes
block but also makes the interface much simpler. I also had trouble using
[node-libpq](https://github.com/brianc/node-libpq) because the asynchronous reading logic somehow
blocked other node events such as http server listen and Promises.

This library is lower level than [node-postgres](https://github.com/brianc/node-postgres) but higher
 than [node-libpq](https://github.com/brianc/node-libpq) hence the name node-pg-libpq. It
 makes use of [node-pg-types](https://github.com/brianc/node-pg-types).

This library is currently incomplete and only implements the features I need. For instance the `COPY
TO STDOUT` command is not present yet. I will accept PRs though.

ES6 Promises are supported by not passing a callback to the query commands. Note that older versions
of node may need a Promise npm to be installed to use promises.

## Install

You need libpq installed and the `pg_config` program should be in your path.  You also need
[node-gyp](https://github.com/TooTallNate/node-gyp) installed.

```sh
$ npm i node-pg-libpq
```

## Use

```js
var Libpq = require('pg-libpq');
new Libpq(function (err, pgConn) {
    pgConn.exec("SELECT 'world' AS hello", function(err, rows) {
       console.log(rows);
       pgConn.finish();
    });
});
```

or with promises

```js
var Libpq = require('pg-libpq');
var pgConn = new Libpq;
pgConn.then(function () {
    return pgConn.exec("SELECT 'world' AS hello");
}).then(function (rows) {
    console.log(rows);
    pgConn.finish();
});
```


## API

### Connecting

#### `new Libpq([conninfo], [function callback(err, pgConn)])`

conninfo is optional; see [libpq -
PQconnectdb](http://www.postgresql.org/docs/9.4/interactive/libpq-connect.html) for
details. Connects to server and passes the connection, to the callback, or as the `promise.then`
argument if no callback is given.

#### `pgConn.finish()`

Cancels any command that is in progress and disconnects from the server. This pgConn instance is
unusable afterwards.

### Queries / Commands

See [libpq -
Command execution functions](http://www.postgresql.org/docs/9.4/interactive/libpq-exec.html)

An exception will be thrown if more than one command at a time is sent to
pgConn. **`pgConn.isReady()`** returns false if a command is currently in progress.

Most methods have an optional callback. When no callback is supplied the method will return a
`Promise`.

#### `pgConn.resultErrorField(name)`

Returns an error field associated with the last error where `name` is string in upper case
corresponding to the `PG_DIAG_` fields but without the `PG_DIAG_` prefix; for example
`pgConn.resultErrorField('SEVERITY')`.

For convenience the `SQLSTATE` field is set on the last error as the field `sqlState`.

#### `pgConn.execParams(command, params, [callback])`

params are coverted to strings before passing to libpq. No type information is passed along with the
paramters; it is left for the PostgreSQL server to derive the type. Arrays are naturally converted to
json format but calling `pgConn.sqlArray(array)` will convert to array format `{1,2,3}`.

#### `pgConn.exec(command, [callback])`

Same as `execParams` but with no params.

#### `stream = pgConn.copyFromStream(command, [params], callback)`

Copies data from a Writable stream into the database using the `COPY table FROM STDIN` statement.
There is no promise version of this command.

Example:

```js
var dbStream = pgConn.copyFromStream('COPY mytable FROM STDIN WITH (FORMAT csv) ',
      function (err) {console.log("finished", err)});

dbStream.write('123,"name","address"\n');
dbStream.end();
```

## Testing / Developing

```sh
$ tools/run-tests
```

To run the tests you need a PostgreSQL back-end reachable by typing `psql` with no connection
parameters in your terminal. The tests expect PostgreSQL to be running on the same machine as the
tests.


## License

The MIT License (MIT)

Copyright (c) 2015 Geoff Jacobsen <geoffjacobsen@gmail.com>

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
