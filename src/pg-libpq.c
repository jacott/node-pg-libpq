#include "pg-libpq.h"

static void Conn_destructor(napi_env env, void* nativeObject, void* finalize_hint) {
  Conn* conn = nativeObject;
  napi_delete_reference(env, conn->wrapper_);
  free(conn);
}

static napi_value Conn_constructor(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_value jsthis;
  assertok(napi_get_cb_info(env, info, &argc, args, &jsthis, NULL));

  double value = 0;

  napi_valuetype valuetype;
  assertok(napi_typeof(env, args[0], &valuetype));

  if (valuetype != napi_undefined)
    assertok(napi_get_value_double(env, args[0], &value));

  Conn* conn = calloc(1, sizeof(Conn));
  conn->state = PGLIBPQ_STATE_READY;

  assertok(napi_wrap(env,
                     jsthis,
                     conn,
                     Conn_destructor,
                     NULL,  // finalize_hint
                     &conn->wrapper_));

  return jsthis;
}

static napi_value init_connectDB(napi_env env, napi_callback_info info,
                          Conn* conn, size_t argc, napi_value args[]) {
  assert(conn->pq == NULL);
  conn->request = getString(args[0]);
  return NULL;
}

static void async_connectDB(Conn* conn) {
  void* request = conn->request;
  dm(conn, connectDB);
  unlockConn();
  PGconn* pq = PQconnectdb(request);
  lockConn();
  if (conn->state != PGLIBPQ_STATE_BUSY)
    return;
  conn->pq = pq;
  if (PQstatus(pq) == CONNECTION_OK) {
    PQsetClientEncoding(conn->pq, "utf-8");
  } else {
    dm(conn, connectDBFailed);
    conn->state = PGLIBPQ_STATE_ERROR;
  }
}

static void done_connectDB(napi_env env, Conn* conn, napi_value cb_args[]) {
  if (conn->state == PGLIBPQ_STATE_ERROR)
    cb_args[0] = makeError(PQerrorMessage(conn->pq));
}

defAsync(connectDB, 2)

typedef struct {
  char* cmd;
  char** params;
  uint32_t paramsLen;
  char* name;
} ExecArgs;

static void loadExecArgs(napi_env env, Conn* conn, napi_value cmdv, napi_value paramsv, napi_value namev) {
  uint32_t i;
  ExecArgs* ea = calloc(1, sizeof(ExecArgs));
  conn->request = ea;
  if (cmdv != NULL) ea->cmd = getString(cmdv);
  if (namev != NULL) ea->name = getString(namev);
  if (paramsv != NULL && isArray(paramsv)) {
    uint32_t len = arrayLength(paramsv);
    char** params = malloc(sizeof(char*)*len);
    for(i = 0; i < len; ++i) {
      napi_value v = getValue(paramsv, i);
      params[i] = jsType(v) == napi_string ?  getString(v) : NULL;
    }
    ea->params = params;
    ea->paramsLen = len;
  }
}

static void freeExecArgs(napi_env env, Conn* conn) {
  uint32_t i;
  ExecArgs* args = conn->request;
  if (args->cmd != NULL) free(args->cmd);
  if (args->name != NULL) free(args->name);
  char** params = args->params;
  if (params != NULL) {
    const size_t len = args->paramsLen;
    for(i = 0; i < len; ++i) {
      char* v = params[i];
      if (v != NULL) free(v);
    }
    free(params);
  }
}

static napi_value init_execParams(napi_env env, napi_callback_info info,
                           Conn* conn, size_t argc, napi_value args[]) {
  loadExecArgs(env, conn,
               argc > 0 ? args[0] : NULL,
               argc > 1 ? args[1] : NULL, NULL);
  return NULL;
}

static void async_execParams(Conn* conn) {
  ExecArgs* args = conn->request;
  PGconn* pq = conn->pq;
  unlockConn();
  if (args->params == NULL)
    conn->result = PQexec(pq, args->cmd);
  else
    conn->result = PQexecParams(pq, args->cmd,
                                args->paramsLen, NULL, (const char* const*)args->params,
                                NULL, NULL, 0);
  lockConn();
}

static void done_execParams(napi_env env, Conn* conn, napi_value cb_args[]) {
  freeExecArgs(env, conn);
}

defAsync(execParams, 3)

static napi_value init_prepare(napi_env env, napi_callback_info info,
                        Conn* conn, size_t argc, napi_value args[]) {
  loadExecArgs(env, conn,
               argc > 1 ? args[1] : NULL,
               NULL,
               argc > 0 ? args[0] : NULL);
  return NULL;
}

static void async_prepare(Conn* conn) {
  ExecArgs* args = conn->request;
  PGconn* pq = conn->pq;
  unlockConn();
  conn->result = PQprepare(pq, args->name, args->cmd, 0, NULL);
  lockConn();
}

#define done_prepare done_execParams

defAsync(prepare, 3)

static napi_value init_execPrepared(napi_env env, napi_callback_info info,
                             Conn* conn, size_t argc, napi_value args[]) {
  loadExecArgs(env, conn,
               NULL,
               argc > 1 ? args[1] : NULL,
               argc > 0 ? args[0] : NULL);
  return NULL;
}

static void async_execPrepared(Conn* conn) {
  ExecArgs* args = conn->request;
  PGconn* pq = conn->pq;
  unlockConn();
  conn->result = PQexecPrepared(pq, args->name,
                                args->paramsLen, (const char* const*)args->params,
                                NULL, NULL, 0);
  lockConn();
}
#define done_execPrepared done_execParams
defAsync(execPrepared, 3)

#include "copy-from-stream.h"

static napi_value escapeLiteral(napi_env env, napi_callback_info info) {
  getConn();
  getArgs(1);
  char* str = getString(args[0]);
  napi_value result =  makeAutoString(PQescapeLiteral(conn->pq, str, getStringLen(args[0])));
  free(str);
  return result;
}

static napi_value resultErrorField(napi_env env, napi_callback_info info) {
  getConn();
  size_t argc = 1;
  napi_value args[argc];
  assertok(napi_get_cb_info(env, info, &argc, args, NULL, NULL));

  char* res = conn->result == NULL
    ? NULL : PQresultErrorField(conn->result, getInt32(args[0]));
  if (res)
    return makeAutoString(res);
  else
    return getNull();
}

static char* cancel(Conn* conn) {
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

static napi_value finish(napi_env env, napi_callback_info info) {
  uv_mutex_lock(&waitingQueue.lock);
  getConn();
  lockConn();
  dm(conn, finish);
  if (conn->state == PGLIBPQ_STATE_BUSY || conn->copy_inprogress) {
    conn->state = PGLIBPQ_STATE_ABORT;
    char* errMsg = cancel(conn);
    if (errMsg) free(errMsg);
    unlockConn();
  } else {
    ASSERT_STATE(conn, READY);
    unlockConn();
    cleanup(env, conn);
  }
  uv_mutex_unlock(&waitingQueue.lock);

  return NULL;
}

static napi_value isReady(napi_env env, napi_callback_info info) {
  getConn();
  return makeBoolean(conn->state == PGLIBPQ_STATE_READY &&
                     ! conn->copy_inprogress);
}


#define defFunc(func) {#func, 0, func, 0, 0, 0, napi_default, 0}
#define defValue(name, value) {#name, 0, 0, 0, 0, value, napi_default, 0}

/* static void _addStatic(napi_env env, napi_value object, char* name, napi_callback func) { */
/*   napi_value result; */
/*   assertok(napi_create_function(env, name, NAPI_AUTO_LENGTH, func, NULL, &result)); */
/*   assertok(napi_set_named_property(env, object, name, result)); */
/* } */
/* #define addStatic(object, name) _addStatic(env, object, # name, name); */

static napi_value Init(napi_env env, napi_value exports) {
  napi_value PG;
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
                             &PG));

  uv_mutex_init(&gLock);
  initQueue(&waitingQueue);

  return PG;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
