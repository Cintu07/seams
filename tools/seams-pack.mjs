#!/usr/bin/env node
// Diff two files once, ahead of time, and write a pack a viewer opens without diffing.
//   node tools/seams-pack.mjs old new [-o out.seamspack] [--name main.ts] [--page out.html [--lib url]]
// The pack holds both files, so it is about as large as they are; serve it compressed.
// --page also writes a page with the first screen of the diff already in its html, so the reader
// sees the change before any script has run; the viewer takes over on top of it once the pack is in.
import { readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadSeams } from '../wasm/seams.mjs';
import { language, languageOf, lineStates } from '../web/lex.mjs';
import { writePack } from '../web/pack.mjs';
import { layoutUnified, ROW_DELETED, ROW_INSERTED } from '../web/layout.mjs';

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
let out = flag('-o');
const name = flag('--name');
const pagePath = flag('--page');
const lib = flag('--lib') ?? 'https://cintu07.github.io/seams/lib/index.mjs';
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

if (pagePath) {
  // the first screen, as plain html: the same rows the viewer will draw, from the same layout
  const rows = layoutUnified(script, script.aLines, script.bLines);
  const text = (bytes, starts, lens, line) => new TextDecoder().decode(bytes.subarray(starts[line], starts[line] + lens[line])).replace(/\r?\n$/, '').replace(/\t/g, '    ');
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  let html = '';
  for (let r = 0; r < Math.min(60, rows.kind.length); ++r) {
    const k = rows.kind[r], al = rows.aLine[r], bl = rows.bLine[r];
    const body = al >= 0 ? text(a, tables.aStart, tables.aLen, al) : text(b, tables.bStart, tables.bLen, bl);
    const cls = k === ROW_DELETED ? ' class="d"' : k === ROW_INSERTED ? ' class="i"' : '';
    html += `<div${cls}><span>${al >= 0 ? al + 1 : ''}</span><span>${bl >= 0 ? bl + 1 : ''}</span><span>${k === ROW_DELETED ? '-' : k === ROW_INSERTED ? '+' : ' '}</span>${esc(body)}</div>`;
  }
  const title = basename(name ?? newPath);
  writeFileSync(pagePath, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · seams</title>
<style>
html, body { margin: 0; height: 100%; background: #c3dbc8; color: #1b2a21; font-family: "IBM Plex Mono", "Cascadia Mono", Consolas, monospace; }
body { display: grid; grid-template-rows: auto 1fr; }
header { padding: 10px 16px; font-size: 14px; border-bottom: 1px solid #9fbfa6; }
#view { position: relative; min-height: 0; overflow: hidden; background: #b9d5be; }
#first, #live { position: absolute; inset: 0; }
#first { font-size: 13px; line-height: 1.75; white-space: pre; overflow: hidden; }
#first div span { display: inline-block; width: 7ch; text-align: right; color: #6f8f78; padding-right: 1ch; }
#first div span:nth-child(3) { width: 2ch; text-align: left; padding: 0; }
#first .d { background: #ecc8c0; } #first .i { background: #c8e3cc; }
#live { visibility: hidden; }
</style></head><body>
<header>${esc(title)} · ${script.count} changes</header>
<div id="view"><div id="first">${html}</div><div id="live"></div></div>
<script type="module">
import { createDiffViewer } from ${JSON.stringify(lib)};
const live = document.getElementById('live');
const viewer = createDiffViewer(live, { theme: 'sage' });
await viewer.setPack(${JSON.stringify(basename(out))});
live.style.visibility = 'visible';
document.getElementById('first').remove();
window.seamsLive = performance.now();
</script></body></html>
`);
  console.log(`${pagePath}: first ${Math.min(60, rows.kind.length)} rows in the html, viewer from ${lib}`);
}
