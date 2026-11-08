#!/usr/bin/env node
// Diff two files once, ahead of time, and write a pack a viewer opens without diffing.
//   node tools/seams-pack.mjs old new [-o out.seamspack] [--name main.ts]
// The pack holds both files, so it is about as large as they are; serve it compressed.
import { readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadSeams } from '../wasm/seams.mjs';
import { language, languageOf, lineStates } from '../web/lex.mjs';
import { writePack } from '../web/pack.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
let out = flag('-o');
const name = flag('--name');
if (args.length !== 2) {
  console.error('usage: node tools/seams-pack.mjs old new [-o out.seamspack] [--name main.ts]');
  process.exit(2);
}
const [oldPath, newPath] = args;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seams = await loadSeams(readFileSync(join(root, 'build/seams.wasm')));
const a = new Uint8Array(readFileSync(oldPath)), b = new Uint8Array(readFileSync(newPath));
const t0 = performance.now();
const script = seams.diff(a, b, { fast: true });
const tables = seams.lineTables();
const lang = languageOf(name ?? newPath) ?? languageOf(oldPath);
const L = language(lang);
const states = L ? { a: lineStates(L, a, script.aLines), b: lineStates(L, b, script.bLines) } : null;
const pack = writePack({ a, b, names: [basename(oldPath), basename(name ?? newPath)], lang, tables, script, states });
out ??= basename(newPath) + '.seamspack';
writeFileSync(out, pack);
console.log(`${out}: ${(pack.length / 2 ** 20).toFixed(1)} MiB, ${script.count} changes, made in ${(performance.now() - t0).toFixed(0)} ms`);
