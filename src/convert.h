typedef napi_value (*transformer)(napi_env env, char *text, int len);

#define MAX_INT_LEN 15

napi_value convertBoolean(napi_env env,  char *text, int len) {
  return makeBoolean(text[0] == 't');
}

napi_value convertInt(napi_env env,  char *text, int len) {
  return len > MAX_INT_LEN ? makeString(text, len) : makeInt(atoll(text));
}

napi_value convertDouble(napi_env env,  char *text, int len) {
  return makeDouble(atof(text));
}

napi_value convertText(napi_env env,  char *text, int len) {
  napi_value result;
  assertok(napi_create_string_utf8(env, text, len, &result));
  return result;
}

u_char htod(char h) {
  return h < ':' ? h - '0' : h - 'W';
}

napi_value convertBytea(napi_env env, char *text, int len) {
  size_t i;
  size_t size = (len >> 1)-1;
  u_char* data;
  napi_value result;
  assertok(napi_create_buffer(env, size, (void**)&data, &result));

  for(i = 0; i < size; ++i) {
    data[i] = (u_char)(htod(text[i*2+2])*16 + htod(text[i*2+3]));
  }
  return result;
}

int unQuote(char *text, int len) {
  int i, src = 0;
  for(i = 1; i < len-1; ++i) {
    text[src++] = text[text[i] == '\\' ? ++i : i];
  }
  return src;
}

typedef struct {
  napi_value result;
  int pos;
} arrayAndPos;

arrayAndPos _convertArray(napi_env env, transformer t, char *text, int len) {
  int ep;
  napi_value result;
  const napi_value nullv = getNull();
  char *word;
  int wlen;
  char c = text[1];
  assertok(napi_create_array(env, &result));

  int pos = 1;
  if (len == 2) goto end;

  int wc = 0;
  while (pos < len) {
    c = text[pos];
    if (c == '"') {
      for(ep = pos+1; ep < len; ++ep) {
        c = text[ep];
        if (c == '\\') {
          ++ep; continue;
        }
        if (c == '"') {
          ++ep;
          word = text+pos;
          wlen = unQuote(text+pos, ep-pos);
          pos = ep+1;
          addValue(result, wc++, t(env, word, wlen));
          break;
        }
      }
    } else {
      for(ep = pos; ep < len; ++ep) {
        c = text[ep];
        if (c == ',' || c == '}') {
          word = text+pos; wlen = ep-pos;
          addValue(result, wc++,
                   strncmp("NULL", word, wlen) == 0 ? nullv : t(env, word, wlen));
          pos = ep+1;
          if (c == '}') goto end;
          break;
        }
        if (c == '{') {
          arrayAndPos ans = _convertArray(env, t, text+ep, len-ep);
          addValue(result, wc++, ans.result);
          pos = ep+ans.pos+1;
          break;
        }
      }
    }
  }
 end:;
  arrayAndPos ans = {result, pos};
  return ans;
}

napi_value convertArray(napi_env env, transformer t, char *text, int len) {
  return _convertArray(env, t, text, len).result;
}

napi_value convert(napi_env env, Oid type, char *text, int len) {
  if (type < 143) {
    switch(type) {
    case 25:
      return convertText(env, text, len);
    case 20:
      if (len > MAX_INT_LEN) break;
      return convertInt(env, text, len);
    case 21: case 23: case 26:
      return convertInt(env, text, len);
    case 16:
      return makeBoolean(text[0] == 't');
    case 17:
      return convertBytea(env, text, len);
    default:
      return convertText(env, text, len);
    }
  } else {
    switch(type) {
    case 700: case 701:
      return convertDouble(env, text, len);
    case 3802:
      return convertText(env, text, len);
    case 1000:
      return convertArray(env, convertBoolean, text, len);
    case 1001:
      return convertArray(env, convertBytea, text, len);
    case 1007: case 1016: case 1005: case 1028:
      return convertArray(env, convertInt, text, len);
    case 1009: case 1014:
      return convertArray(env, convertText, text, len);
    case 1021: case 1022:
      return convertArray(env, convertDouble, text, len);
    }
  }

  if (len > 1 && text[0] == '{' && text[len-1] == '}')
    return convertArray(env, convertText, text, len);

  return makeString(text, len);
}
