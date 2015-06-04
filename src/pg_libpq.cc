#include "pg_libpq.h"

using v8::FunctionTemplate;
using v8::Handle;
using v8::Object;
using v8::String;

char* Conn::getErrorMessage() {
  return PQerrorMessage(this->pq);
}

char* Conn::NewCString(v8::Handle<v8::Value> val) {
  NanScope();

  v8::Local<v8::String> str = val->ToString();
  int len = str->Utf8Length() + 1;
  char* buffer = new char[len];
  str->WriteUtf8(buffer, len);
  return buffer;
}


ConnectDB::ConnectDB(Conn* conn, char* params, NanCallback* callback)
  : NanAsyncWorker(callback), params(params), conn(conn) {}

ConnectDB::~ConnectDB() {}

void ConnectDB::Execute() {
  Conn *conn = this->conn;
  PGconn* pq = conn->pq = PQconnectdb(params);

  ConnStatusType status = PQstatus(pq);

  if (status != CONNECTION_OK)
      SetErrorMessage(conn->getErrorMessage());
}

NAN_METHOD(Conn::create) {
  NanScope();

  Conn* conn = new Conn();
  conn->Wrap(args.This());

  NanReturnValue(args.This());
}

NAN_METHOD(Conn::connectDB) {
  NanScope();

  Conn* self = THIS();
  char* params = NewCString(args[0]);
  NanCallback* callback = new NanCallback(args[1].As<v8::Function>());

  ConnectDB* worker = new ConnectDB(self, params, callback);
  self->Ref();
  NanAsyncQueueWorker(worker);

  NanReturnUndefined();
}

void InitAll(v8::Handle<v8::Object> exports) {
  v8::Local<v8::FunctionTemplate> tpl = NanNew<v8::FunctionTemplate>(Conn::create);
  tpl->SetClassName(NanNew("PGLibPQ"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  NODE_SET_PROTOTYPE_METHOD(tpl, "connectDB", Conn::connectDB);

  exports->Set(NanNew<v8::String>("PGLibPQ"), tpl->GetFunction());
}

NODE_MODULE(addon, InitAll)
