# node-pg-libpq

Native, asynchronous, non-blocking interface to PostgreSQL through
[libpq](http://www.postgresql.org/docs/9.4/static/libpq.html). This module uses node's worker
threads to make this package asynchronous instead of libpq's async routines as they stil sometimes
block but also makes the interface much simpler. I also had trouble using
[node-libpq](https://github.com/brianc/node-libpq) because the asynchronous reading logic somehow
blocked other node events such as http server listen and Promises.

This library is currently incomplete and onlu implements the features I need. For instance COPY
commands do not work. I will accept PRs though.

## Install

You need libpq installed & the `pg_config` program should be in your path.  You also need [node-gyp](https://github.com/TooTallNate/node-gyp) installed.

```sh
$ npm i node-pg-libpq
```

## Use

```js
var Libpq = require('pg-libpq');
new Libpq(function (err, pg) {
    pg.exec("Select 'world' as hello", function(err, rows) {
       console.log(rows);
       pg.finish();
    });
});
```

## API

### connecting

#### `new Libpq([conninfo], function callback(err, pg))`

conninfo is optional; see [libpq -
PQconnectdb](http://www.postgresql.org/docs/9.4/interactive/libpq-connect.html) for
details. Connects to server and passes the connection to the callback.

#### `pg.finish()`

Disconnects from the server. pg is unusable after this.

### Queries

See [libpq -
Command execution functions](http://www.postgresql.org/docs/9.4/interactive/libpq-exec.html)

## testing

```sh
$ tools/run-tests
```

To run the tests you need a PostgreSQL backend reachable by typing `psql` with no connection parameters in your terminal. The tests expect PostgreSQL to be running on the same machine as the tests.


## license

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
