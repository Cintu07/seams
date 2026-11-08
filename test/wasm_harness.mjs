// Shared harness: the WebAssembly core must produce the same edit script as the native engine
// on every pair, in both its scalar and SIMD modes, and its apply must rebuild b byte for byte.
// Native scripts come from build/script_dump, which also checks native scalar against AVX2.
//   node test/wasm_harness.mjs [build name] [wasm file]
// env: SEAMS_FUZZ_PAIRS (default 50000), SEAMS_FUZZ_SEED, SEAMS_CORPUS (dir of <n>.old/<n>.new)
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSeams } from '../wasm/seams.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildName = process.argv[2] ?? 'normal hash';
const wasmFile = process.argv[3] ?? join(root, 'build/seams.wasm');
const fuzzPairs = Number(process.env.SEAMS_FUZZ_PAIRS ?? 50000);
const startSeed = Number(process.env.SEAMS_FUZZ_SEED ?? 0x5ea0d1f);
const seams = await loadSeams(readFileSync(wasmFile));
// SEAMS_FAST=1: every diff runs with the cost cutoff, native and wasm alike
const fast = !!process.env.SEAMS_FAST;
const enc = new TextEncoder();

let seed = startSeed >>> 0 || 1;
const random = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>>= 0); };

function* edgeCases() {
  const s = (a, b) => [enc.encode(a), enc.encode(b)];
  yield* [
    s('', ''), s('', 'a\nb\n'), s('a\nb\n', ''), s('same\nlines\n', 'same\nlines\n'), s('a\nb\nc\n', 'x\ny\nz\n'),
    s('a\nb', 'a\nb\n'), s('a\nb\n', 'a\nb'), s('a\nb', 'a\nc'), s('\n\n\n', '\n\n'), s('\n\n\n', 'x\n\n\n\n'),
    s('a\r\nb\r\n', 'a\r\nb\n'), s('line one\n', 'line onf\n'), s('abcabba', 'cbabac'),
    s('a\nb\nc\na\nb\nb\na\n', 'c\nb\na\nb\na\nc\n'),
    s('ba\n', 'a\n'), s('a\n', 'ba\n'), s('x\nba\n', 'x\na\n'), s('abc', 'abc\n'), s('abc\n', 'abc'), s('abc', 'abcdef'),
    s('same\nabc', 'same\nabcdef'), s('same\n', 'same\nsame\n'), s('same\nsame\n', 'same\n'),
    s('p\nq\nlong shared tail line\n', 'p\nr\nlong shared tail line\n'),
    s('0123456789abcdef\nmid\n0123456789abcdef\n', '0123456789abcdef\nMID\n0123456789abcdef\n'),
    s('0123456\n89abcdef\n', '0123456\n89abcdeF\n'), s('Xbcdefgh\nijklmnop\n', 'abcdefgh\nijklmnop\n'),
  ];
  yield [Uint8Array.from([97, 0, 98, 10, 0, 10, 99]), Uint8Array.from([97, 0, 99, 10, 0, 10, 99])];
  const long = new Uint8Array(1100001).fill(120); long[long.length - 1] = 10;
  const longB = new Uint8Array(long.length + 2); longB.set([121, 10]); longB.set(long, 2);
  yield [long, longB];
  const longC = longB.slice(); longC[longC.length - 1] = 122;
  yield [long, longC];
  const rep = enc.encode('same line\n'.repeat(100000));
  const repB = rep.slice(); repB.set(enc.encode('CHANGED!!\n'), rep.length / 2 - ((rep.length / 2) % 10));
  yield [rep, repB];
  for (let n = 0; n < 100; ++n) {
    const a = [], b = [];
    for (let i = 0; i < n; ++i) { a.push(97 + (i % 7)); b.push(97 + (i % 7)); }
    if (n > 0) b[n - 1] = 90;
    if (n > 3) a[n >> 1] = 10;
    yield [Uint8Array.from(a), Uint8Array.from(b)];
  }
  // lengths around the 16-byte vector width, to catch SIMD tail bugs
  for (let n = 0; n < 70; ++n) {
    const a = enc.encode('k'.repeat(n) + '\n' + 'z'.repeat(n % 17));
    const b = a.slice(); if (n) b[n - 1] = 75;
    yield [a, b];
  }
}

const words = ['a', 'b', 'c', '}', '', '  x = 1;', 'return', '\r', 'if (y)', 'zz'].map((w) => enc.encode(w + '\n'));
function* fuzzCases(pairs) {
  for (let i = 0; i < pairs; ++i) {
    const alphabet = 2 + (random() % 9);
    const pick = () => words[random() % alphabet];
    const a = [], b = [];
    const lines = random() % 60;
    for (let l = 0; l < lines; ++l) a.push(pick());
    for (const line of a) {
      const action = random() % 10;
      if (action === 0) b.push(pick());
      if (action !== 1) b.push(line);
      if (action === 2) b.push(pick());
    }
    const join = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
    let A = join(a), B = join(b);
    if (random() % 4 === 0 && A.length) A = A.subarray(0, A.length - 1);
    if (random() % 4 === 0 && B.length) B = B.subarray(0, B.length - 1);
    if (random() % 16 === 0) { B = B.slice(); for (let k = 0; k < B.length; ++k) if (random() % 8 === 0) B[k] = random() & 255; }
    yield [A, B];
  }
}

// big pairs drawn from the same few lines in random order: the exact search runs long, so with
// SEAMS_FAST the budget runs out and both engines have to cut at the same point
function* cutoffCases(n) {
  for (let k = 0; k < n; ++k) {
    const lines = 6000 + 4000 * k, side = () => {
      let text = '';
      for (let i = 0; i < lines; ++i) text += `line ${random() % 48}
`;
      return enc.encode(text);
    };
    yield [side(), side()];
  }
}

function* corpusCases(dir) {
  if (!dir || !existsSync(join(dir, 'count'))) return;
  const count = Number(readFileSync(join(dir, 'count'), 'utf8'));
  for (let i = 0; i < count; ++i) yield [readFileSync(join(dir, `${i}.old`)), readFileSync(join(dir, `${i}.new`))];
}

function nativeScripts(batch, scratch) {
  const size = 4 + batch.reduce((n, [a, b]) => n + 8 + a.length + b.length, 0);
  const buf = Buffer.alloc(size);
  let o = buf.writeUInt32LE(batch.length, 0);
  for (const [a, b] of batch) { o = buf.writeUInt32LE(a.length, o); buf.set(a, o); o += a.length; o = buf.writeUInt32LE(b.length, o); buf.set(b, o); o += b.length; }
  writeFileSync(join(scratch, 'pairs.bin'), buf);
  execFileSync(join(root, 'build/script_dump'), [join(scratch, 'pairs.bin'), join(scratch, 'out.bin')], { stdio: 'inherit' });
  const out = readFileSync(join(scratch, 'out.bin'));
  const scripts = [];
  for (let p = 0; p < out.length;) {
    const status = out.readInt32LE(p), count = out.readUInt32LE(p + 4);
    scripts.push({ status, count, records: new Uint32Array(out.buffer.slice(out.byteOffset + p + 8, out.byteOffset + p + 8 + 16 * count)) });
    p += 8 + 16 * count;
  }
  return scripts;
}

function fail(what, index, a, b) {
  const show = (x) => JSON.stringify(Buffer.from(x.subarray(0, 200)).toString('latin1'));
  console.error(`FAIL [wasm ${buildName}]: ${what} pair=${index} seed=0x${startSeed.toString(16)} a_len=${a.length} b_len=${b.length}`);
  if (a.length < 200 && b.length < 200) console.error(`  a=${show(a)}\n  b=${show(b)}`);
  process.exit(1);
}

const sameRecords = (w, n) => {
  if (w.count !== n.count) return false;
  for (let i = 0; i < w.count; ++i)
    if (w.aStart[i] !== n.records[4 * i] || w.bStart[i] !== n.records[4 * i + 1] ||
        w.aCount[i] !== n.records[4 * i + 2] || w.bCount[i] !== n.records[4 * i + 3]) return false;
  return true;
};

const scratch = mkdtempSync(join(tmpdir(), 'seams-wasm-'));
const counts = { edge: 0, fuzz: 0, corpus: 0, cutoff: 0 };
let index = 0;
function checkAll(kind, cases, batchSize) {
  let batch = [];
  const flush = () => {
    const native = nativeScripts(batch, scratch);
    batch.forEach(([a, b], k) => {
      const n = native[k];
      if (n.status !== 0) fail(`native status ${n.status}`, index, a, b);
      const vector = seams.diff(a, b, { simd: true, fast });
      const scalar = seams.diff(a, b, { simd: false, fast });
      if (!sameRecords(scalar, n)) fail('scalar script differs from native', index, a, b);
      if (!sameRecords(vector, n)) fail('SIMD script differs from native', index, a, b);
      const rebuilt = seams.apply(vector);
      if (rebuilt.status !== 0 || Buffer.compare(Buffer.from(rebuilt.bytes), Buffer.from(b)) !== 0) fail('apply round trip', index, a, b);
      index++;
      counts[kind]++;
    });
    batch = [];
  };
  for (const pair of cases) { batch.push(pair); if (batch.length === batchSize) flush(); }
  if (batch.length) flush();
}

function checkBadScripts() {
  const a = enc.encode('a\nb\nc\n'), b = enc.encode('a\nX\nc\n');
  seams.diff(a, b);
  const bad = (aStart, bStart, aCount, bCount) => ({ count: 1, aStart: [aStart], bStart: [bStart], aCount: [aCount], bCount: [bCount] });
  if (seams.apply(bad(2, 1, 1, 1)).status !== -4) fail('misaligned record accepted', 0, a, b);
  if (seams.apply(bad(1, 1, 5, 1)).status !== -4) fail('record past end accepted', 0, a, b);
}

try {
  checkBadScripts();
  checkAll('edge', edgeCases(), 500);
  checkAll('fuzz', fuzzCases(fuzzPairs), 5000);
  checkAll('corpus', corpusCases(process.env.SEAMS_CORPUS), 300);
  checkAll('cutoff', cutoffCases(6), 6);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`PASS [wasm ${buildName}${fast ? ', fast' : ''}]: ${counts.edge} edge, ${counts.fuzz} fuzz (seed 0x${startSeed.toString(16)}), ` +
  `${counts.corpus} corpus, ${counts.cutoff} large shuffled pairs: scalar and SIMD scripts identical to native, apply round trip, bad scripts rejected`);
