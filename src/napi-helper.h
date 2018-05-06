#include <node_api.h>
#include <assert.h>
#include <stdlib.h>
#include <string.h>

#define assertok(n) assert((n) == napi_ok)

#define quote(x) #x

napi_valuetype _jsType(napi_env env, napi_value value) {
  napi_valuetype result;
  assertok(napi_typeof(env, value, &result));
  return result;
}
#define jsType(value) _jsType(env, value)

napi_value _makeString(napi_env env, char* value) {
  napi_value result;
  assertok(napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result));
  return result;
}
#define makeString(value) _makeString(env, value)

#define addString(object, index, value) addValue(object, index, makeString(value))

size_t _getStringLen(napi_env env, napi_value src) {
  size_t result;
  assertok(napi_get_value_string_utf8(env, src, NULL, 0, &result));
  return result;
}
#define getStringLen(value) _getStringLen(env, value)

char* _getString(napi_env env, napi_value src) {
  size_t result;
  assertok(napi_get_value_string_utf8(env, src, NULL, 0, &result));

  char* dest = calloc(1, result+1);
  assertok(napi_get_value_string_utf8(env, src, dest, result+1, &result));

  return dest;
}
#define getString(value) _getString(env, value)

napi_value _makeBoolean(napi_env env, bool value) {
  napi_value result;
  assertok(napi_get_boolean(env, value, &result));
  return result;
}
#define makeBoolean(value) _makeBoolean(env, value)

napi_value _makeInt32(napi_env env, int32_t value) {
  napi_value result;
  assertok(napi_create_int32(env, value, &result));
  return result;
}
#define makeInt32(value) _makeInt32(env, value)

#define addInt32(object, index, value) addValue(object, index, makeInt32(value))

int32_t _getInt32(napi_env env, napi_value value) {
  int32_t result;
  assertok(napi_get_value_int32(env, value, &result));
  return result;
}
#define getInt32(value) _getInt32(env, value)

napi_value _makeError(napi_env env, char* msg) {
  napi_value result;

  assertok(napi_create_error(env, NULL, makeString(msg), &result));
  return result;
}
#define makeError(msg) _makeError(env, msg)

bool _isError(napi_env env, napi_value value) {
  bool result;
  assertok(napi_is_error(env, value, &result));
  return result;
}
#define isError(value) _isError(env, value)


napi_value _makeArray(napi_env env, size_t size) {
  napi_value result;
  assertok(napi_create_array_with_length(env, size, &result));
  return result;
}

#define makeArray(size) _makeArray(env, size);

bool _isArray(napi_env env, napi_value value) {
  bool result;
  assertok(napi_is_array(env, value, &result));
  return result;
}
#define isArray(value) _isArray(env, value)

uint32_t _arrayLength(napi_env env, napi_value value) {
  uint32_t result;
  assertok(napi_get_array_length(env, value, &result));
  return result;
}
#define arrayLength(value) _arrayLength(env, value)

#define addValue(object, index, value) \
  assertok(napi_set_element(env, object, index, value))

napi_value _getValue(napi_env env, napi_value object, uint32_t index) {
  napi_value result;
  assertok(napi_get_element(env, object, index, &result));
  return result;
}
#define getValue(object, index) _getValue(env, object, index)

#define getArgs(count)                                                  \
  size_t argc = count;                                                  \
  napi_value args[count];                                               \
  assertok(napi_get_cb_info(env, info, &argc, args, NULL, NULL))

napi_value _getUndefined(napi_env env) {
  napi_value ans;

  napi_get_undefined(env, &ans);
  return ans;
}
#define getUndefined() _getUndefined(env)

napi_value _getNull(napi_env env) {
  napi_value ans;

  napi_get_null(env, &ans);
  return ans;
}
#define getNull() _getNull(env)
