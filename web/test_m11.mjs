// milestone 11 checks in a real browser: split view, find counts, copy text, mirror
import { chromium } from 'playwright-core';
import { readFileSync } from 'fs';
const FIX = 'C:/Users/pavan/Desktop/seems/scratch/pierre_bench/fixtures/';
const [oldName, newName] = ['10k.old.ts', '10k.e100.new.ts'];
const a = readFileSync(FIX + oldName), b = readFileSync(FIX + newName);
const count = (buf, s) => { let n = 0, i = -1; const needle = Buffer.from(s); while ((i = buf.indexOf(needle, i + 1)) !== -1) ++n; return n; };
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://localhost:4174/?old=${oldName}&new=${newName}`);
await p.waitForFunction(() => window.viewerReady === true);
await p.waitForTimeout(500);
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);

// split view
await p.click('#viewToggle'); await p.waitForTimeout(300);
const splitRows = await p.evaluate(() => window.viewer.renderer.rowCount);
ok('split view on', await p.evaluate(() => window.viewer.renderer.split), `rows=${splitRows}`);
await p.screenshot({ path: 'C:/Users/pavan/Desktop/site-redesign/shots/seams-split.png' });

// find in split view: every occurrence in both files
for (const q of ['const', 'edit', 'zzz-not-there']) {
  await p.keyboard.press('Control+f');
  await p.fill('#findInput', q);
  await p.waitForFunction((q) => { const t = document.getElementById('findCount').textContent; return t && !t.includes('searching'); }, q);
  await p.waitForTimeout(200);
  const text = await p.textContent('#findCount');
  const shown = text === 'no matches' ? 0 : Number(text.split('/')[1].replace(/[^\d]/g, ''));
  const expect = count(a, q) + count(b, q);
  ok(`find "${q}" in split`, shown === expect, `shown=${shown} expected=${expect}`);
  if (q === 'const') { await p.keyboard.press('Enter'); await p.keyboard.press('Enter'); await p.waitForTimeout(200); await p.screenshot({ path: 'C:/Users/pavan/Desktop/site-redesign/shots/seams-find.png' }); }
}
await p.keyboard.press('Enter'); await p.keyboard.press('Enter');
await p.screenshot({ path: 'C:/Users/pavan/Desktop/site-redesign/shots/seams-find.png' });
await p.keyboard.press('Escape');

// copy: double-click a line in the left pane selects it; Ctrl+C must give exactly that line
await p.click('#viewToggle'); await p.waitForTimeout(200);   // back to unified
await p.evaluate(() => { window.viewer.renderer.scrollTo(4); });
const box = await p.locator('#view').boundingBox();
const cellH = await p.evaluate(() => window.viewer.renderer.cell.h / window.viewer.renderer.dpr);
const y = box.y + cellH * 2.5, x = box.x + 300;
await p.mouse.dblclick(x, y); await p.waitForTimeout(150);
await p.keyboard.press('Control+c');
const copied = await p.evaluate(() => navigator.clipboard.readText());
const lineNo = await p.evaluate(() => { const r = window.viewer.renderer; const row = Math.floor(r.scrollRow) + 2; return r.split ? -1 : (r.diff.rows.kind[row] === 2 ? -1 : r.diff.rows.aLine[row]); });
// copy leaves out the line ending; this file has CRLF endings
const expectLine = a.toString('utf8').split('\n')[lineNo].replace(/\r$/, '');
ok('copy a line', copied === expectLine, `\n  got:      ${JSON.stringify(copied)}\n  expected: ${JSON.stringify(expectLine)} (line ${lineNo})`);

// drag-select across 3 lines from column 0
await p.mouse.move(box.x + 160, box.y + cellH * 1.5);
await p.mouse.down(); await p.mouse.move(box.x + 160, box.y + cellH * 3.5, { steps: 5 }); await p.mouse.up();
await p.keyboard.press('Control+c');
const multi = await p.evaluate(() => navigator.clipboard.readText());
ok('drag selection copies several lines', multi.split('\n').length === 3, `${multi.split('\n').length} lines`);

// screen-reader mirror lists the visible lines
const mirrorItems = await p.evaluate(() => [...document.querySelectorAll('#mirror li')].map((li) => li.textContent));
ok('mirror lists visible lines', mirrorItems.length > 10, `${mirrorItems.length} items, e.g. "${(mirrorItems[2] ?? '').slice(0, 50)}"`);
console.log(errs.length ? errs : 'no script errors');
await browser.close();
