// Characters beyond ascii and word-level marks, in a real browser.
// Writes a small diff with Japanese, an emoji, accents, a combining mark and tabs; checks they draw,
// that copy gives the exact line back, and that changed words are marked.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';

const FIX = 'C:/Users/pavan/Desktop/seems/scratch/pierre_bench/fixtures/';
const oldText = [
  '// 名前: パワン — a café, a naïve résumé',
  'const greeting = "こんにちは世界";',
  'const mood = "🙂 fine";',
  'function total(items) {',
  '\treturn items.reduce((sum, x) => sum + x.price, 0);',
  '}',
  'const e\u0301 = "combining accent";',
  'export const limit = 100;',
].join('\n') + '\n';
const newText = [
  '// 名前: パワン — a café, a naïve résumé',
  'const greeting = "こんばんは世界";',
  'const mood = "🙂 great";',
  'function total(items, tax) {',
  '\treturn items.reduce((sum, x) => sum + x.price * tax, 0);',
  '}',
  'const e\u0301 = "combining accent";',
  'export const limit = 250;',
].join('\n') + '\n';
writeFileSync(FIX + 'uni.old.ts', oldText);
writeFileSync(FIX + 'uni.new.ts', newText);

const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 520 }, permissions: ['clipboard-read', 'clipboard-write'] });
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:4174/?old=uni.old.ts&new=uni.new.ts');
await p.waitForFunction(() => window.viewerReady === true);
await p.waitForTimeout(600);
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
await p.screenshot({ path: 'C:/Users/pavan/Desktop/site-redesign/shots/seams-unicode.png' });

const info = await p.evaluate(() => {
  const r = window.viewer.renderer;
  return { glyphs: r.glyphs.size, pairs: !!r.diff.pairs, rows: r.rowCount };
});
ok('non-ascii glyphs drawn into the atlas', info.glyphs >= 12, `${info.glyphs} glyphs`);
ok('changed lines are paired', info.pairs);

// copy the greeting line from the new side: double click its row, ctrl+c
const box = await p.locator('#view').boundingBox();
const cellH = await p.evaluate(() => window.viewer.renderer.cell.h / window.viewer.renderer.dpr);
const rowOf = await p.evaluate(() => { const d = window.viewer.renderer.diff; return d.rows.bRow[1]; });
await p.mouse.dblclick(box.x + 400, box.y + cellH * (rowOf + 0.5));
await p.keyboard.press('Control+c');
const copied = await p.evaluate(() => navigator.clipboard.readText());
ok('copy returns the japanese line exactly', copied === 'const greeting = "こんばんは世界";', JSON.stringify(copied));

// word marks: the changed words of the greeting pair
const words = await p.evaluate(async () => {
  const { wordDiff } = await import('/words.mjs');
  const r = window.viewer.renderer, d = r.diff;
  const [ba, sa, ea] = r.lineSpan('a', 1), [bb, sb, eb] = r.lineSpan('b', 1);
  const w = wordDiff(ba, sa, ea, bb, sb, eb), dec = new TextDecoder();
  return w && { a: w.a.map(([s, e]) => dec.decode(ba.subarray(sa + s, sa + e))), b: w.b.map(([s, e]) => dec.decode(bb.subarray(sb + s, sb + e))) };
});
ok('word marks find the changed word', words && words.b.join('') === 'こんばんは世界', JSON.stringify(words));
const limit = await p.evaluate(async () => {
  const { wordDiff } = await import('/words.mjs');
  const r = window.viewer.renderer, dec = new TextDecoder();
  const [ba, sa, ea] = r.lineSpan('a', 7), [bb, sb, eb] = r.lineSpan('b', 7);
  const w = wordDiff(ba, sa, ea, bb, sb, eb);
  return w && w.b.map(([s, e]) => dec.decode(bb.subarray(sb + s, sb + e)));
});
ok('only the number is marked in "limit = 100 -> 250"', JSON.stringify(limit) === '["250"]', JSON.stringify(limit));

await p.click('#viewToggle'); await p.waitForTimeout(300);
await p.screenshot({ path: 'C:/Users/pavan/Desktop/site-redesign/shots/seams-unicode-split.png' });
console.log(errs.length ? errs : 'no script errors');
await browser.close();
