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

#define DEBUG(...) fprintf(stderr, __VA_ARGS__)

class Conn : public node::ObjectWrap {
 public:
  ~Conn();
  static NAN_METHOD(create);
  static NAN_METHOD(connectDB);
  static NAN_METHOD(finish);
  static NAN_METHOD(execParams);
  static NAN_METHOD(prepare);
  static NAN_METHOD(execPrepared);
  static NAN_METHOD(copyFromStream);
  static NAN_METHOD(putCopyData);
  static NAN_METHOD(putCopyEnd);
  static NAN_METHOD(resultErrorField);
  static NAN_METHOD(setTypeConverter);
  static NAN_METHOD(isReady);
  static NAN_METHOD(escapeLiteral);

  static char* newUtf8String(Handle<Value> from);
  static char** newUtf8StringArray(Handle<Array> params);
  static void deleteUtf8StringArray(char** array, int length);

  void pqRef();
  void pqUnref();
  void setResult(PGresult* newResult);
  char* getErrorMessage();

  int state;
  bool copy_inprogress;
  PGconn* pq;
  PGresult* result;
  Nan::Callback* typeConverter;
};

#define THIS() ObjectWrap::Unwrap<Conn>(info.This())

struct ColumnData {
  char* name;
  Oid type;
  int mod;
};

class PQAsync : public Nan::AsyncWorker {
 public:
  PQAsync(Conn* conn, Nan::Callback* callback);
  ~PQAsync();
  void setResult(PGresult* value);
  void WorkComplete();

  void HandleOKCallback();

  virtual Handle<Value> buildResult();

  Conn* conn;
  PGresult* result;
  int cmdTuples;
  int rowCount;
  int colCount;
  ColumnData* colData;
  PQAsync* nextAction;
};

class ConnectDB : public PQAsync {
 public:
  ConnectDB(Conn* conn, char* params, Nan::Callback* callback);
  ~ConnectDB();
  void Execute();

 private:
  char* params;
};

#endif
