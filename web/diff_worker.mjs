// Runs the WebAssembly diff off the main thread and lays out both views once.
// In: { id, a, b } (ArrayBuffers, transferred). Out: the same buffers back, the line tables, and
// for each view one entry per row, plus line -> row maps, so scrolling, find and selection are
// array lookups.
import { loadSeams } from '../wasm/seams.mjs';
import { language, lineStates } from './lex.mjs';

const ready = fetch(new URL('../build/seams.wasm', import.meta.url))
  .then((r) => r.arrayBuffer())
  .then((bytes) => loadSeams(bytes));

export const ROW_CONTEXT = 0, ROW_DELETED = 1, ROW_INSERTED = 2, ROW_EMPTY = 3;

// Unified: deleted lines of a record come before its inserted lines, as in git's unified diff.
function layoutUnified(script, na, nb) {
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
function layoutSplit(script, na, nb) {
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
function pairLines(script, na, nb) {
  const pairA = new Int32Array(na).fill(-1), pairB = new Int32Array(nb).fill(-1);
  for (let r = 0; r < script.count; ++r) {
    const n = Math.min(script.aCount[r], script.bCount[r]);
    for (let k = 0; k < n; ++k) { pairA[script.aStart[r] + k] = script.bStart[r] + k; pairB[script.bStart[r] + k] = script.aStart[r] + k; }
  }
  return { pairA, pairB };
}

self.onmessage = async ({ data: { id, a, b, lang } }) => {
  const seams = await ready;
  const t0 = performance.now();
  const script = seams.diff(new Uint8Array(a), new Uint8Array(b));
  const t1 = performance.now();
  const tables = seams.lineTables();
  const rows = layoutUnified(script, script.aLines, script.bLines);
  const split = layoutSplit(script, script.aLines, script.bLines);
  const pairs = pairLines(script, script.aLines, script.bLines);
  const t2 = performance.now();
  let deleted = 0, inserted = 0;
  for (let r = 0; r < script.count; ++r) { deleted += script.aCount[r]; inserted += script.bCount[r]; }
  // the highlighter's line-start states need the bytes after they are handed back, so keep a copy
  const L = language(lang);
  const keep = L ? [a.slice(0), b.slice(0)] : null;
  const transfer = [a, b,
    rows.kind.buffer, rows.aLine.buffer, rows.bLine.buffer, rows.aRow.buffer, rows.bRow.buffer,
    split.left.buffer, split.right.buffer, split.aLine.buffer, split.bLine.buffer, split.aRow.buffer, split.bRow.buffer,
    tables.aStart.buffer, tables.aLen.buffer, tables.bStart.buffer, tables.bLen.buffer, pairs.pairA.buffer, pairs.pairB.buffer];
  self.postMessage({ id, a, b, tables, rows, split, pairs, deleted, inserted, records: script.count,
    timing: { diff: t1 - t0, layout: t2 - t1 } }, transfer);
  // second message, after the first frame is on its way: where block comments and multi-line strings
  // begin and end, so any line can be lexed on its own
  if (!L) return;
  const t3 = performance.now();
  const states = { a: lineStates(L, new Uint8Array(keep[0]), script.aLines), b: lineStates(L, new Uint8Array(keep[1]), script.bLines) };
  self.postMessage({ id, states, timing: { states: performance.now() - t3 } }, [states.a.buffer, states.b.buffer]);
};
