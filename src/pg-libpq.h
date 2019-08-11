#include "napi-helper.h"
#include <uv.h>

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
  bool copy_inprogress;
  void* request;
  uv_thread_t thread;
  uv_mutex_t qlock;
  napi_ref wrapper_;
  napi_ref callback_ref;
  conn_async_execute execute;
  conn_async_complete complete;
};

uv_mutex_t gLock;


#define lockConn(fn, ln) {uv_mutex_lock(&gLock);}
#define unlockConn(fn, ln) {uv_mutex_unlock(&gLock);}

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

ConnQueue waitingQueue;

static napi_threadsafe_function threadsafe_func;
static int threadsafe_func_count;

void initQueue(ConnQueue* queue) {
  queue->head = queue->tail = NULL;
  uv_mutex_init(&queue->lock);
}

void queueAddConn(ConnQueue* queue, Conn* conn) {
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

Conn* queueRmHead(ConnQueue* queue) {
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

void queueRmNode(ConnQueue* queue, NextConn* node, NextConn* prev) {
  NextConn* next = node->next;
  if (prev == NULL) {
    queue->head = next;
  } else {
    prev->next = next;
  }
  if (next == NULL) {
    queue->tail = prev;
  }
  free(node);
}

void queueRmConn(ConnQueue* queue, Conn* conn) {
  NextConn* prev = NULL;
  uv_mutex_lock(&queue->lock);
  for(NextConn* node = queue->head; node; prev = node, node = node->next) {
    if (node->conn == conn) {
      queueRmNode(queue, node, prev);
      break;
    }
  }
  uv_mutex_unlock(&queue->lock);
}

void thread_finalize_cb(napi_env env,
                              void* finalize_data,
                              void* finalize_hint) {
  threadsafe_func = NULL;
}

static void runCallbacks(napi_env env, napi_value js_callback, void* context, void* data);

void ref_threadsafe_func(napi_env env) {
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

void unref_threadsafe_func(napi_env env) {
  if (--threadsafe_func_count == 0)
    assertok(napi_unref_threadsafe_function(env, threadsafe_func));
}


/** static values **/
// static napi_ref sv_ref;

typedef enum {
  sv_max,
} sv_prop;

/* napi_value _sref(napi_env env, sv_prop index) { */
/*   return getValue(getRef(sv_ref), index); */
/* } */
/* #define srefValue(index) _sref(env, index) */


#define PGLIBPQ_STATE_ABORT -2
#define PGLIBPQ_STATE_ERROR -1
#define PGLIBPQ_STATE_CLOSED 0
#define PGLIBPQ_STATE_READY 1
#define PGLIBPQ_STATE_BUSY 2

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

static void freeCallbackRef(napi_env env, Conn* conn) {
  if (conn->callback_ref != NULL) {
    assertok(napi_delete_reference(env, conn->callback_ref));
    conn->callback_ref = NULL;
  }
}

static void cleanup(napi_env env, Conn* conn) {
  lockConn(__FILE__,__LINE__);
  if (conn->state == PGLIBPQ_STATE_CLOSED) return;

  conn->state = PGLIBPQ_STATE_CLOSED;

  freeCallbackRef(env, conn);
  clearResult(conn);
  if (conn->pq != NULL) {
    dm(conn, unlock,__FILE__,__LINE__);
    uv_mutex_unlock(&conn->qlock);
    unlockConn(__FILE__,__LINE__);
    uv_thread_join(&conn->thread);
    unref_threadsafe_func(env);
    dm(conn, PQfinish,__FILE__,__LINE__);
    PQfinish(conn->pq);
    conn->pq = NULL;
    dm(conn, unlock,__FILE__,__LINE__);
    uv_mutex_unlock(&conn->qlock);
    dm(conn, destroy,__FILE__,__LINE__);
    uv_mutex_destroy(&conn->qlock);
  }
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


void async_execute(void* data) {
  Conn* conn = data;
  while(true) {
    dm(conn, lock,__FILE__,__LINE__);
    uv_mutex_lock(&conn->qlock);
    dm(conn, **,__FILE__,__LINE__);
    lockConn(__FILE__,__LINE__);
    if (conn->state != PGLIBPQ_STATE_BUSY) {
      unlockConn(__FILE__,__LINE__);
      return;
    }
    conn->execute(conn);
    uv_mutex_lock(&waitingQueue.lock);
    if (waitingQueue.head == NULL)
      assertok(napi_call_threadsafe_function(threadsafe_func, NULL, napi_tsfn_nonblocking));
    queueAddConn(&waitingQueue, conn);
    uv_mutex_unlock(&waitingQueue.lock);

    unlockConn(__FILE__,__LINE__);
  }
}

void async_complete(napi_env env, napi_status status, void* data) {
  Conn* conn = data;
  lockConn(__FILE__,__LINE__);
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
    dm(conn, isAbort,__FILE__,__LINE__);
    unlockConn(__FILE__,__LINE__);
    cleanup(env, conn);
  } else {
    conn->state = PGLIBPQ_STATE_READY;
    unlockConn(__FILE__,__LINE__);
  }
  assertok(napi_call_function(env, getGlobal(), callback, 2, cb_args, &result));
}

static void runCallbacks(napi_env env, napi_value js_callback, void* context, void* data) {
  Conn* conn;
  while((conn = queueRmHead(&waitingQueue))) {
    async_complete(env, 0, conn);
  }
}

void queueJob(napi_env env, Conn* conn) {
  if (conn->pq == NULL) {
    uv_mutex_init(&conn->qlock);
    dm(conn, init,__FILE__,__LINE__);
    ref_threadsafe_func(env);
    uv_thread_create(&conn->thread, async_execute, conn);
  } else {
    dm(conn, unlock,__FILE__,__LINE__);
    uv_mutex_unlock(&conn->qlock);
  }
}

napi_value runAsync(napi_env env, napi_callback_info info,
                    char* name, size_t argc,
                    conn_async_init init, conn_async_execute execute,
                    conn_async_complete complete) {
  getConn();
  lockConn(__FILE__,__LINE__);
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

  unlockConn(__FILE__,__LINE__);
  return result;
}

#define defAsync(name, argc)                                            \
  napi_value name(napi_env env, napi_callback_info info) {              \
    return runAsync(env, info, quote(pg-libpq_ ## name), argc,          \
                    init_ ## name, async_ ## name,  done_ ## name);     \
  }
