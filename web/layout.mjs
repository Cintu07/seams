// Row layout for both views, from an edit script. Shared by the diff worker (in the browser) and
// tools/seams-pack.mjs (ahead of time), so a packed diff is laid out exactly as a live one.
export const ROW_CONTEXT = 0, ROW_DELETED = 1, ROW_INSERTED = 2, ROW_EMPTY = 3;

// Unified: deleted lines of a record come before its inserted lines, as in git's unified diff.
export function layoutUnified(script, na, nb) {
  let inserted = 0;
  for (let r = 0; r < script.count; ++r) inserted += script.bCount[r];
  const total = na + inserted;
  const kind = new Uint8Array(total), aLine = new Int32Array(total), bLine = new Int32Array(total);
  const aRow = new Int32Array(na), bRow = new Int32Array(nb);
  let row = 0, a = 0, b = 0;
  const context = (until) => {
    for (; a < until; ++a, ++b, ++row) { kind[row] = ROW_CONTEXT; aLine[row] = a; bLine[row] = b; aRow[a] = row; bRow[b] = row; }
  };
  for (let r = 0; r < script.count; ++r) {
    context(script.aStart[r]);
    for (let k = 0; k < script.aCount[r]; ++k, ++a, ++row) { kind[row] = ROW_DELETED; aLine[row] = a; bLine[row] = -1; aRow[a] = row; }
    for (let k = 0; k < script.bCount[r]; ++k, ++b, ++row) { kind[row] = ROW_INSERTED; aLine[row] = -1; bLine[row] = b; bRow[b] = row; }
  }
  context(na);
  return { kind, aLine, bLine, aRow, bRow };
}

// Split: old on the left, new on the right; a change record takes as many rows as its longer side,
// and the shorter side is padded with empty rows.
export function layoutSplit(script, na, nb) {
  let total = na;
  for (let r = 0; r < script.count; ++r) total += Math.max(0, script.bCount[r] - script.aCount[r]);
  const left = new Uint8Array(total), right = new Uint8Array(total);
  const aLine = new Int32Array(total), bLine = new Int32Array(total);
  const aRow = new Int32Array(na), bRow = new Int32Array(nb);
  let row = 0, a = 0, b = 0;
  const context = (until) => {
    for (; a < until; ++a, ++b, ++row) { left[row] = right[row] = ROW_CONTEXT; aLine[row] = a; bLine[row] = b; aRow[a] = row; bRow[b] = row; }
  };
  for (let r = 0; r < script.count; ++r) {
    context(script.aStart[r]);
    const ac = script.aCount[r], bc = script.bCount[r], span = Math.max(ac, bc);
    for (let k = 0; k < span; ++k, ++row) {
      if (k < ac) { left[row] = ROW_DELETED; aLine[row] = a; aRow[a++] = row; } else { left[row] = ROW_EMPTY; aLine[row] = -1; }
      if (k < bc) { right[row] = ROW_INSERTED; bLine[row] = b; bRow[b++] = row; } else { right[row] = ROW_EMPTY; bLine[row] = -1; }
    }
  }
  context(na);
  return { left, right, aLine, bLine, aRow, bRow };
}

// A changed line usually has a counterpart: the k-th deleted line of a change against its k-th inserted
// line. Those pairs get word-level highlighting. pairA[a] is the new line paired with old line a, or -1.
export function pairLines(script, na, nb) {
  const pairA = new Int32Array(na).fill(-1), pairB = new Int32Array(nb).fill(-1);
  for (let r = 0; r < script.count; ++r) {
    const n = Math.min(script.aCount[r], script.bCount[r]);
    for (let k = 0; k < n; ++k) { pairA[script.aStart[r] + k] = script.bStart[r] + k; pairB[script.bStart[r] + k] = script.aStart[r] + k; }
  }
  return { pairA, pairB };
}
