// Runs the WebAssembly diff off the main thread and lays out both views once.
// In: { id, a, b } (ArrayBuffers, transferred). Out: the same buffers back, the line tables, and
// for each view one entry per row, plus line -> row maps, so scrolling, find and selection are
// array lookups.
import { loadSeams } from '../wasm/seams.mjs';
import { language, lineStates } from './lex.mjs';
import { layoutUnified, layoutSplit, pairLines } from './layout.mjs';

const ready = fetch(new URL('../build/seams.wasm', import.meta.url))
  .then((r) => r.arrayBuffer())
  .then((bytes) => loadSeams(bytes));

self.onmessage = async ({ data: { id, a, b, lang } }) => {
  const seams = await ready;
  const t0 = performance.now();
  const script = seams.diff(new Uint8Array(a), new Uint8Array(b), { fast: true });
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
