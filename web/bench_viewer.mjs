// Viewer benchmark in a real browser window (Edge, GPU on). Needs `node web/serve.mjs` running.
// Per fixture: data in memory -> first painted frame, then scrolling at a fixed speed and random
// jumps, one per frame. Reports frame-to-frame time (what the screen shows) and CPU time per frame.
//   node web/bench_viewer.mjs [rows per frame] [frames]
import { chromium } from 'playwright-core';

const base = process.env.SEAMS_VIEWER ?? 'http://localhost:4174/';
const rowsPerFrame = Number(process.argv[2] ?? 3), frames = Number(process.argv[3] ?? 600);
const pairs = [['10k.old.ts', '10k.e100.new.ts'], ['100k.old.ts', '100k.e100.new.ts'], ['1m.old.ts', '1m.e100.new.ts'],
  ['1m.old.ts', '1m.e10000.new.ts']];
const f = (x) => x.toFixed(2);

const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1600,1000'] });
const page = await (await browser.newContext({ viewport: null })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);
await page.waitForFunction(() => window.viewerReady === true);
const vsync = await page.evaluate(() => window.viewer.idle(1000));
console.log(`display frame interval p50 ${f(vsync.p50)} ms (${(1000 / vsync.p50).toFixed(0)} Hz)`);
for (const [o, n] of pairs) {
  const load = await page.evaluate(([o, n]) => window.viewer.loadUrls(`/fixtures/${o}`, `/fixtures/${n}`), [o, n]);
  // the load frees the previous diff; let that garbage collection finish before measuring scrolling
  await page.waitForTimeout(3000);
  const scroll = await page.evaluate(([r, k]) => window.viewer.autoscroll(r, k), [rowsPerFrame, frames]);
  const jump = await page.evaluate((k) => window.viewer.jumps(k), Math.floor(frames / 2));
  const heap = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : NaN);
  const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
  console.log(`${n} rows=${load.rows} diff=${f(load.diff)} layout=${f(load.layout)} first_screen=${f(load.firstScreen)} first_frame=${f(load.firstFrame)} ms | ` +
    `scroll frame p50/p99/max ${f(scroll.frame.p50)}/${f(scroll.frame.p99)}/${f(scroll.frame.max)} cpu p99 ${f(scroll.cpu.p99)} | ` +
    `jump frame p50/p99/max ${f(jump.frame.p50)}/${f(jump.frame.p99)}/${f(jump.frame.max)} cpu p99 ${f(jump.cpu.p99)} | ` +
    `heap ${heap.toFixed(0)} MiB dom ${dom}`);
}
if (errors.length) console.log('page errors:', errors);
await browser.close();
