napi_value init_copyFromStream(napi_env env, napi_callback_info info,
                               Conn* conn, size_t argc, napi_value args[]) {
  conn->copy_inprogress = true;
  return init_execParams(env, info, conn, argc, args);
}
#define async_copyFromStream async_execParams
#define done_copyFromStream done_execParams
defAsync(copyFromStream, 3)

typedef struct {
  void *data;
  size_t length;
  napi_ref ref;
  char* error;
} PutData;

napi_value init_putCopyData(napi_env env, napi_callback_info info,
                            Conn* conn, size_t argc, napi_value args[]) {
  PutData *putData = calloc(1, sizeof(PutData));
  assertok(napi_create_reference(env, args[0], 1, &putData->ref));
  assertok(napi_get_buffer_info(env,
                                args[0],
                                &putData->data,
                                &putData->length));
  conn->request = putData;
  return NULL;
}

void async_putCopyData(Conn* conn) {
  PutData *putData = conn->request;
  PGconn* pq = conn->pq;
  unlockConn(__FILE__,__LINE__);
  if (PQputCopyData(pq, putData->data, putData->length) == -1)
    putData->error = PQerrorMessage(pq);
  lockConn(__FILE__,__LINE__);
}

void done_putCopyData(napi_env env, Conn* conn, napi_value cb_args[]) {
  PutData* putData = conn->request;
  if (putData->ref != NULL) napi_delete_reference(env, putData->ref);
  if (putData->error != NULL) cb_args[0] = makeError(putData->error);
}

defAsync(putCopyData, 2)


napi_value init_putCopyEnd(napi_env env, napi_callback_info info,
                           Conn* conn, size_t argc, napi_value args[]) {
  PutData *putData =  calloc(1, sizeof(PutData));
  if (argc > 1 && jsType(args[0]) == napi_string) {
    putData->data = getString(args[0]);
  }
  conn->request = putData;
  return NULL;
}

void async_putCopyEnd(Conn* conn) {
  PutData* putData = conn->request;
  PGconn* pq = conn->pq;
  unlockConn(__FILE__,__LINE__);
  if (PQputCopyEnd(pq, putData->data) == -1)
    putData->error = PQerrorMessage(pq);
  lockConn(__FILE__,__LINE__);
}

void done_putCopyEnd(napi_env env, Conn* conn, napi_value cb_args[]) {
  PutData* putData = conn->request;
  if (putData->data != NULL) {
    free(putData->data);
    putData->data = NULL;
  }
  done_putCopyData(env, conn, cb_args);
}


defAsync(putCopyEnd, 2)
