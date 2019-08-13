const parseJSON = value => JSON.parse(value);

const DPARTS = [0, 0, 0, 0, 0, 0, 0];

const readTmPart = (text, len, pos, result, idx)=>{
  let npos = pos;
  let c = 0, ans = 0;
  for(; npos < len && (c = text.charCodeAt(npos)) >= 48 && c <= 57; ++npos) {
    ans = ans*10 + (c - 48);
  }
  result[idx] = ans;
  return npos;
};

const parseDate = value =>{
  if (typeof value === 'number') {
    if (value === Infinity || value === -Infinity) return value;
    return new Date(value);
  } else {
    let i = 0, pos = 0, npos = 0;
    const len = value.length;
    for(; i < 6; ++i) {
      npos = readTmPart(value, len, pos, DPARTS, i);
      if (npos == pos || npos == len) {
        for(let j = npos == pos ? i : i+1; j < 6; ++j) DPARTS[j] = 0;
        pos = npos;
        break;
      }
      pos = npos + 1;
    }

    DPARTS[6] = 0;
    if (i == 6 && pos < len && value.charCodeAt(pos-1) == 46 /* . */)
      pos = readTmPart(value, len, pos, DPARTS, 6);
    else
      --pos;

    DPARTS[1] -= 1;

    DPARTS[0] = (value.charCodeAt(len-1) == 67 ? 1 - DPARTS[0] : DPARTS[0]);

    if (pos < len) {
      let result = [0];
      let sign = -1;
      switch(value.charCodeAt(pos)) {
      case 45 /* - */: sign = 1; // - fall thru
      case 43 /* + */: {
        ++pos;
        for (i = 3; i < 6; ++i) {
          npos = readTmPart(value, len, pos, result, 0);
          if (npos == pos) break;
          DPARTS[i] += sign*result[0];
          if (npos == len || value.charCodeAt(npos) != 58 /* : */) break;
          pos = npos + 1;
        }
      }
      }
    }

    const d =  new Date(Date.UTC(...DPARTS));
    if (DPARTS[0] < 100) {
      d.setFullYear(DPARTS[0]);
      const v = d.getTime();
      if (v == v) return d;
    }
    return new Date(value);
  }
};

module.exports = {
  114: parseJSON,
  199: parseJSON,
  1082: parseDate,
  1114: parseDate,
  1115: parseDate,
  1182: parseDate,
  1184: parseDate,
  1185: parseDate,
  3802: parseJSON,
  3807: parseJSON,
};
