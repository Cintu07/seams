// milestone 13 checks: highlighting shows, first frame not delayed, states arrive, no errors
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge' });
const p = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:4174/');
await p.waitForFunction(() => window.viewerReady === true);
for (const [o, n] of [['10k.old.ts', '10k.e100.new.ts'], ['1m.old.ts', '1m.e100.new.ts']]) {
  const r = await p.evaluate(([o, n]) => window.viewer.loadUrls(`/fixtures/${o}`, `/fixtures/${n}`), [o, n]);
  await p.waitForFunction(() => window.viewer.renderer.diff.timing.states !== undefined, null, { timeout: 30000 });
  const t = await p.evaluate(() => window.viewer.renderer.diff.timing);
  console.log(n, `first frame ${r.firstFrame.toFixed(0)} ms, diff ${t.diff.toFixed(0)}, line states ${t.states.toFixed(0)} ms (in the worker, after the first frame)`);
}
await p.evaluate(() => { window.viewer.renderer.scrollTo(400); });
await p.waitForTimeout(300);
await p.screenshot({ path: 'C:/Users/pavan/Desktop/site-redesign/shots/seams-highlight-sage.png' });
await p.keyboard.press('t'); await p.click('#view'); await p.keyboard.press('t'); await p.waitForTimeout(300);
await p.screenshot({ path: 'C:/Users/pavan/Desktop/site-redesign/shots/seams-highlight-dusk.png' });
console.log(errs.length ? errs : 'no script errors');
await browser.close();
