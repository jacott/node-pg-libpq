#include "pg-libpq.h"

void Conn_destructor(napi_env env, void* nativeObject, void* finalize_hint) {
  napi_delete_reference(env, ((Conn*)nativeObject)->wrapper_);
  free(nativeObject);
}

napi_value Conn_constructor(napi_env env, napi_callback_info info) {
  napi_status status;

  size_t argc = 1;
  napi_value args[1];
  napi_value jsthis;
  status = napi_get_cb_info(env, info, &argc, args, &jsthis, NULL);
  assert(status == napi_ok);

  double value = 0;

  napi_valuetype valuetype;
  status = napi_typeof(env, args[0], &valuetype);
  assert(status == napi_ok);

  if (valuetype != napi_undefined) {
    status = napi_get_value_double(env, args[0], &value);
    assert(status == napi_ok);
  }

  Conn* conn = calloc(1, sizeof(Conn));
  conn->state = PGLIBPQ_STATE_READY;

  status = napi_wrap(env,
                     jsthis,
                     conn,
                     Conn_destructor,
                     NULL,  // finalize_hint
                     &conn->wrapper_);
  assert(status == napi_ok);

  return jsthis;
}

napi_value init_connectDB(napi_env env, napi_callback_info info,
                          Conn* conn, size_t argc, napi_value args[]) {
  assert(conn->pq == NULL);
  conn->request = getString(args[0]);
  return NULL;
}

void done_empty(napi_env env, napi_status status, Conn* conn, napi_value cb_args[]) {
}

void async_connectDB(napi_env env, Conn* conn) {
  conn->pq = PQconnectdb(conn->request);
  if (PQstatus(conn->pq) != CONNECTION_OK) {
    conn->state = PGLIBPQ_STATE_ERROR;
    conn->result = (PGresult*)conn->pq;
  }
}

#define done_connectDB done_empty

defAsync(connectDB, 2)

typedef struct {
  char* cmd;
  char** params;
  uint32_t paramsLen;
  char* name;
} ExecArgs;

void loadExecArgs(napi_env env, Conn* conn, napi_value cmdv, napi_value paramsv, napi_value namev) {
  ExecArgs* ea = calloc(1, sizeof(ExecArgs));
  conn->request = ea;
  if (cmdv != NULL) ea->cmd = getString(cmdv);
  if (namev != NULL) ea->name = getString(namev);
  if (paramsv != NULL && isArray(paramsv)) {
    uint32_t len = arrayLength(paramsv);
    char** params = malloc(sizeof(char*)*len);
    for(uint32_t i = 0; i < len; ++i) {
      napi_value v = getValue(paramsv, i);
      params[i] = jsType(v) == napi_string ?  getString(v) : NULL;
    }
    ea->params = params;
    ea->paramsLen = len;
  }
}

void freeExecArgs(napi_env env, Conn* conn) {
  ExecArgs* args = conn->request;
  if (args->cmd != NULL) free(args->cmd);
  if (args->name != NULL) free(args->name);
  char** params = args->params;
  if (params != NULL) {
    const size_t len = args->paramsLen;
    for(uint32_t i = 0; i < len; ++i) {
      char* v = params[i];
      if (v != NULL)free(v);
    }
    free(params);
  }
}

napi_value init_execParams(napi_env env, napi_callback_info info,
                          Conn* conn, size_t argc, napi_value args[]) {
  loadExecArgs(env, conn,
               argc > 0 ? args[0] : NULL,
               argc > 1 ? args[1] : NULL, NULL);
  return NULL;
}

void async_execParams(napi_env env, Conn* conn) {
  ExecArgs* args = conn->request;
  if (args->params == NULL)
    conn->result = PQexec(conn->pq, args->cmd);
  else
    conn->result = PQexecParams(conn->pq, args->cmd,
                                args->paramsLen, NULL, (const char* const*)args->params,
                                NULL, NULL, 0);
}

void done_execParams(napi_env env, napi_status status, Conn* conn, napi_value cb_args[]) {
  freeExecArgs(env, conn);
}

defAsync(execParams, 3)

napi_value init_prepare(napi_env env, napi_callback_info info,
                          Conn* conn, size_t argc, napi_value args[]) {
  loadExecArgs(env, conn,
               argc > 1 ? args[1] : NULL,
               NULL,
               argc > 0 ? args[0] : NULL);
  return NULL;
}

void async_prepare(napi_env env, Conn* conn) {
  ExecArgs* args = conn->request;
  conn->result = PQprepare(conn->pq, args->name, args->cmd, 0, NULL);
}

#define done_prepare done_execParams

defAsync(prepare, 3)

napi_value init_execPrepared(napi_env env, napi_callback_info info,
                          Conn* conn, size_t argc, napi_value args[]) {
  loadExecArgs(env, conn,
               NULL,
               argc > 1 ? args[1] : NULL,
               argc > 0 ? args[0] : NULL);
  return NULL;
}
void async_execPrepared(napi_env env, Conn* conn) {
  ExecArgs* args = conn->request;
  conn->result = PQexecPrepared(conn->pq, args->name,
                                args->paramsLen, (const char* const*)args->params,
                                NULL, NULL, 0);
}
#define done_execPrepared done_execParams
defAsync(execPrepared, 3)

#include "copy-from-stream.h"

napi_value escapeLiteral(napi_env env, napi_callback_info info) {
  getConn();
  getArgs(1);
  char* str = getString(args[0]);
  napi_value result =  makeString(PQescapeLiteral(conn->pq, str, getStringLen(args[0])));
  free(str);
  return result;
}

napi_value resultErrorField(napi_env env, napi_callback_info info) {
  getConn();
  size_t argc = 1;
  napi_value args[argc];
  assertok(napi_get_cb_info(env, info, &argc, args, NULL, NULL));

  char* res = conn->result == NULL
    ? NULL : PQresultErrorField(conn->result, getInt32(args[0]));
  if (res)
    return makeString(res);
  else
    return getNull();
}

char* cancel(Conn* conn) {
  conn->copy_inprogress = false;
  PGcancel* handle = PQgetCancel(conn->pq);
  if (handle) {
    char* errbuf = malloc(256);
    const int success = PQcancel(handle, errbuf, 256);
    PQfreeCancel(handle);

    if (success || *errbuf == '\0') {
      free(errbuf);
      return NULL;
    }
    return errbuf;
  }
  return NULL;
}

napi_value finish(napi_env env, napi_callback_info info) {
  getConn();
  if (conn->state == PGLIBPQ_STATE_BUSY || conn->copy_inprogress) {
    char* errMsg = cancel(conn);
    if (errMsg) free(errMsg);
    conn->state = PGLIBPQ_STATE_ABORT;

    napi_cancel_async_work(env, conn->work);
  } else {
    ASSERT_STATE(conn, READY);
    cleanup(env, conn);
  }

  return NULL;
}

napi_value isReady(napi_env env, napi_callback_info info) {
  getConn();
  return makeBoolean(conn->state == PGLIBPQ_STATE_READY &&
                     ! conn->copy_inprogress);
}

#define defFunc(func) {#func, 0, func, 0, 0, 0, napi_default, 0}

napi_value Init(napi_env env, napi_value exports) {
  napi_value new_exports;
  napi_property_descriptor properties[] = {
    defFunc(connectDB),
    defFunc(finish),
    defFunc(isReady),
    defFunc(execParams),
    defFunc(prepare),
    defFunc(execPrepared),
    defFunc(copyFromStream),
    defFunc(putCopyData),
    defFunc(putCopyEnd),
    defFunc(resultErrorField),
    defFunc(escapeLiteral),
  };
  assertok(napi_define_class(env,
                             "PGLibPQ",
                             NAPI_AUTO_LENGTH,
                             Conn_constructor,
                             NULL,
                             (size_t)sizeof(properties)/sizeof(napi_property_descriptor),
                             properties,
                             &new_exports));

  return new_exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
