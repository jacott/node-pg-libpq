#ifndef NODE_PG_LIBPQ
#define NODE_PG_LIBPQ

#include <node.h>
#include <nan.h>
#include <libpq-fe.h>
#include <pg_config.h>

using v8::FunctionTemplate;
using v8::Local;
using v8::Value;
using v8::Number;
using v8::Handle;
using v8::Object;
using v8::Array;
using v8::String;

class PQAsync;

#define DEBUG(format, arg) // fprintf(stderr, format, arg)

class Conn : public node::ObjectWrap {
 public:
  static NAN_METHOD(create);
  static NAN_METHOD(connectDB);
  static NAN_METHOD(finish);
  static NAN_METHOD(exec);
  static NAN_METHOD(execParams);
  static NAN_METHOD(setTypeConverter);

  static char* newCStr(Handle<Value> val);
  static char** newCStrArray(Handle<Array> params);
  static void deleteCStrArray(char** array, int length);

  void setResult(PGresult* newResult);
  char* getErrorMessage();

  PGconn* pq;
  PGresult* result;
  NanCallback* typeConverter;
  PQAsync* queueTail;
};

#define THIS() ObjectWrap::Unwrap<Conn>(args.This());

struct ColumnData {
  char* name;
  Oid type;
  int mod;
};

class PQAsync : public NanAsyncWorker {
 public:
  PQAsync(Conn* conn, NanCallback* callback);
  ~PQAsync();
  void setResult(PGresult* value);
  void WorkComplete();
  void runNext();

  void HandleOKCallback();

  Conn* conn;
  PGresult* result;
  int rowCount;
  int colCount;
  ColumnData* colData;
  PQAsync* nextAction;
};

class ConnectDB : public PQAsync {
 public:
  ConnectDB(Conn* conn, char* params, NanCallback* callback);
  ~ConnectDB();
  void Execute();

 private:
  char* params;
};

class ExecParams : public PQAsync {
 public:
  ExecParams(Conn* conn, char* command, int paramsLen, char** params, NanCallback* callback);
  ~ExecParams();
  void Execute();

 private:
  char* command;
  int paramsLen;
  char** params;
};

#endif
