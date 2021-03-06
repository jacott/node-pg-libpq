#include "napi-helper.h"
#include <uv.h>

#include <time.h>
#include <libpq-fe.h>
#include <pg_config.h>
#include "convert.h"

typedef struct Conn Conn;

typedef napi_value (*conn_async_init)(napi_env env, napi_callback_info info,
                                      Conn* conn, size_t argc, napi_value args[]);

typedef void (*conn_async_execute)(Conn* conn);

typedef void (*conn_async_complete)(napi_env env,
                                    Conn* conn, napi_value cb_args[]);
struct Conn {
  PGconn* pq;
  int state;
  PGresult* result;
  char copy_inprogress;
  void* request;
  uv_thread_t thread;
  uv_sem_t sem;
  napi_ref wrapper_;
  napi_ref callback_ref;
  conn_async_execute execute;
  conn_async_complete complete;
};

uv_mutex_t gLock;


#define lockConn() {uv_mutex_lock(&gLock);}
#define unlockConn() {uv_mutex_unlock(&gLock);}

typedef struct NextConn NextConn;

struct NextConn {
  Conn* conn;
  NextConn* next;
};

typedef struct {
  NextConn* head;
  NextConn* tail;
  uv_mutex_t lock;
} ConnQueue;

static ConnQueue waitingQueue;

static napi_threadsafe_function threadsafe_func;
static int threadsafe_func_count;

static void initQueue(ConnQueue* queue) {
  queue->head = queue->tail = NULL;
  uv_mutex_init(&queue->lock);
}

static void queueAddConn(ConnQueue* queue, Conn* conn) {
  NextConn* node = malloc(sizeof(NextConn));
  node->conn = conn;
  node->next = NULL;
  if (queue->head == NULL) {
    queue->head = queue->tail = node;
  } else {
    queue->tail->next = node;
    queue->tail = node;
  }
}

static Conn* queueRmHead(ConnQueue* queue) {
  Conn* conn = NULL;
  uv_mutex_lock(&queue->lock);
  NextConn* node = queue->head;
  if (node) {
    queue->head = node->next;
    if (! queue->head) queue->tail = NULL;

    conn = node->conn;
    free(node);
  }
  uv_mutex_unlock(&queue->lock);
  return conn;
}

static void thread_finalize_cb(napi_env env,
                              void* finalize_data,
                              void* finalize_hint) {
  threadsafe_func = NULL;
}

static void runCallbacks(napi_env env, napi_value js_callback, void* context, void* data);

static void ref_threadsafe_func(napi_env env) {
  if (threadsafe_func == NULL) {

    assertok(napi_create_threadsafe_function
             (env, // napi_env env,
              NULL, // napi_value func,
              NULL, // napi_value async_resource,
              makeAutoString("pgCallback"), // napi_value async_resource_name,
              0, // size_t max_queue_size,
              1, // size_t initial_thread_count,
              NULL, // void* thread_finalize_data,
              thread_finalize_cb, // napi_finalize thread_finalize_cb,
              NULL, // void* context,
              runCallbacks, // napi_threadsafe_function_call_js call_js_cb,
              &threadsafe_func // napi_threadsafe_function* result);
              ));
    threadsafe_func_count = 1;
  } else if (++threadsafe_func_count == 1) {
    assertok(napi_ref_threadsafe_function(env, threadsafe_func));
  }
}

static void unref_threadsafe_func(napi_env env) {
  if (--threadsafe_func_count == 0)
    assertok(napi_unref_threadsafe_function(env, threadsafe_func));
}

#define PGLIBPQ_STATE_ABORT -2
#define PGLIBPQ_STATE_ERROR -1
#define PGLIBPQ_STATE_CLOSED 0
#define PGLIBPQ_STATE_READY 1
#define PGLIBPQ_STATE_BUSY 2

static void throwStateError(napi_env env, const char* expect) {
  char buf[200];
  sprintf(buf, "Unexpected state; expecting %s", expect);
  assertok(napi_throw_error(env, "PGLIBPQ_STATE_ERROR", buf));
}

#define ASSERT_STATE(conn, expect)              \
  if(conn->state != PGLIBPQ_STATE_ ## expect) { \
    throwStateError(env, #expect);              \
    return NULL;                                \
  }

static void clearResult(Conn* conn) {
  if (conn->result != NULL) {
    PQclear(conn->result);
    conn->result = NULL;
  }
}

static void freeCallbackRef(napi_env env, Conn* conn) {
  if (conn->callback_ref != NULL) {
    assertok(napi_delete_reference(env, conn->callback_ref));
    conn->callback_ref = NULL;
  }
}

static void cancel(Conn* conn) {
  conn->copy_inprogress = 0;
  PGcancel* handle = PQgetCancel(conn->pq);
  if (handle) {
    char errbuf[1];
    PQcancel(handle, errbuf, 1);
    PQfreeCancel(handle);
  }
}

static void cleanup(napi_env env, Conn* conn) {
  lockConn();
  if (conn->state == PGLIBPQ_STATE_CLOSED) return;

  conn->state = PGLIBPQ_STATE_CLOSED;

  freeCallbackRef(env, conn);
  clearResult(conn);
  if (conn->pq != NULL) {
    dm(conn, post);
    uv_sem_post(&conn->sem);
    unlockConn();
    uv_thread_join(&conn->thread);
    unref_threadsafe_func(env);
    dm(conn, PQfinish);
    PQfinish(conn->pq);
    conn->pq = NULL;
    dm(conn, unlock);
    dm(conn, destroy);
    uv_sem_destroy(&conn->sem);
  }
}

static Conn* _getConn(napi_env env, napi_callback_info info) {
  napi_value jsthis;
  assertok(napi_get_cb_info(env, info, NULL, NULL, &jsthis, NULL));

  void* obj;
  assertok(napi_unwrap(env, jsthis, &obj));

  return obj;
}
#define getConn() Conn* conn = _getConn(env, info);

static napi_value convertResult(napi_env env, Conn* conn) {
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
    conn->copy_inprogress = 1;
    return result;
  }
  case PGRES_COPY_OUT: {
    conn->copy_inprogress = 2;
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


static void async_execute(void* data) {
  lockConn();

  Conn* conn = data;
  uv_sem_t* sem = &conn->sem;
  while(true) {
    unlockConn();
    dm(conn, wait);
    uv_sem_wait(sem);
    lockConn();
    if (conn->state != PGLIBPQ_STATE_BUSY) {
      unlockConn();
      return;
    }
    conn->execute(conn);
    uv_mutex_lock(&waitingQueue.lock);
    if (waitingQueue.head == NULL)
      napi_call_threadsafe_function(threadsafe_func, NULL, napi_tsfn_nonblocking);
    queueAddConn(&waitingQueue, conn);
    uv_mutex_unlock(&waitingQueue.lock);
  }
}

void async_complete(napi_env env, napi_status status, void* data) {
  Conn* conn = data;
  lockConn();
  bool isAbort = conn->state == PGLIBPQ_STATE_ABORT;

  const napi_value null = getNull();
  napi_value result = isAbort ? makeError("connection is closed") : convertResult(env, conn);
  const bool err = isError(result);

  napi_value cb_args[] = {err ? result : null, err ? null : result};

  conn->complete(env, conn, cb_args);

  if (! err) clearResult(conn);


  if (conn->request != NULL) {
    free(conn->request);
    conn->request = NULL;
  }

  napi_value callback = getRef(conn->callback_ref);
  freeCallbackRef(env, conn);

  if (isAbort) {
    dm(conn, isAbort);
    unlockConn();
    cleanup(env, conn);
  } else {
    conn->state = PGLIBPQ_STATE_READY;
    unlockConn();
  }
  callFunction(getGlobal(), callback, 2, cb_args);
}

static void runCallbacks(napi_env env, napi_value js_callback, void* context, void* data) {
  Conn* conn;
  while((conn = queueRmHead(&waitingQueue))) {
    async_complete(env, 0, conn);
  }
}

static void queueJob(napi_env env, Conn* conn) {
  if (conn->pq == NULL) {
    dm(conn, init);
    uv_sem_init(&conn->sem, 1);
    ref_threadsafe_func(env);
    uv_thread_create(&conn->thread, async_execute, conn);
  } else {
    dm(conn, post);
    uv_sem_post(&conn->sem);
  }
}

static napi_value runAsync(napi_env env, napi_callback_info info,
                    char* name, size_t argc,
                    conn_async_init init, conn_async_execute execute,
                    conn_async_complete complete) {
  getConn();
  lockConn();
  ASSERT_STATE(conn, READY);
  conn->state = PGLIBPQ_STATE_BUSY;
  clearResult(conn);

  conn->execute = execute;
  conn->complete = complete;

  napi_value args[argc];
  assertok(napi_get_cb_info(env, info, &argc, args, NULL, NULL));

  assertok(napi_create_reference(env, args[argc-1], 1, &conn->callback_ref));
  napi_value result = init(env, info, conn, argc, args);

  queueJob(env, conn);

  unlockConn();
  return result;
}

#define defAsync(name, argc)                                            \
  napi_value name(napi_env env, napi_callback_info info) {              \
    return runAsync(env, info, quote(pg-libpq_ ## name), argc,          \
                    init_ ## name, async_ ## name,  done_ ## name);     \
  }
