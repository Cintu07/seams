// Word-level changes inside a pair of changed lines: which words of the old line went, which words of
// the new line came. Lines are split into tokens (a run of word characters, a run of spaces, or one
// other character), the common start and end are trimmed, and what is left is matched with an exact
// longest common subsequence. A pair that changed almost entirely gets no word marks: marking every
// word says nothing the row colour does not already say.

const isWord = (b) => (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 95 || b >= 0x80;
const isSpace = (b) => b === 32 || b === 9;

function tokens(bytes, start, end) {
  const out = [];
  let i = start;
  while (i < end) {
    let j = i + 1;
    if (isWord(bytes[i])) while (j < end && isWord(bytes[j])) ++j;
    else if (isSpace(bytes[i])) while (j < end && isSpace(bytes[j])) ++j;
    out.push(i, j);
    i = j;
  }
  return out;   // flat [start, end, start, end, ...]
}

function same(ba, ta, i, bb, tb, j) {
  const s1 = ta[2 * i], e1 = ta[2 * i + 1], s2 = tb[2 * j], e2 = tb[2 * j + 1];
  if (e1 - s1 !== e2 - s2) return false;
  for (let k = 0; k < e1 - s1; ++k) if (ba[s1 + k] !== bb[s2 + k]) return false;
  return true;
}

// spans are byte offsets relative to the line start, merged where they touch
function spans(t, keep, lineStart) {
  const out = [];
  for (let i = 0; i < keep.length; ++i) {
    if (keep[i]) continue;
    const s = t[2 * i] - lineStart, e = t[2 * i + 1] - lineStart;
    if (out.length && out[out.length - 1][1] === s) out[out.length - 1][1] = e;
    else out.push([s, e]);
  }
  return out;
}

const LIMIT = 90000;    // tokens(a) x tokens(b) left after trimming; above it the middle is one change

export function wordDiff(ba, sa, ea, bb, sb, eb) {
  const ta = tokens(ba, sa, ea), tb = tokens(bb, sb, eb);
  const n = ta.length / 2, m = tb.length / 2;
  const keepA = new Uint8Array(n), keepB = new Uint8Array(m);
  let lo = 0;
  while (lo < n && lo < m && same(ba, ta, lo, bb, tb, lo)) { keepA[lo] = keepB[lo] = 1; ++lo; }
  let hiA = n, hiB = m;
  while (hiA > lo && hiB > lo && same(ba, ta, hiA - 1, bb, tb, hiB - 1)) { keepA[--hiA] = 1; keepB[--hiB] = 1; }
  const n2 = hiA - lo, m2 = hiB - lo;
  if (n2 && m2 && n2 * m2 <= LIMIT) {
    // lcs table over the middle, then walk it back to mark the kept tokens
    const w = m2 + 1, L = new Uint16Array((n2 + 1) * w);
    for (let i = n2 - 1; i >= 0; --i)
      for (let j = m2 - 1; j >= 0; --j)
        L[i * w + j] = same(ba, ta, lo + i, bb, tb, lo + j) ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0, j = 0;
    while (i < n2 && j < m2) {
      if (same(ba, ta, lo + i, bb, tb, lo + j)) { keepA[lo + i] = keepB[lo + j] = 1; ++i; ++j; }
      else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) ++i;
      else ++j;
    }
  }
  // a lone space kept between two changes reads as part of one change
  for (const [keep, t, bytes] of [[keepA, ta, ba], [keepB, tb, bb]])
    for (let i = 1; i + 1 < keep.length; ++i)
      if (keep[i] && !keep[i - 1] && !keep[i + 1] && isSpace(bytes[t[2 * i]])) keep[i] = 0;
  const changedA = keepA.reduce((c, k, i) => c + (k ? 0 : ta[2 * i + 1] - ta[2 * i]), 0);
  const changedB = keepB.reduce((c, k, i) => c + (k ? 0 : tb[2 * i + 1] - tb[2 * i]), 0);
  if (changedA + changedB > 0.7 * ((ea - sa) + (eb - sb))) return null;
  return { a: spans(ta, keepA, sa), b: spans(tb, keepB, sb) };
}
