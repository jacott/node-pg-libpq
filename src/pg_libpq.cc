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
    Nan::ThrowError("connection not in " #expect " state");     \
    return;                                                     \
  }

#define MAP_COMMAND(method, queue)              \
  NAN_METHOD(method) {                          \
    Nan::HandleScope();                         \
    Conn* self = THIS();                        \
    ASSERT_STATE(self, READY);                  \
    self->state = PGLIBPQ_STATE_BUSY;           \
    queue(self, info);                          \
    info.GetReturnValue().SetUndefined();       \
  }


static void cleanup(Conn* conn) {
  if (IS_CLOSED(conn)) return;

  conn->state = PGLIBPQ_STATE_CLOSED;
  conn->setResult(NULL);
  PQfinish(conn->pq);
}

Conn::~Conn() {
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
  const int size = toStr->Utf8Length();
  char* buf = new char[size + 1];
  toStr->WriteUtf8(buf);
  return buf;
}

char** Conn::newUtf8StringArray(Handle<Array> params) {
  Nan::HandleScope();

  const int len = params->Length();

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

NAN_METHOD(Conn::escapeLiteral) {
  Nan::HandleScope();

  const Conn* conn = THIS();

  const char *str = Conn::newUtf8String(info[0]);
  const unsigned int len = Local<String>::Cast(info[0])->Length();
  char* res = PQescapeLiteral(conn->pq, str, len);
  if (res) {
    Nan::MaybeLocal<String> jsres = Nan::New<String>(res);
    PQfreemem(res);
    info.GetReturnValue().Set(jsres.ToLocalChecked());
  } else {
    Nan::ThrowError(PQerrorMessage(conn->pq));
  }
}

NAN_METHOD(Conn::resultErrorField) {
  Nan::HandleScope();

  const Conn* conn = THIS();
  const char* res = PQresultErrorField(conn->result, Local<Number>::Cast(info[0])->Value());
  if (res)
    info.GetReturnValue().Set(Nan::New<String>(res).ToLocalChecked());
  else
    info.GetReturnValue().SetUndefined();
}

NAN_METHOD(Conn::setTypeConverter) {
  Nan::HandleScope();

  Conn* self = THIS();
  if (self->typeConverter)
    delete self->typeConverter;
  self->typeConverter = new Nan::Callback(info[0].As<v8::Function>());
}

void Conn::setResult(PGresult* newResult) {
  if (result)
    PQclear(result);

  result = newResult;
}

PQAsync::PQAsync(Conn *conn, Nan::Callback* callback) :
  Nan::AsyncWorker(callback), conn(conn),
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
    const int cCount = colCount = PQnfields(value);
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
  Nan::AsyncWorker::WorkComplete();
  if (conn->state == PGLIBPQ_STATE_ABORT) {
    cleanup(conn);
  }
}

ConnectDB::ConnectDB(Conn* conn, char* params, Nan::Callback* callback)
  : PQAsync(conn, callback), params(params) {}

ConnectDB::~ConnectDB() {
  delete []params;
}

void ConnectDB::Execute() {
  PGconn* pq = conn->pq = PQconnectdb(params);

  if (PQstatus(pq) != CONNECTION_OK)
    SetErrorMessage(PQerrorMessage(pq));
}

NAN_METHOD(Conn::create) {
  Nan::HandleScope();

  Conn* conn = new Conn();
  conn->state = PGLIBPQ_STATE_INIT;
  conn->copy_inprogress = false;
  conn->result = NULL;
  conn->typeConverter = NULL;
  conn->Wrap(info.This());

  info.GetReturnValue().Set(info.This());
}

NAN_METHOD(Conn::connectDB) {
  Nan::HandleScope();

  Conn* self = THIS();
  ASSERT_STATE(self, INIT);
  self->state = PGLIBPQ_STATE_BUSY;
  ConnectDB* async = new ConnectDB(self, newUtf8String(info[0]),
                                   new Nan::Callback(info[1].As<v8::Function>()));
  Nan::AsyncQueueWorker(async);
  info.GetReturnValue().SetUndefined();
}

char* cancel(Conn* conn) {
  conn->copy_inprogress = false;
  PGcancel* handle = PQgetCancel(conn->pq);
  if (handle) {
    char* errbuf=(char*)malloc(256);
    const int success = PQcancel(handle, errbuf, 256);
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
  Nan::HandleScope();

  const Conn* conn = THIS();
  info.GetReturnValue().Set(Nan::New<v8::Boolean>(conn->state == PGLIBPQ_STATE_READY &&
                                                  ! conn->copy_inprogress));
}

NAN_METHOD(Conn::finish) {
  Nan::HandleScope();

  Conn* conn = THIS();

  if (conn->state == PGLIBPQ_STATE_BUSY || conn->copy_inprogress) {
    char* errMsg = cancel(conn);
    if (errMsg) free(errMsg);
    conn->state = PGLIBPQ_STATE_ABORT;

  } else {
    ASSERT_STATE(conn, READY);
    cleanup(conn);
  }

  info.GetReturnValue().SetUndefined();
}

MAP_COMMAND(Conn::execParams, ExecParams::queue)
MAP_COMMAND(Conn::prepare, PreparedStatement::prepare)
MAP_COMMAND(Conn::execPrepared, PreparedStatement::execPrepared)
MAP_COMMAND(Conn::copyFromStream, CopyFromStream::queue)
MAP_COMMAND(Conn::putCopyData, CopyFromStream::putCopyData)
MAP_COMMAND(Conn::putCopyEnd, CopyFromStream::putCopyEnd)

void PQAsync::HandleOKCallback() {
  Nan::HandleScope();

  Local<Value> cbArgs[] = {
    Nan::Null(),
    buildResult(),
  };

  callback->Call(2, cbArgs);
}

Handle<Value> PQAsync::buildResult() {
  PGresult* result = this->result;
  ExecStatusType resultType = PQresultStatus(result);
  if (resultType == PGRES_COMMAND_OK)
    return Nan::New<Number>(cmdTuples);
  else {
    const Nan::Callback& typeConverter = *conn->typeConverter;
    const int rCount = rowCount;
    const int cCount = colCount;
    const ColumnData* cd = colData;

    Local<Value> convArgs[2];
    Handle<Array> rows = Nan::New<Array>(rCount);

    for (int ri = 0; ri < rCount; ++ri) {
      Handle<Object> row = Nan::New<Object>();
      for (int ci = 0; ci < cCount; ++ci) {
        if (! PQgetisnull(result, ri, ci)) {
          convArgs[0] = Nan::New<Number>(cd[ci].type);
          convArgs[1] = Nan::New<String>(PQgetvalue(result, ri, ci)).ToLocalChecked();
          Nan::Set(row, Nan::New<String>(cd[ci].name).ToLocalChecked(), typeConverter.Call(2, convArgs));
        }
      }
      rows->Set(ri, row);
    }
    return rows;
  }
}


NAN_MODULE_INIT(InitAll) {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(Conn::create);
  tpl->InstanceTemplate()->SetInternalFieldCount(1);
  tpl->SetClassName(Nan::New("PGLibPQ").ToLocalChecked());

  Nan::SetPrototypeMethod(tpl, "connectDB", Conn::connectDB);
  Nan::SetPrototypeMethod(tpl, "finish", Conn::finish);
  Nan::SetPrototypeMethod(tpl, "execParams", Conn::execParams);
  Nan::SetPrototypeMethod(tpl, "prepare", Conn::prepare);
  Nan::SetPrototypeMethod(tpl, "execPrepared", Conn::execPrepared);
  Nan::SetPrototypeMethod(tpl, "copyFromStream", Conn::copyFromStream);
  Nan::SetPrototypeMethod(tpl, "putCopyData", Conn::putCopyData);
  Nan::SetPrototypeMethod(tpl, "putCopyEnd", Conn::putCopyEnd);
  Nan::SetPrototypeMethod(tpl, "resultErrorField", Conn::resultErrorField);
  Nan::SetPrototypeMethod(tpl, "setTypeConverter", Conn::setTypeConverter);
  Nan::SetPrototypeMethod(tpl, "isReady", Conn::isReady);
  Nan::SetPrototypeMethod(tpl, "escapeLiteral", Conn::escapeLiteral);

  Nan::Set(target, Nan::New("PGLibPQ").ToLocalChecked(),
           Nan::GetFunction(tpl).ToLocalChecked());
}

NODE_MODULE(addon, InitAll)
