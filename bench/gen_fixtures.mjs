// Builds seeded old/new file pairs from real TypeScript lines.
// usage: node gen_fixtures.mjs <corpus_dir> <out_dir>
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const [corpusDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|tsx)$/.test(name)) yield path;
  }
}

const corpus = [];
for (const path of walk(corpusDir)) {
  for (const line of readFileSync(path, 'utf8').split('\n')) corpus.push(line);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function takeLines(count, offset) {
  const lines = new Array(count);
  for (let i = 0; i < count; i++) lines[i] = corpus[(offset + i) % corpus.length];
  return lines;
}

function mutateLine(line, rand) {
  const at = Math.floor(rand() * (line.length + 1));
  return line.slice(0, at) + 'edit' + Math.floor(rand() * 1e6) + line.slice(at);
}

// each edit replaces, inserts or deletes 1 to 3 lines at a random spot
function applyEdits(oldLines, editCount, seed) {
  const rand = rng(seed);
  const spots = new Set();
  while (spots.size < editCount) spots.add(Math.floor(rand() * oldLines.length));
  const sorted = [...spots].sort((a, b) => a - b);
  const out = [];
  let cursor = 0;
  for (const spot of sorted) {
    if (spot < cursor) continue;
    while (cursor < spot) out.push(oldLines[cursor++]);
    const kind = Math.floor(rand() * 3);
    const size = 1 + Math.floor(rand() * 3);
    if (kind === 0) {
      for (let i = 0; i < size && cursor < oldLines.length; i++) out.push(mutateLine(oldLines[cursor++], rand));
    } else if (kind === 1) {
      for (let i = 0; i < size; i++) out.push(mutateLine(corpus[Math.floor(rand() * corpus.length)], rand));
    } else {
      cursor = Math.min(oldLines.length, cursor + size);
    }
  }
  while (cursor < oldLines.length) out.push(oldLines[cursor++]);
  return out;
}

const write = (name, lines) => writeFileSync(join(outDir, name), lines.join('\n') + '\n');

const sizes = { '10k': 10_000, '100k': 100_000, '1m': 1_000_000 };
for (const [label, count] of Object.entries(sizes)) {
  const oldLines = takeLines(count, 0);
  write(`${label}.old.ts`, oldLines);
  for (const edits of [1, 100, 10_000]) {
    if (edits * 2 > count) continue;
    write(`${label}.e${edits}.new.ts`, applyEdits(oldLines, edits, 1234 + edits));
  }
}

// divergent pairs: two far-apart windows of the corpus, almost no lines in common
for (const [label, count] of Object.entries({ '2k': 2_000, '10k': 10_000, '50k': 50_000 })) {
  write(`div${label}.old.ts`, takeLines(count, 0));
  write(`div${label}.new.ts`, takeLines(count, Math.floor(corpus.length / 2)).map((l) => l + ' //x'));
}

console.log(`corpus lines: ${corpus.length}`);
