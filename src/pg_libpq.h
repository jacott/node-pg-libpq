#ifndef NODE_PG_LIBPQ
#define NODE_PG_LIBPQ

#include <node.h>
#include <nan.h>
#include <libpq-fe.h>
#include <pg_config.h>

class Conn : public node::ObjectWrap {
 public:
  static NAN_METHOD(create);
  static NAN_METHOD(connectDB);

  PGconn* pq;
  char* getErrorMessage();
  static char* NewCString(v8::Handle<v8::Value> val);
};

#define THIS() ObjectWrap::Unwrap<Conn>(args.This());

class ConnectDB : public NanAsyncWorker {
 public:
  ConnectDB(Conn* conn, char* params, NanCallback* callback);
  ~ConnectDB();
  void Execute();

 private:
  char* params;
  Conn* conn;
};

#endif
