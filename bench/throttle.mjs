// Opening and scrolling a 1M-line diff on a slow machine: the CPU slowed 1x, 4x and 6x (a laptop
// on battery, a hot laptop throttling), live diff against a pack made ahead of time.
// Needs the viewer served (node web/serve.mjs 4174) and the pack made:
//   node tools/seams-pack.mjs <fixtures>/1m.old.ts <fixtures>/1m.e100.new.ts -o <fixtures>/1m.e100.seamspack
//   node bench/throttle.mjs
import { chromium } from '../web/node_modules/playwright-core/index.mjs';

const stats = (d, vsync) => {
  const s = [...d].sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p50: q(0.5), p99: q(0.99), dropped: s.filter((x) => x > vsync * 1.5).length, frames: s.length };
};

const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1600,1000'] });
for (const rate of [1, 4, 6]) {
  for (const how of ['live', 'pack']) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto('http://localhost:4174/');
    await page.waitForFunction(() => window.viewerReady === true);
    const vsync = await page.evaluate(() => new Promise((res) => {
      const d = []; let last;
      const tick = (t) => { if (last) d.push(t - last); last = t; if (d.length < 90) requestAnimationFrame(tick); else res(d.sort((x, y) => x - y)[45]); };
      requestAnimationFrame(tick);
    }));
    // the files are fetched before the clock starts, as they are for every viewer in bench/compare_pierre.mjs
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const r = await page.evaluate((how) => (how === 'pack'
      ? window.viewer.loadPack('/fixtures/1m.e100.seamspack')
      : window.viewer.loadUrls('/fixtures/1m.old.ts', '/fixtures/1m.e100.new.ts')), how);
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.__d = []; let last; window.__run = true; const t = (x) => { if (last) window.__d.push(x - last); last = x; if (window.__run) requestAnimationFrame(t); }; requestAnimationFrame(t); });
    await cdp.send('Input.synthesizeScrollGesture', { x: 750, y: 450, yDistance: -20000, speed: 4000, gestureSourceType: 'mouse' });
    const scroll = stats(await page.evaluate(() => { window.__run = false; return window.__d; }), vsync);
    console.log(`cpu ${rate}x  ${how.padEnd(4)}  first frame ${r.firstFrame.toFixed(0).padStart(5)} ms (diff ${r.diff.toFixed(0)}, layout ${r.layout.toFixed(0)})  ` +
      `scroll p50/p99 ${scroll.p50.toFixed(1)}/${scroll.p99.toFixed(1)} ms, dropped ${scroll.dropped}/${scroll.frames}`);
    await ctx.close();
  }
}
await browser.close();
