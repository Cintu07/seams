// a packed diff must be the live diff: same rows, same changes, same split view, find still works
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge' });
const p = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:4174/');
await p.waitForFunction(() => window.viewerReady === true);
const ok = (name, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
const digest = () => p.evaluate(() => {
  const d = window.viewer.renderer.diff, sum = (arr) => { let h = 0; for (let i = 0; i < arr.length; ++i) h = (h * 31 + arr[i]) | 0; return h; };
  return { rows: d.rows.kind.length, kind: sum(d.rows.kind), aLine: sum(d.rows.aLine), bLine: sum(d.rows.bLine),
    split: d.split.left.length, left: sum(d.split.left), right: sum(d.split.right), deleted: d.deleted, inserted: d.inserted };
});
await p.evaluate(() => window.viewer.loadUrls('/fixtures/1m.old.ts', '/fixtures/1m.e100.new.ts'));
const live = await digest();
const t = await p.evaluate(() => window.viewer.loadPack('/fixtures/1m.e100.seamspack'));
const packed = await digest();
ok('pack rows and changes equal the live diff', JSON.stringify(live) === JSON.stringify(packed), JSON.stringify(packed));
ok('pack opens without diffing', t.diff === 0, `first frame ${t.firstFrame.toFixed(0)} ms`);
await p.click('#viewToggle'); await p.waitForTimeout(300);
ok('split view from a pack', await p.evaluate(() => window.viewer.renderer.split && window.viewer.renderer.rowCount > 0));
await p.keyboard.press('Control+f');
await p.fill('#findInput', 'PieceTable');
await p.waitForFunction(() => { const c = document.getElementById('findCount').textContent; return c && !c.includes('searching'); });
ok('find in a pack', !(await p.textContent('#findCount')).includes('no matches'), await p.textContent('#findCount'));
console.log(errs.length ? errs : 'no script errors');
await browser.close();
