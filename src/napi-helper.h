#include <node_api.h>
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>

#define dm(ptr, msg) // printf("%s:%d: %s '%p'\n", __FILE__, __LINE__, #msg, ptr)

#define LOG(s, ...) fprintf(stderr, "%s:%d: DEBUG " s "\n", __FILE__, __LINE__, ## __VA_ARGS__)

#define DEBUG 1
#ifdef DEBUG
static int _debugok(napi_env env, napi_status status) {
  if (status == napi_ok)
    return 1;

  const napi_extended_error_info* result;
  napi_get_last_error_info(env, &result);
  fprintf(stderr, "ERROR %s\n", result->error_message);
  return 0;
}
#define assertok(status) assert(_debugok(env, status))
#else
#define assertok(n) assert((n) == napi_ok)
#endif

static napi_value _getRef(napi_env env, napi_ref ref) {
  napi_value result;
  assertok(napi_get_reference_value(env, ref, &result));
  return result;
}
#define getRef(ref) _getRef(env, ref)

#define quote(x) #x

static napi_valuetype _jsType(napi_env env, napi_value value) {
  napi_valuetype result;
  assertok(napi_typeof(env, value, &result));
  return result;
}
#define jsType(value) _jsType(env, value)

static napi_value _makeObject(napi_env env) {
  napi_value result;
  assertok(napi_create_object(env, &result));
  return result;
}
#define makeObject() _makeObject(env)

#define setProperty(object, name, value)                        \
  assertok(napi_set_named_property(env, object, name, value))

static napi_value _makeString(napi_env env, char* value, size_t len) {
  napi_value result;
  assertok(napi_create_string_utf8(env, value, len, &result));
  return result;
}
#define makeString(value, len) _makeString(env, value, len)
#define makeAutoString(value) _makeString(env, value, NAPI_AUTO_LENGTH)

static size_t _getStringLen(napi_env env, napi_value src) {
  size_t result;
  assertok(napi_get_value_string_utf8(env, src, NULL, 0, &result));
  return result;
}
#define getStringLen(value) _getStringLen(env, value)

static char* _getString(napi_env env, napi_value src) {
  size_t result;
  assertok(napi_get_value_string_utf8(env, src, NULL, 0, &result));

  char* dest = malloc(result+1);
  assertok(napi_get_value_string_utf8(env, src, dest, result+1, &result));

  return dest;
}
#define getString(value) _getString(env, value)

static napi_value _makeBoolean(napi_env env, bool value) {
  napi_value result;
  assertok(napi_get_boolean(env, value, &result));
  return result;
}
#define makeBoolean(value) _makeBoolean(env, value)

static napi_value _makeInt(napi_env env, int64_t value) {
  napi_value result;
  assertok(napi_create_int64(env, value, &result));
  return result;
}
#define makeInt(value) _makeInt(env, value)

static napi_value _makeDouble(napi_env env, double value) {
  napi_value result;
  assertok(napi_create_double(env, value, &result));
  return result;
}
#define makeDouble(value) _makeDouble(env, value)

#define addInt(object, index, value) addValue(object, index, makeInt(value))

static int32_t _getInt32(napi_env env, napi_value value) {
  int32_t result;
  assertok(napi_get_value_int32(env, value, &result));
  return result;
}
#define getInt32(value) _getInt32(env, value)

static bool _getBool(napi_env env, napi_value value) {
  bool result;
  assertok(napi_get_value_bool(env, value, &result));
  return result;
}
#define getBool(value) _getBool(env, value)

static napi_value _makeError(napi_env env, char* msg) {
  napi_value result;

  assertok(napi_create_error(env, NULL, makeAutoString(msg), &result));
  return result;
}
#define makeError(msg) _makeError(env, msg)

static bool _isError(napi_env env, napi_value value) {
  bool result;
  assertok(napi_is_error(env, value, &result));
  return result;
}
#define isError(value) _isError(env, value)


static napi_value _makeArray(napi_env env, size_t size) {
  napi_value result;
  assertok(napi_create_array_with_length(env, size, &result));
  return result;
}

#define makeArray(size) _makeArray(env, size);

static bool _isArray(napi_env env, napi_value value) {
  bool result;
  assertok(napi_is_array(env, value, &result));
  return result;
}
#define isArray(value) _isArray(env, value)

static uint32_t _arrayLength(napi_env env, napi_value value) {
  uint32_t result;
  assertok(napi_get_array_length(env, value, &result));
  return result;
}
#define arrayLength(value) _arrayLength(env, value)

#define addValue(object, index, value)                  \
  assertok(napi_set_element(env, object, index, value))

static napi_value _getValue(napi_env env, napi_value object, uint32_t index) {
  napi_value result;
  assertok(napi_get_element(env, object, index, &result));
  return result;
}
#define getValue(object, index) _getValue(env, object, index)

#define getArgs(count)                                                  \
  size_t argc = count;                                                  \
  napi_value args[count];                                               \
  assertok(napi_get_cb_info(env, info, &argc, args, NULL, NULL))

/* static napi_value _getUndefined(napi_env env) { */
/*   napi_value ans; */

/*   napi_get_undefined(env, &ans); */
/*   return ans; */
/* } */
/* #define getUndefined() _getUndefined(env) */


static napi_value _getGlobal(napi_env env) {
  napi_value ans;

  napi_get_global(env, &ans);
  return ans;
}
#define getGlobal() _getGlobal(env)

static napi_value _getNull(napi_env env) {
  napi_value ans;

  napi_get_null(env, &ans);
  return ans;
}
#define getNull() _getNull(env)


napi_value _callFunction(napi_env env, napi_value recv, napi_value func,
                         size_t argc, const napi_value* argv) {
  napi_value ans;

  assertok(napi_call_function(env, recv, func, argc, argv, &ans));

  return ans;
}

#define callFunction(recv, func, argc, argv) _callFunction(env, recv, func, argc, argv)

napi_value _getProp(napi_env env, napi_value obj, char *prop) {
  napi_value ans;

  assertok(napi_get_named_property(env, obj, prop, &ans));

  return ans;
}

#define getProp(obj, prop) _getProp(env, obj, prop)
