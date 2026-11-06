// Times the WebAssembly core under Node: median of runs, one engine reused like the native benches.
//   node bench/wasm_bench.mjs old new [runs]        one file pair
//   node bench/wasm_bench.mjs --corpus dir [runs]   every <n>.old/<n>.new pair in dir, timed as one loop
// The time covers copying both inputs into wasm memory, as a browser worker would have to.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { loadSeams } from '../wasm/seams.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seams = await loadSeams(readFileSync(join(root, 'build/seams.wasm')));
const median = (t) => t.sort((x, y) => x - y)[t.length >> 1];
const edits = (s) => { let n = 0; for (let i = 0; i < s.count; ++i) n += s.aCount[i] + s.bCount[i]; return n; };

function time(pairs, runs, simd) {
  const times = [];
  let total = 0;
  for (let r = 0; r < runs; ++r) {
    total = 0;
    const start = performance.now();
    for (const [a, b] of pairs) total += edits(seams.diff(a, b, { simd }));
    times.push(performance.now() - start);
  }
  return { ms: median(times), edits: total };
}

const args = process.argv.slice(2);
if (args[0] === '--corpus') {
  const dir = args[1], runs = Number(args[2] ?? 9);
  const count = Number(readFileSync(join(dir, 'count'), 'utf8'));
  const pairs = [];
  for (let i = 0; i < count; ++i) pairs.push([readFileSync(join(dir, `${i}.old`)), readFileSync(join(dir, `${i}.new`))]);
  const bytes = pairs.reduce((n, [a, b]) => n + a.length + b.length, 0);
  time(pairs, 1, true);
  for (const simd of [false, true]) {
    const { ms, edits: e } = time(pairs, runs, simd);
    console.log(`wasm ${simd ? 'simd128' : 'scalar'} pairs=${count} median_ms=${ms.toFixed(2)} diffs/s=${(count / ms * 1e3).toFixed(0)} MB/s=${(bytes / 1e3 / ms).toFixed(0)} edits=${e}`);
  }
} else {
  const a = readFileSync(args[0]), b = readFileSync(args[1]), runs = Number(args[2] ?? 9);
  time([[a, b]], 1, true);
  for (const simd of [false, true]) {
    const { ms, edits: e } = time([[a, b]], runs, simd);
    console.log(`wasm ${simd ? 'simd128' : 'scalar'} median_ms=${ms.toFixed(3)} MB/s=${((a.length + b.length) / 1e3 / ms).toFixed(0)} edits=${e}`);
  }
}
