static napi_value init_copyToStream(napi_env env, napi_callback_info info,
                                    Conn* conn, size_t argc, napi_value args[]) {
  return init_execParams(env, info, conn, argc, args);
}
#define async_copyToStream async_execParams
#define done_copyToStream done_execParams
defAsync(copyToStream, 3);

typedef struct {
  Conn* conn;
  uv_sem_t sem;
  uv_thread_t thread;
  napi_threadsafe_function threadsafe_func;
  napi_ref ref;
  int readSize;
  int result;
  void *data;
  int length;
  int state;
} GetData;

static void async_getCopyData(void* data) {
  GetData *gd = data;
  char *buffer = NULL;
  int size = 0, pos = 0, length = 0;

  lockConn();
  int maxSize = gd->readSize;
  uv_sem_t* sem = &gd->sem;
  PGconn* pq = gd->conn->pq;

  for (;;) {
    unlockConn();
    uv_sem_wait(sem);
    lockConn();

    if (gd->result < 0) break;
    maxSize = gd->readSize;

    unlockConn();

    data = malloc(maxSize);
    length = 0;
    if (size > 0) {
      length = maxSize <= size ? maxSize : size;
      strncpy(data, buffer+pos, length);
      pos += length;
      size -= length;
    }
    if (size == 0 && length < maxSize) {
      if (buffer) PQfreemem(buffer);
      while ((size = PQgetCopyData(pq, &buffer, 0)) > 0) {
        pos = maxSize - length;
        strncpy(data+length, buffer, pos <= size ? pos : size);
        if (pos <= size) {
          length = maxSize;
          size -= pos;
          break;
        }

        PQfreemem(buffer);
        buffer = NULL;
        length += size;
      }
    }

    lockConn();
    if (gd->state != 0) {
      break;
    }

    gd->result = size;

    gd->data = data;
    gd->length = length;
    gd->state = 1;
    napi_status status = napi_call_threadsafe_function(gd->threadsafe_func, NULL, napi_tsfn_nonblocking);
    assert(status == napi_ok);
  }

  if (buffer) PQfreemem(buffer);

  if (size >=0) {
    cancel(gd->conn);
  }

  unlockConn();
}

static void freeCopyData(napi_env env, void* finalize_data, void* finalize_hint) {
  free(finalize_data);
}

static void copyOutCleanup(napi_env env, Conn* conn) {
  GetData *gd = conn->request;
  if (gd && gd->state != 2) {
    bool pushInProgress = gd->state == 1;
    gd->state = 2;
    conn->request = NULL;
    uv_sem_post(&gd->sem);
    assertok(napi_unref_threadsafe_function(env, gd->threadsafe_func));
    unlockConn();
    uv_thread_join(&gd->thread);
    lockConn();
    conn->copy_inprogress = 0;
    uv_sem_destroy(&gd->sem);
    if (! pushInProgress) {
      free(gd);
    }
  }
}

static void pushCopyData(napi_env env, napi_value js_callback, void* context, void* data) {
  lockConn();
  GetData *gd = context;

  if (gd->state == 2) {
    free(gd);
    unlockConn();
    return;
  }

  napi_value push = getRef(gd->ref);

  if (gd->length == 0) {
    callFunction(push, push, 0, NULL);
  } else {
    napi_value buffer;
    assertok(napi_create_external_buffer(env, gd->length, gd->data, freeCopyData, NULL, &buffer));
    napi_value args[] = {buffer};

    bool more = gd->length ? getBool(callFunction(push, push, 1, args)) : false;

    gd->data = NULL;
    gd->length = 0;

    gd->state = 0;
    if (gd->result < 0) {
      if (more) {
        callFunction(push, push, 0, NULL);
      }
    }
  }
  unlockConn();
}

static napi_value getCopyData(napi_env env, napi_callback_info info) {
  getConn();
  lockConn();
  GetData *gd = conn->request;

  getArgs(2);

  int32_t size = getInt32(args[1]);

  if (size == -1) {
    if (gd) {
      copyOutCleanup(env, conn);
    } else {
      cancel(conn);
    }
    unlockConn();
    return NULL;
  }

  if (gd) {
    if (gd->result < 0) {
      napi_value push = getRef(gd->ref);

      unlockConn();
      callFunction(push, push, 0, NULL);
      return NULL;
    }

  } else {
    gd = conn->request = calloc(1, sizeof(GetData));

    uv_sem_init(&gd->sem, 0);

    assertok(napi_create_reference(env, args[0], 1, &gd->ref));
    gd->conn = conn;

    assertok(napi_create_threadsafe_function
             (env, // napi_env env,
              NULL, // napi_value func,
              NULL, // napi_value async_resource,
              makeAutoString("pgGetCopyData"), // napi_value async_resource_name,
              0, // size_t max_queue_size,
              1, // size_t initial_thread_count,
              NULL, // void* thread_finalize_data,
              NULL, // napi_finalize thread_finalize_cb,
              gd, // void* context,
              pushCopyData, // napi_threadsafe_function_call_js call_js_cb,
              &gd->threadsafe_func // napi_threadsafe_function* result);
              ));
    uv_thread_create(&gd->thread, async_getCopyData, gd);
  }

  gd->readSize = size;
  uv_sem_post(&gd->sem);

  unlockConn();
  return NULL;
}
