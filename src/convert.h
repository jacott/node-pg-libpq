typedef napi_value (*transformer)(napi_env env, char *text, int len);

#define MAX_INT_LEN 15

static napi_value convertBoolean(napi_env env,  char *text, int len) {
  return makeBoolean(text[0] == 't');
}

static napi_value convertInt(napi_env env,  char *text, int len) {
  return len > MAX_INT_LEN ? makeString(text, len) : makeInt(atoll(text));
}

static napi_value convertDouble(napi_env env,  char *text, int len) {
  return makeDouble(atof(text));
}

static napi_value convertText(napi_env env,  char *text, int len) {
  napi_value result;
  assertok(napi_create_string_utf8(env, text, len, &result));
  return result;
}

static struct tm tm;
static int* tm_parts[] = {&tm.tm_year, &tm.tm_mon, &tm.tm_mday,
                          &tm.tm_hour, &tm.tm_min, &tm.tm_sec};

static int read_tm_part(char *text, int len, int pos, int *result) {
  register int npos = pos;
  register char c;
  register int ans = 0;
  for(; npos < len && (c = text[npos]) >= '0' && c <= '9'; ++npos) {
    ans = ans*10 + (int)(c - '0');
  }
  *result = ans;
  return npos;
}

static char * Number = "Number";
static char * POSITIVE_INFINITY = "Infinity";
static char * NEGATIVE_INFINITY = "NEGATIVE_INFINITY";

static napi_value get_global_prop(napi_env env, char *name) {
  napi_value result;
  assertok(napi_get_named_property(env, getGlobal(), name, &result));
  return result;
}

static napi_value get_number_prop(napi_env env, char *name) {
  napi_value number, result;

  assertok(napi_get_named_property(env, getGlobal(), Number, &number));

  assertok(napi_get_named_property(env, number, name, &result));

  return result;
}

static napi_value convertDate(napi_env env,  char *text, int len) {
  if (text[0] == 'i') return get_global_prop(env, POSITIVE_INFINITY);
  if (text[0] == '-' && text[1] == 'i') return get_number_prop(env, NEGATIVE_INFINITY);

  if (sizeof(time_t) != 8) return convertText(env, text, len);

  register int i = 0, pos = 0, npos = 0;
  for(; i < 6; ++i) {
    npos = read_tm_part(text, len, pos, tm_parts[i]);
    if (npos == pos || npos == len) {
      for(int j = npos == pos ? i : i+1; j < 6; ++j) (*tm_parts[j]) = 0;
      pos = npos;
      break;
    }
    pos = npos + 1;
  }

  int ms = 0;
  if (i == 6 && pos < len && text[pos-1] == '.') {
    npos = read_tm_part(text, len, pos, &ms);
    if (pos + 1 == npos) ms *= 100;
    else if (pos + 2 == npos) ms *= 10;
    pos = npos;
  }
  else
    --pos;

  tm.tm_mon -= 1;

  tm.tm_year = (text[len-1] == 'C' ? 1 - tm.tm_year : tm.tm_year) - 1900;

  if (pos < len) {
    int sign = -1;
    switch(text[pos]) {
    case '-': sign = 1; // fall thru
    case '+': {
      int of;
      ++pos;
      for (i = 3; i < 6; ++i) {
        npos = read_tm_part(text, len, pos, &of);
        if (npos == pos) break;
        *tm_parts[i] += sign*of;
        if (npos == len || text[npos] != ':') break;
        pos = npos + 1;
      }
    }
    }
  }

  tm.tm_isdst = 0;
  double time = (double)timegm(&tm);
  return makeDouble(time*1000 + (double)ms);
}

static u_char htod(char h) {
  return h < ':' ? h - '0' : h - 'W';
}

static napi_value convertBytea(napi_env env, char *text, int len) {
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

static int unQuote(char *text, int len) {
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

static arrayAndPos _convertArray(napi_env env, transformer t, char *text, int len) {
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

static napi_value convertArray(napi_env env, transformer t, char *text, int len) {
  return _convertArray(env, t, text, len).result;
}

static napi_value convert(napi_env env, Oid type, char *text, int len) {
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
    case 1082: case 1114: case 1184:
      return convertDate(env, text, len);
    case 1115: case 1182: case 1185:
      return convertArray(env, convertDate, text, len);
    }
  }

  if (len > 1 && text[0] == '{' && text[len-1] == '}')
    return convertArray(env, convertText, text, len);

  return makeString(text, len);
}
