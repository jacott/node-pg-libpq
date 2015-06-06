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

This library is currently incomplete and only implements the features I need. For instance COPY
commands do not work. I will accept PRs though.

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

## API

### Connecting

#### `new Libpq([conninfo], function callback(err, pgConn))`

conninfo is optional; see [libpq -
PQconnectdb](http://www.postgresql.org/docs/9.4/interactive/libpq-connect.html) for
details. Connects to server and passes the connection to the callback.

#### `pgConn.finish()`

Disconnects from the server. pgConn is unusable after this.

### Queries

See [libpq -
Command execution functions](http://www.postgresql.org/docs/9.4/interactive/libpq-exec.html)

#### `pgConn.resultErrorField(name)`

Returns an error field associated with the last error where `name` is string in upper case
corresponding to the `PG_DIAG_` fields but without the `PG_DIAG_` prefix; for example
`pgConn.resultErrorField('SEVERITY')`.

For convenience the `SQLSTATE` field is set on the last error as the field `sqlState`.

#### `pgConn.execParams(command, params, callback)`

params are coverted to strings before passing to libpq. No type information is passed along with the
paramters; it is left for the PostgreSQL server to derive the type. Arrays a naturally converted to
json format but calling `pgConn.sqlArray(array)` will convert to array format `{1,2,3}`.

#### `pgConn.exec(command, callback)`

Same as `execParams` but with no params.

## Testing

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
