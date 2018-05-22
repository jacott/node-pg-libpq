#include "napi-helper.h"
#include <stdio.h>

#include <libpq-fe.h>
#include <pg_config.h>
#include "convert.h"

typedef struct Conn Conn;

typedef napi_value (*conn_async_init)(napi_env env, napi_callback_info info,
                                      Conn* conn, size_t argc, napi_value args[]);

typedef void (*conn_async_execute)(napi_env env, Conn* conn);

typedef void (*conn_async_complete)(napi_env env, napi_status status,
                                    Conn* conn, napi_value cb_args[]);

struct Conn {
  int state;
  bool copy_inprogress;
  PGconn* pq;
  void* request;
  PGresult* result;
  napi_ref wrapper_;
  napi_async_work work;
  napi_ref callback_ref;
  conn_async_execute execute;
  conn_async_complete complete;
};


#define PGLIBPQ_STATE_ABORT -2
#define PGLIBPQ_STATE_ERROR -1
#define PGLIBPQ_STATE_CLOSED 0
#define PGLIBPQ_STATE_READY 1
#define PGLIBPQ_STATE_BUSY 2

#define IS_CLOSED(conn) conn->state == PGLIBPQ_STATE_CLOSED

void throwStateError(napi_env env, const char* expect) {
  char buf[200];
  sprintf(buf, "Unexpected state; expecting %s", expect);
  assertok(napi_throw_error(env, "PGLIBPQ_STATE_ERROR", buf));
}

#define ASSERT_STATE(conn, expect)              \
  if(conn->state != PGLIBPQ_STATE_ ## expect) { \
    throwStateError(env, #expect);              \
    return NULL;                                \
  }

void clearResult(Conn* conn) {
  if (conn->result != NULL) {
    PQclear(conn->result);
    conn->result = NULL;
  }
}

static void cleanup(napi_env env, Conn* conn) {
  if (IS_CLOSED(conn)) return;

  if (conn->work != NULL) {
    assertok(napi_delete_async_work(env, conn->work));
    conn->work = NULL;
  }

  conn->state = PGLIBPQ_STATE_CLOSED;
  if (conn->callback_ref != NULL) {
    assertok(napi_delete_reference(env, conn->callback_ref));
  }
  clearResult(conn);
  PQfinish(conn->pq);
  conn->pq = NULL;
}

Conn* _getConn(napi_env env, napi_callback_info info) {
  napi_value jsthis;
  assertok(napi_get_cb_info(env, info, NULL, NULL, &jsthis, NULL));

  void* obj;
  assertok(napi_unwrap(env, jsthis, &obj));

  return obj;
}
#define getConn() Conn* conn = _getConn(env, info);

napi_value convertResult(napi_env env, Conn* conn) {
  PGresult* value = conn->result;
  const napi_value null = getNull();
  if (value == NULL) return null;
  napi_value result = null;
  switch(PQresultStatus(value)) {
  case PGRES_EMPTY_QUERY: break;
  case PGRES_BAD_RESPONSE: break;
  case PGRES_NONFATAL_ERROR: break;
  case PGRES_FATAL_ERROR: break;
  case PGRES_COMMAND_OK: {
    char* cmdTuplesStr = PQcmdTuples(value);
    if (cmdTuplesStr && strlen(cmdTuplesStr) > 0) {
      int64_t num;
      sscanf(cmdTuplesStr, "%ld", &num);
      assertok(napi_create_int64(env, num, &result));
    }
    return result;
  }
  case PGRES_COPY_IN: {
    return result;
  }
  default: {
    int row, col;
    const int64_t rowCount = PQntuples(value);
    const int64_t cCount = PQnfields(value);
    napi_value line;
    result = makeArray(2);
    const napi_value colData = makeArray(cCount);
    addValue(result, 0, colData);
    const napi_value rows = makeArray(rowCount);
    addValue(result, 1, rows);

    for(col = 0; col < cCount; ++col) {
      line = makeArray(2);
      addValue(line, 0, makeAutoString(PQfname(value, col)));
      addInt(line, 1, PQftype(value, col));
      /* addInt32(line, 2, PQfmod(value, col)); */
      addValue(colData, col, line);
    }
    for(row = 0; row < rowCount; ++row) {
      line = makeObject();
      for(col = 0; col < cCount; ++col) {
        if (! PQgetisnull(value, row, col))
          setProperty(line, PQfname(value, col),
                      convert(env, PQftype(value, col), PQgetvalue(value, row, col),
                              PQgetlength(value, row, col)));
      }
      addValue(rows, row, line);
    }
    return result;
  }
  }

  return makeError(PQerrorMessage(conn->pq));
}


void async_execute(napi_env env, void* data) {
  Conn* conn = data;
  conn->execute(env, conn);
}

void async_complete(napi_env env, napi_status status, void* data) {
  Conn* conn = data;
  bool isAbort = conn->state == PGLIBPQ_STATE_ABORT;

  const napi_value null = getNull();
  napi_value result = isAbort ? makeError("connection is closed") : convertResult(env, conn);
  const bool err = isError(result);

  napi_value cb_args[] = {err ? result : null, err ? null : result};

  conn->complete(env, status, conn, cb_args);

  if (! err) clearResult(conn);

  if (conn->request != NULL) {
    free(conn->request);
    conn->request = NULL;
  }

  napi_value callback;
  assertok(napi_get_reference_value(env, conn->callback_ref, &callback));
  assertok(napi_delete_reference(env, conn->callback_ref));
  conn->callback_ref = NULL;

  if (isAbort) {
    cleanup(env, conn);
  } else {
    conn->state = PGLIBPQ_STATE_READY;
  }

  napi_value global; assertok(napi_get_global(env, &global));
  napi_call_function(env, global, callback, 2, cb_args, &result);
}

napi_value runAsync(napi_env env, napi_callback_info info,
                    char* name, size_t argc,
                    conn_async_init init, conn_async_execute execute,
                    conn_async_complete complete) {
  getConn();
  ASSERT_STATE(conn, READY);
  conn->state = PGLIBPQ_STATE_BUSY;
  clearResult(conn);

  conn->execute = execute;
  conn->complete = complete;
  napi_value resource_id;
  napi_value args[argc];
  assertok(napi_get_cb_info(env, info, &argc, args, NULL, NULL));

  napi_value result = init(env, info, conn, argc, args);

  assertok(napi_create_reference(env, args[argc-1], 1, &conn->callback_ref));

  if (conn->work == NULL) {
    assertok(napi_create_string_latin1(env, quote(name), NAPI_AUTO_LENGTH, &resource_id));
    assertok(napi_create_async_work(env,
                                    NULL,
                                    resource_id,
                                    async_execute,
                                    async_complete,
                                    conn,
                                    &conn->work));
  }
  napi_queue_async_work(env, conn->work);
  return result;
}

#define defAsync(name, argc)                                            \
  napi_value name(napi_env env, napi_callback_info info) {              \
    return runAsync(env, info, quote(pg-libpq_ ## name), argc,          \
                    init_ ## name, async_ ## name,  done_ ## name);     \
  }
