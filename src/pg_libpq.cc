#include "pg_libpq.h"
#include "exec.h"

#include <sys/types.h>
#include <unistd.h>

#define PGLIBPQ_STATE_ABORT -2
#define PGLIBPQ_STATE_INIT -1
#define PGLIBPQ_STATE_CLOSED 0
#define PGLIBPQ_STATE_READY 1
#define PGLIBPQ_STATE_BUSY 2

#define IS_CLOSED(conn) conn->state == PGLIBPQ_STATE_CLOSED

#define ASSERT_STATE(conn, expect)                              \
  if(conn->state != PGLIBPQ_STATE_ ## expect) {                 \
    NanThrowError("connection not in " #expect " state");       \
    return;                                                     \
  }

#define MAP_COMMAND(method, queue)              \
  NAN_METHOD(method) {                          \
    NanScope();                                 \
    Conn* self = THIS();                        \
    ASSERT_STATE(self, READY);                  \
    self->state = PGLIBPQ_STATE_BUSY;           \
    queue(self, args);                          \
    NanReturnUndefined();                       \
  }


static void cleanup(Conn* conn) {
  if (IS_CLOSED(conn)) return;

  conn->state = PGLIBPQ_STATE_CLOSED;
  conn->setResult(NULL);
}

Conn::~Conn() {
  PQfinish(this->pq);
  cleanup(this); // in case finish was not called
}

void Conn::pqRef() {
  Ref();
}

void Conn::pqUnref() {
  Unref();
}

char* Conn::getErrorMessage() {
  return PQerrorMessage(pq);
}

char* Conn::newUtf8String(Handle<Value> from) {
  v8::Local<v8::String> toStr = from->ToString();
  int size = toStr->Utf8Length();
  char* buf = new char[size + 1];
  toStr->WriteUtf8(buf);
  return buf;
}

char** Conn::newUtf8StringArray(Handle<Array> params) {
  NanScope();

  int len = params->Length();

  char** res = new char*[len];

  for (int i = 0; i < len; i++) {
    Handle<Value> val = params->Get(i);
    if (val->IsNull()) {
      res[i] = NULL;
      continue;
    }
    res[i] = newUtf8String(val);
  }

  return res;
}

void Conn::deleteUtf8StringArray(char** array, int length) {
  for (int i = 0; i < length; i++) {
    delete [] array[i];
  }
  delete [] array;
}

NAN_METHOD(Conn::resultErrorField) {
  NanScope();

  Conn* conn = THIS();
  char* res = PQresultErrorField(conn->result, Local<Number>::Cast(args[0])->Value());
  if (res)
    NanReturnValue(NanNew<String>(res));
}

NAN_METHOD(Conn::setTypeConverter) {
  NanScope();

  Conn* self = THIS();
  if (self->typeConverter)
    delete self->typeConverter;
  self->typeConverter = new NanCallback(args[0].As<v8::Function>());
}

void Conn::setResult(PGresult* newResult) {
  if (result)
    PQclear(result);

  result = newResult;
}

PQAsync::PQAsync(Conn *conn, NanCallback* callback) :
  NanAsyncWorker(callback), conn(conn),
  result(NULL), colData(NULL), nextAction(NULL) {
  cmdTuples = rowCount = colCount = 0;
  conn->pqRef();
}

PQAsync::~PQAsync() {
  if (colData)
    free(colData);
  conn->pqUnref();
}

void PQAsync::setResult(PGresult* value) {
  char* cmdTuplesStr = NULL;
  result = value;
  switch(PQresultStatus(value)) {
  case PGRES_EMPTY_QUERY: break;
  case PGRES_BAD_RESPONSE: break;
  case PGRES_NONFATAL_ERROR: break;
  case PGRES_FATAL_ERROR: break;
  case PGRES_COMMAND_OK:
    cmdTuplesStr = PQcmdTuples(value);
    if (cmdTuplesStr && strlen(cmdTuplesStr) > 0) {
      sscanf(cmdTuplesStr, "%d", &cmdTuples);
    }
    return;
  case PGRES_COPY_IN: {
    return;
  }
  default: {
    rowCount = PQntuples(value);
    int cCount = colCount = PQnfields(value);
    colData = (ColumnData*) malloc(sizeof(ColumnData) * cCount);
    for(int col = 0; col < cCount; ++col) {
      ColumnData& cd = colData[col];
      cd.name = PQfname(value, col);
      cd.type = PQftype(value, col);
      cd.mod = PQfmod(value, col);
    }
    return;
  }
  }

  SetErrorMessage(PQerrorMessage(conn->pq));
}

void PQAsync::WorkComplete() {
  conn->setResult(result);
  if (conn->state == PGLIBPQ_STATE_BUSY)
    conn->state = PGLIBPQ_STATE_READY;
  NanAsyncWorker::WorkComplete();
  if (conn->state == PGLIBPQ_STATE_ABORT) {
    cleanup(conn);
  }
}

ConnectDB::ConnectDB(Conn* conn, char* params, NanCallback* callback)
  : PQAsync(conn, callback), params(params) {}

ConnectDB::~ConnectDB() {
  delete []params;
}

void ConnectDB::Execute() {
  PGconn* pq = conn->pq = PQconnectdb(params);

  ConnStatusType status = PQstatus(pq);

  if (status != CONNECTION_OK)
    SetErrorMessage(PQerrorMessage(pq));
}

NAN_METHOD(Conn::create) {
  NanScope();

  Conn* conn = new Conn();
  conn->state = PGLIBPQ_STATE_INIT;
  conn->copy_inprogress = false;
  conn->result = NULL;
  conn->typeConverter = NULL;
  conn->Wrap(args.This());

  NanReturnValue(args.This());
}

NAN_METHOD(Conn::connectDB) {
  NanScope();

  Conn* self = THIS();
  ASSERT_STATE(self, INIT);
  self->state = PGLIBPQ_STATE_BUSY;
  ConnectDB* async = new ConnectDB(self, newUtf8String(args[0]),
                                   new NanCallback(args[1].As<v8::Function>()));
  NanAsyncQueueWorker(async);
  NanReturnUndefined();
}

char* cancel(Conn* conn) {
  conn->copy_inprogress = false;
  PGcancel* handle = PQgetCancel(conn->pq);
  if (handle) {
    char* errbuf=(char*)malloc(256);
    int success = PQcancel(handle, errbuf, 256);
    PQfreeCancel(handle);

    if (success ||  *errbuf == '\0') {
      free(errbuf);
      return NULL;
    }
    return errbuf;
  }
  return NULL;
}

NAN_METHOD(Conn::isReady) {
  NanScope();

  Conn* conn = THIS();
  NanReturnValue(NanNew<v8::Boolean>(conn->state == PGLIBPQ_STATE_READY &&
                                     ! conn->copy_inprogress));
}

NAN_METHOD(Conn::finish) {
  NanScope();

  Conn* conn = THIS();

  if (conn->state == PGLIBPQ_STATE_BUSY || conn->copy_inprogress) {
    char* errMsg = cancel(conn);
    if (errMsg) free(errMsg);
    conn->state = PGLIBPQ_STATE_ABORT;

  } else {
    ASSERT_STATE(conn, READY);
    cleanup(conn);
  }

  NanReturnUndefined();
}

MAP_COMMAND(Conn::execParams, ExecParams::queue)
MAP_COMMAND(Conn::copyFromStream, CopyFromStream::queue)
MAP_COMMAND(Conn::putCopyData, CopyFromStream::putCopyData)
MAP_COMMAND(Conn::putCopyEnd, CopyFromStream::putCopyEnd)

void PQAsync::HandleOKCallback() {
  NanScope();

  Local<Value> cbArgs[] = {
    NanNull(),
    buildResult(),
  };

  callback->Call(2, cbArgs);
}

Handle<Value> PQAsync::buildResult() {
  PGresult* result = this->result;
  ExecStatusType resultType = PQresultStatus(result);
  if (resultType == PGRES_COMMAND_OK)
    return NanNew<Number>(cmdTuples);
  else {
    NanCallback& typeConverter = *conn->typeConverter;
    Local<Value> convArgs[2];

    int rCount = rowCount;
    Handle<Array> rows = NanNew<Array>(rCount);

    int cCount = colCount;
    ColumnData* cd = colData;
    Local<String> colNames[cCount];
    for(int ci = 0; ci < cCount; ++ci) {
      colNames[ci] = NanNew<String>(cd[ci].name);
    }

    for (int ri = 0; ri < rCount; ++ri) {
      Handle<Object> row = NanNew<Object>();
      for (int ci = 0; ci < cCount; ++ci) {
        if (PQgetisnull(result, ri, ci))
          row->Set(colNames[ci], NanNull());
        else {
          convArgs[0] = NanNew<Number>(cd[ci].type);
          convArgs[1] = NanNew<String>(PQgetvalue(result, ri, ci));
          row->Set(colNames[ci], typeConverter.Call(2, convArgs));
        }
      }
      rows->Set(ri, row);
    }
    return rows;
  }
}


void InitAll(Handle<Object> exports) {
  Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(Conn::create);
  tpl->SetClassName(NanNew("PGLibPQ"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  NODE_SET_PROTOTYPE_METHOD(tpl, "connectDB", Conn::connectDB);
  NODE_SET_PROTOTYPE_METHOD(tpl, "finish", Conn::finish);
  NODE_SET_PROTOTYPE_METHOD(tpl, "execParams", Conn::execParams);
  NODE_SET_PROTOTYPE_METHOD(tpl, "copyFromStream", Conn::copyFromStream);
  NODE_SET_PROTOTYPE_METHOD(tpl, "putCopyData", Conn::putCopyData);
  NODE_SET_PROTOTYPE_METHOD(tpl, "putCopyEnd", Conn::putCopyEnd);
  NODE_SET_PROTOTYPE_METHOD(tpl, "resultErrorField", Conn::resultErrorField);
  NODE_SET_PROTOTYPE_METHOD(tpl, "setTypeConverter", Conn::setTypeConverter);
  NODE_SET_PROTOTYPE_METHOD(tpl, "isReady", Conn::isReady);

  exports->Set(NanNew<String>("PGLibPQ"), tpl->GetFunction());
}

NODE_MODULE(addon, InitAll)
