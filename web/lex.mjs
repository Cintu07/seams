// Hand-written lexers for TypeScript/JavaScript, Rust, Python, C/C++ and Go.
// One byte loop shared by all five; a language is a small table (comment style, string kinds,
// word lists). A line is lexed from the state its first byte is in, which is one of the few
// constructs that span lines: a block comment, a template / raw backtick string, a triple-quoted
// string. lineStates() finds that state for every line in one pass, without classifying words,
// so lexing any visible line later needs nothing but that line.

export const PLAIN = 0, KEYWORD = 1, TYPE = 2, STRING = 3, NUMBER = 4, COMMENT = 5, FUNC = 6;
// palette key for each class; PLAIN keeps the row's own text colour
export const CLASS_COLOUR = [null, 'keyword', 'type', 'string', 'number', 'comment', 'func'];

const S_NORMAL = 0, S_BLOCK = 1, S_BACKTICK = 2, S_TRIPLE_DOUBLE = 3, S_TRIPLE_SINGLE = 4;

const words = (s) => new Set(s.split(/\s+/).filter(Boolean));
const LANGUAGES = {
  ts: {
    slashComments: true, backtick: true, backtickEscapes: true, dollarIdent: true,
    keywords: words(`break case catch class const continue debugger default delete do else enum export extends finally
      for function if import in instanceof let new of return super switch this throw try typeof var void while with yield
      async await as from get set static implements interface package private protected public readonly type declare
      namespace abstract keyof infer is satisfies override accessor`),
    types: words('string number boolean any unknown never object symbol bigint'),
    constants: words('true false null undefined NaN Infinity'),
  },
  rust: {
    slashComments: true, rustQuotes: true, macros: true,
    keywords: words(`as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod
      move mut pub ref return self static struct super trait type unsafe use where while`),
    types: words('i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str Self'),
    constants: words('true false Some None Ok Err'),
  },
  python: {
    hashComments: true, triple: true, stringPrefixes: words('r u b f br rb fr rf R U B F BR RB FR RF Rb rB Br bR Fr fR rF Rf'),
    keywords: words(`and as assert async await break class continue def del elif else except finally for from global if
      import in is lambda nonlocal not or pass raise return try while with yield match case`),
    types: words('int float str bool list dict set tuple bytes bytearray object type complex frozenset'),
    constants: words('True False None self cls'),
  },
  c: {
    slashComments: true, preprocessor: true,
    keywords: words(`auto break case const continue default do else enum extern for goto if inline register restrict
      return sizeof static struct switch typedef union volatile while class namespace template typename public private
      protected virtual new delete using this operator constexpr noexcept override final friend explicit mutable
      static_assert alignof alignas decltype thread_local`),
    types: words(`void char short int long float double signed unsigned bool size_t ssize_t ptrdiff_t intptr_t uintptr_t
      int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t wchar_t auto`),
    constants: words('NULL true false nullptr'),
  },
  go: {
    slashComments: true, backtick: true, backtickEscapes: false,
    keywords: words(`break case chan const continue default defer else fallthrough for func go goto if import interface
      map package range return select struct switch type var`),
    types: words(`bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8
      uint16 uint32 uint64 uintptr any comparable`),
    constants: words('true false nil iota'),
  },
};

const EXTENSIONS = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
  rs: 'rust', py: 'python', pyi: 'python',
  c: 'c', h: 'c', cc: 'c', cpp: 'c', cxx: 'c', hpp: 'c', hh: 'c', hxx: 'c',
  go: 'go',
};

// language name from a file name, or null for plain text
export function languageOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name));
  return m ? EXTENSIONS[m[1].toLowerCase()] ?? null : null;
}
export const language = (name) => LANGUAGES[name] ?? null;

const isDigit = (b) => b >= 48 && b <= 57;
const isIdentStart = (b, dollar) => (b >= 97 && b <= 122) || (b >= 65 && b <= 90) || b === 95 || b >= 0x80 || (dollar && b === 36);
const isIdent = (b, dollar) => isIdentStart(b, dollar) || isDigit(b);
// numbers take letters, digits, '_' and '.' (hex, suffixes, exponents, 1_000, 1.5f32)
const isNumberPart = (b) => isIdent(b, false) || b === 46;

function wordAt(bytes, i, j) {
  let s = '';
  for (let k = i; k < j && k < i + 24; ++k) s += String.fromCharCode(bytes[k]);
  return s;
}

// end of a quoted string that started at i (the quote); a backslash escapes the next byte.
// returns the index after the closing quote, or -1 if the line ends first
function quoteEnd(bytes, i, end, quote, escapes = true) {
  for (let j = i + 1; j < end; ++j) {
    const b = bytes[j];
    if (b === 92 && escapes) ++j;
    else if (b === quote) return j + 1;
  }
  return -1;
}
// index after the next `*/`, or -1
function blockEnd(bytes, i, end) {
  for (let j = i; j + 1 < end; ++j) if (bytes[j] === 42 && bytes[j + 1] === 47) return j + 2;
  return -1;
}
// index after the next triple quote, or -1
function tripleEnd(bytes, i, end, quote) {
  for (let j = i; j + 2 < end; ++j) {
    if (bytes[j] === 92) { ++j; continue; }
    if (bytes[j] === quote && bytes[j + 1] === quote && bytes[j + 2] === quote) return j + 3;
  }
  return -1;
}

// Lexes bytes[start, end) from `state`. When `out` is given (one class per byte, length end - start)
// it is filled; either way the state at the end of the line is returned.
export function lexLine(L, bytes, start, end, state, out) {
  let i = start;
  const paint = out ? (from, to, cls) => out.fill(cls, from - start, to - start) : null;
  // a construct carried over from the line before
  if (state !== S_NORMAL) {
    let j;
    if (state === S_BLOCK) j = blockEnd(bytes, i, end);
    else if (state === S_BACKTICK) j = quoteEnd(bytes, i - 1, end, 96, L.backtickEscapes);
    else j = tripleEnd(bytes, i, end, state === S_TRIPLE_DOUBLE ? 34 : 39);
    if (j < 0) { if (paint) paint(i, end, state === S_BLOCK ? COMMENT : STRING); return state; }
    if (paint) paint(i, j, state === S_BLOCK ? COMMENT : STRING);
    i = j;
  }
  let lineStart = true;  // only spaces so far: a C '#' here starts a preprocessor line
  while (i < end) {
    const b = bytes[i];
    if (b === 32 || b === 9) { ++i; continue; }
    const next = i + 1 < end ? bytes[i + 1] : 0;
    // comments
    if (L.slashComments && b === 47 && next === 47) { if (paint) paint(i, end, COMMENT); return S_NORMAL; }
    if (L.slashComments && b === 47 && next === 42) {
      const j = blockEnd(bytes, i + 2, end);
      if (j < 0) { if (paint) paint(i, end, COMMENT); return S_BLOCK; }
      if (paint) paint(i, j, COMMENT);
      i = j; lineStart = false; continue;
    }
    if (L.hashComments && b === 35) { if (paint) paint(i, end, COMMENT); return S_NORMAL; }
    if (L.preprocessor && b === 35 && lineStart) {
      let j = i + 1;
      while (j < end && (bytes[j] === 32 || bytes[j] === 9)) ++j;
      while (j < end && isIdent(bytes[j], false)) ++j;
      if (paint) paint(i, j, KEYWORD);
      // #include <file.h> reads as a string
      let k = j;
      while (k < end && bytes[k] === 32) ++k;
      if (k < end && bytes[k] === 60) {
        let e = k + 1;
        while (e < end && bytes[e] !== 62) ++e;
        if (paint) paint(k, Math.min(end, e + 1), STRING);
        j = Math.min(end, e + 1);
      }
      i = j; lineStart = false; continue;
    }
    lineStart = false;
    // strings
    if (b === 34 || b === 39 || (b === 96 && L.backtick)) {
      if (L.triple && b !== 96 && next === b && i + 2 < end && bytes[i + 2] === b) {
        const j = tripleEnd(bytes, i + 3, end, b);
        if (j < 0) { if (paint) paint(i, end, STRING); return b === 34 ? S_TRIPLE_DOUBLE : S_TRIPLE_SINGLE; }
        if (paint) paint(i, j, STRING);
        i = j; continue;
      }
      if (b === 39 && L.rustQuotes) {
        // 'a' or '\n' is a char; 'a without a closing quote is a lifetime
        const close = next === 92 ? quoteEnd(bytes, i, Math.min(end, i + 12), 39) : (() => {
          let k = i + 2;
          while (k < end && k < i + 5 && bytes[k] >= 0x80 && bytes[k] < 0xc0) ++k;  // one UTF-8 character
          return bytes[k] === 39 ? k + 1 : -1;
        })();
        if (close > 0) { if (paint) paint(i, close, STRING); i = close; continue; }
        let j = i + 1;
        while (j < end && isIdent(bytes[j], false)) ++j;
        if (paint) paint(i, j, TYPE);
        i = j; continue;
      }
      if (b === 96) {
        const j = quoteEnd(bytes, i, end, 96, L.backtickEscapes);
        if (j < 0) { if (paint) paint(i, end, STRING); return S_BACKTICK; }
        if (paint) paint(i, j, STRING);
        i = j; continue;
      }
      const j = quoteEnd(bytes, i, end, b);
      if (paint) paint(i, j < 0 ? end : j, STRING);
      i = j < 0 ? end : j; continue;
    }
    // numbers
    if (isDigit(b) || (b === 46 && isDigit(next))) {
      let j = i + 1;
      while (j < end && isNumberPart(bytes[j])) ++j;
      if (paint) paint(i, j, NUMBER);
      i = j; continue;
    }
    // words
    if (isIdentStart(b, L.dollarIdent)) {
      let j = i + 1;
      while (j < end && isIdent(bytes[j], L.dollarIdent)) ++j;
      const after = j < end ? bytes[j] : 0;
      // string prefixes: python f"..", rb'..'; rust b"..", r"..", r#".."#
      if ((after === 34 || after === 39) && L.stringPrefixes && j - i <= 2 && L.stringPrefixes.has(wordAt(bytes, i, j))) { if (paint) paint(i, j, STRING); i = j; continue; }   // the quote paints the rest
      if (L.rustQuotes && j - i <= 2 && (after === 34 || after === 35) && /^b?r?$/.test(wordAt(bytes, i, j))) {
        let k = j, hashes = 0;
        while (k < end && bytes[k] === 35) { ++k; ++hashes; }
        if (k < end && bytes[k] === 34) {
          let e = k + 1;
          for (; e < end; ++e) {
            if (bytes[e] !== 34) continue;
            let h = 0;
            while (h < hashes && e + 1 + h < end && bytes[e + 1 + h] === 35) ++h;
            if (h === hashes) { e += 1 + hashes; break; }
          }
          if (paint) paint(i, Math.min(end, e), STRING);
          i = Math.min(end, e); continue;
        }
      }
      if (paint) {
        const w = wordAt(bytes, i, j);
        let cls = PLAIN;
        if (L.keywords.has(w)) cls = KEYWORD;
        else if (L.constants.has(w)) cls = NUMBER;
        else if (L.types.has(w)) cls = TYPE;
        else {
          let k = j;
          while (k < end && bytes[k] === 32) ++k;
          if (bytes[k] === 40 || (L.macros && after === 33)) cls = FUNC;   // name( or name!
          else if (b >= 65 && b <= 90) cls = TYPE;                          // Capitalised
        }
        if (cls) paint(i, j, cls);
      }
      i = j; continue;
    }
    ++i;
  }
  return S_NORMAL;
}

// the lexer state at the start of every line of a file, in one pass over its bytes
export function lineStates(L, bytes, lineCount) {
  const states = new Uint8Array(lineCount);
  let state = S_NORMAL, start = 0;
  for (let line = 0; line < lineCount && start <= bytes.length; ++line) {
    states[line] = state;
    let nl = bytes.indexOf(10, start);
    if (nl < 0) nl = bytes.length;
    let end = nl;
    if (end > start && bytes[end - 1] === 13) --end;
    // a construct-free line keeps the state as it is; only lines with a special byte need the lexer
    state = lexLine(L, bytes, start, Math.min(end, start + LINE_LIMIT), state, null);
    start = nl + 1;
  }
  return states;
}

// lines longer than this (minified files) are lexed only up to it
export const LINE_LIMIT = 1 << 16;

// Lazily lexed classes for the lines the renderer asks for, cached per line.
export class Highlighter {
  constructor(lang) {
    this.L = language(lang);
    this.states = { a: null, b: null };
    this.cache = { a: new Map(), b: new Map() };
  }
  setStates(states) { this.states = states; this.cache.a.clear(); this.cache.b.clear(); }
  classes(side, line, bytes, start, end) {
    if (!this.L) return null;
    const cache = this.cache[side];
    let out = cache.get(line);
    if (out) return out;
    if (cache.size > 8192) cache.clear();
    const stop = Math.min(end, start + LINE_LIMIT);
    out = new Uint8Array(stop - start);
    lexLine(this.L, bytes, start, stop, this.states[side]?.[line] ?? 0, out);
    cache.set(line, out);
    return out;
  }
}
