// A packed diff: everything the expensive part of opening a diff produces, computed once ahead of
// time (in CI, on a server, with tools/seams-pack.mjs) so a viewer only lays out rows and draws.
//
//   bytes 0..7    "SEAMSPK1"
//   bytes 8..11   header length, u32 little endian
//   header        JSON: names, language, counts, and for every array its [offset, length]
//   arrays        each starting on an 8-byte boundary, read in place as typed arrays
//
// Arrays: the two files (a, b), their line starts and lengths, the edit script, and the
// highlighter's line-start states. Row layout is left out: it is cheap to rebuild and large to ship.
import { layoutUnified, layoutSplit, pairLines } from './layout.mjs';

const MAGIC = 'SEAMSPK1';
const TYPES = { u8: Uint8Array, u32: Uint32Array };

export function writePack({ a, b, names, lang, tables, script, states }) {
  const arrays = {
    a: ['u8', a], b: ['u8', b],
    aStart: ['u32', tables.aStart], aLen: ['u32', tables.aLen], bStart: ['u32', tables.bStart], bLen: ['u32', tables.bLen],
    sAStart: ['u32', script.aStart], sBStart: ['u32', script.bStart], sACount: ['u32', script.aCount], sBCount: ['u32', script.bCount],
  };
  if (states) { arrays.statesA = ['u8', states.a]; arrays.statesB = ['u8', states.b]; }
  const header = { names, lang, aLines: script.aLines, bLines: script.bLines, records: script.count, arrays: {} };
  let at = 0;
  for (const [name, [type, data]] of Object.entries(arrays)) {
    header.arrays[name] = [type, at, data.length];
    at += Math.ceil(data.byteLength / 8) * 8;
  }
  const json = new TextEncoder().encode(JSON.stringify(header));
  const start = Math.ceil((12 + json.length) / 8) * 8;
  const out = new Uint8Array(start + at);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(8, json.length, true);
  out.set(json, 12);
  for (const [name, [, data]] of Object.entries(arrays)) {
    const [, offset] = header.arrays[name];
    out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), start + offset);
  }
  return out;
}

// the same object the diff worker posts, from a pack, without diffing anything
export function readPack(buffer) {
  const head = new Uint8Array(buffer, 0, 12);
  if (new TextDecoder().decode(head.subarray(0, 8)) !== MAGIC) throw new Error('not a seams pack');
  const length = new DataView(buffer).getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, length)));
  const start = Math.ceil((12 + length) / 8) * 8;
  const view = (name) => {
    const entry = header.arrays[name];
    if (!entry) return null;
    const [type, offset, count] = entry;
    return new TYPES[type](buffer, start + offset, count);
  };
  const t0 = performance.now();
  const script = { count: header.records, aStart: view('sAStart'), bStart: view('sBStart'), aCount: view('sACount'), bCount: view('sBCount') };
  const rows = layoutUnified(script, header.aLines, header.bLines);
  const pairs = pairLines(script, header.aLines, header.bLines);
  let deleted = 0, inserted = 0;
  for (let r = 0; r < script.count; ++r) { deleted += script.aCount[r]; inserted += script.bCount[r]; }
  const diff = {
    a: view('a'), b: view('b'), names: header.names, lang: header.lang,
    tables: { aStart: view('aStart'), aLen: view('aLen'), bStart: view('bStart'), bLen: view('bLen') },
    rows, pairs, deleted, inserted, records: script.count,
    states: header.arrays.statesA ? { a: view('statesA'), b: view('statesB') } : null,
    timing: { diff: 0, layout: performance.now() - t0 },
  };
  // the split view's rows are laid out the first time someone opens it, not before the first frame
  let split = null;
  Object.defineProperty(diff, 'split', { get: () => (split ??= layoutSplit(script, header.aLines, header.bLines)), enumerable: true });
  return diff;
}
