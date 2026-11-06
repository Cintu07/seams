// Runs the WebAssembly diff off the main thread and lays out the unified view once.
// In: { id, a, b } (ArrayBuffers, transferred). Out: the same buffers back, the line tables,
// and one entry per visible row, so scrolling to any row is an array lookup.
import { loadSeams } from '../wasm/seams.mjs';

const ready = fetch(new URL('../build/seams.wasm', import.meta.url))
  .then((r) => r.arrayBuffer())
  .then((bytes) => loadSeams(bytes));

export const ROW_CONTEXT = 0, ROW_DELETED = 1, ROW_INSERTED = 2;

// Deleted lines of a record come before its inserted lines, as in git's unified diff.
function layoutRows(script, na, nb) {
  let inserted = 0;
  for (let r = 0; r < script.count; ++r) inserted += script.bCount[r];
  const total = na + inserted;
  const kind = new Uint8Array(total), aLine = new Int32Array(total), bLine = new Int32Array(total);
  let row = 0, a = 0, b = 0;
  const context = (until) => { for (; a < until; ++a, ++b, ++row) { kind[row] = ROW_CONTEXT; aLine[row] = a; bLine[row] = b; } };
  for (let r = 0; r < script.count; ++r) {
    context(script.aStart[r]);
    for (let k = 0; k < script.aCount[r]; ++k, ++a, ++row) { kind[row] = ROW_DELETED; aLine[row] = a; bLine[row] = -1; }
    for (let k = 0; k < script.bCount[r]; ++k, ++b, ++row) { kind[row] = ROW_INSERTED; aLine[row] = -1; bLine[row] = b; }
  }
  context(na);
  return { kind, aLine, bLine };
}

self.onmessage = async ({ data: { id, a, b } }) => {
  const seams = await ready;
  const t0 = performance.now();
  const script = seams.diff(new Uint8Array(a), new Uint8Array(b));
  const t1 = performance.now();
  const tables = seams.lineTables();
  const rows = layoutRows(script, script.aLines, script.bLines);
  const t2 = performance.now();
  let deleted = 0, inserted = 0;
  for (let r = 0; r < script.count; ++r) { deleted += script.aCount[r]; inserted += script.bCount[r]; }
  const transfer = [a, b, rows.kind.buffer, rows.aLine.buffer, rows.bLine.buffer,
    tables.aStart.buffer, tables.aLen.buffer, tables.bStart.buffer, tables.bLen.buffer];
  self.postMessage({ id, a, b, tables, rows, deleted, inserted, records: script.count,
    timing: { diff: t1 - t0, layout: t2 - t1 } }, transfer);
};
