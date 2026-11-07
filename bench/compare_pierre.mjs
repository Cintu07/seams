// Milestone 12: seams viewer vs @pierre/diffs on the same machine, browser and files.
// Needs both pages served: the seams viewer (node web/serve.mjs, :4174) and the Pierre bench page
// (scratch/pierre_bench, vite preview, :4173). Both get the same input: real scroll gestures sent by
// the browser, the same random jumps, the same garbage-collected heap reading.
//   node bench/compare_pierre.mjs [out.json]
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'fs';

const SEAMS = 'http://localhost:4174/';
const PIERRE = 'http://localhost:4173/';
const pairs = [['10k.old.ts', '10k.e100.new.ts'], ['100k.old.ts', '100k.e100.new.ts'], ['1m.old.ts', '1m.e100.new.ts'],
  ['1m.old.ts', '1m.e10000.new.ts'], ['div10k.old.ts', 'div10k.new.ts']];
const viewers = [
  { name: 'seams', url: SEAMS, load: (o, n) => window.viewer.loadUrls(`/fixtures/${o}`, `/fixtures/${n}`).then((r) => ({ firstFrame: r.firstFrame, compute: r.diff })) },
  { name: 'pierre plain', url: `${PIERRE}?version=164&highlighter=none&diffLib=jsdiff`, load: (o, n) => window.bench.load(o, n).then((r) => ({ firstFrame: r.firstFrameMs, compute: r.parseMs })) },
  { name: 'pierre highlighted', url: `${PIERRE}?version=164&highlighter=highlights&diffLib=jsdiff`, load: (o, n) => window.bench.load(o, n).then((r) => ({ firstFrame: r.firstFrameMs, compute: r.parseMs, highlighted: r.highlightedMs })) },
];

// VIEWERS=seams runs only the named viewers (comma separated)
const only = process.env.VIEWERS?.split(',');
if (only) viewers.splice(0, viewers.length, ...viewers.filter((v) => only.includes(v.name)));

const stats = (d, vsync) => {
  const s = [...d].sort((x, y) => x - y), q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { frames: s.length, p50: q(0.5), p99: q(0.99), max: s[s.length - 1], dropped: s.filter((x) => x > vsync * 1.5).length };
};

const browser = await chromium.launch({ channel: 'msedge', headless: false, args: ['--window-size=1600,1000'] });
const results = [];
for (const [o, n] of pairs) {
  for (const v of viewers) {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(v.url);
    await page.waitForFunction(() => window.viewerReady === true || window.benchReady === true, null, { timeout: 60000 });
    // the display's frame interval, measured, not assumed
    const vsync = await page.evaluate(() => new Promise((res) => {
      const d = []; let last;
      const tick = (t) => { if (last) d.push(t - last); last = t; if (d.length < 90) requestAnimationFrame(tick); else res(d.sort((x, y) => x - y)[45]); };
      requestAnimationFrame(tick);
    }));
    const load = await page.evaluate(([src, o, n]) => (0, eval)(src)(o, n), [v.load.toString(), o, n]);
    await page.waitForTimeout(2500);
    // seams highlights too: its line states are in before the scroll test starts
    if (v.name === 'seams') load.highlighted = await page.evaluate(() => new Promise((r) => { const w = () => { const t = window.viewer.renderer.diff.timing; if (t.states !== undefined) r(t.firstFrame + t.states); else setTimeout(w, 50); }; w(); }));
    // a real scroll gesture, the same for both
    await page.evaluate(() => { window.__d = []; let last; window.__run = true; const t = (x) => { if (last) window.__d.push(x - last); last = x; if (window.__run) requestAnimationFrame(t); }; requestAnimationFrame(t); });
    await cdp.send('Input.synthesizeScrollGesture', { x: 750, y: 450, yDistance: -20000, speed: 4000, gestureSourceType: 'mouse' });
    const scroll = stats(await page.evaluate(() => { window.__run = false; return window.__d; }), vsync);
    // the same gesture again after a warm-up, as a user scrolling a second time would see it
    await cdp.send('Input.synthesizeScrollGesture', { x: 750, y: 450, yDistance: 20000, speed: 8000, gestureSourceType: 'mouse' });
    await page.evaluate(() => { window.__d = []; let last; window.__run = true; const t = (x) => { if (last) window.__d.push(x - last); last = x; if (window.__run) requestAnimationFrame(t); }; requestAnimationFrame(t); });
    await cdp.send('Input.synthesizeScrollGesture', { x: 750, y: 450, yDistance: -20000, speed: 4000, gestureSourceType: 'mouse' });
    const warm = stats(await page.evaluate(() => { window.__run = false; return window.__d; }), vsync);
    // random jumps, each timed over the two frames it takes to show
    // Pierre's plain mode takes seconds per jump on 1M lines, so it gets 10 jumps there instead of 60
    const jumpCount = v.name !== 'seams' && n.startsWith('1m') ? 10 : 60;
    const jumps = await page.evaluate(async ([name, count]) => {
      const raf = () => new Promise((r) => requestAnimationFrame(r));
      let s = 12345; const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
      const out = [];
      for (let i = 0; i < count; ++i) {
        const t0 = performance.now();
        if (name === 'seams') { const r = window.viewer.renderer; r.scrollTo(Math.floor(rand() * r.rowCount)); r.draw(); }
        else { const total = window.bench.fileDiff.additionLines.length; window.bench.viewer.scrollTo({ type: 'line', id: 'diff', lineNumber: 1 + Math.floor(rand() * total), side: 'additions', align: 'center' }); }
        await raf(); await raf();
        out.push(performance.now() - t0);
      }
      return out;
    }, [v.name, jumpCount]);
    await cdp.send('HeapProfiler.collectGarbage');
    const external = v.name === 'seams' ? await page.evaluate(() => { const d = window.viewer.renderer.diff; let n = 0; const add = (o) => { for (const x of Object.values(o)) if (ArrayBuffer.isView(x)) n += x.byteLength; }; add(d); add(d.tables); add(d.rows); add(d.split); return n; }) : 0;
    const heap = ((await cdp.send('Runtime.getHeapUsage')).usedSize + external) / 2 ** 20;
    const dom = await page.evaluate(() => { let c = 0; const walk = (n) => { for (const k of n.children ?? []) { c++; if (k.shadowRoot) walk(k.shadowRoot); walk(k); } }; walk(document); return c; });
    const row = { pair: n, viewer: v.name, vsync, ...load, scroll, warm, jumps: stats(jumps, vsync * 2), heapMiB: heap, dom };
    results.push(row);
    console.log(`${n.padEnd(18)} ${v.name.padEnd(18)} first ${load.firstFrame.toFixed(0)}ms (compute ${load.compute.toFixed(0)}${load.highlighted ? `, highlighted ${load.highlighted.toFixed(0)}` : ''}) | scroll p50/p99 ${row.scroll.p50.toFixed(1)}/${row.scroll.p99.toFixed(1)} dropped ${row.scroll.dropped}/${row.scroll.frames} | warm p50/p99 ${row.warm.p50.toFixed(1)}/${row.warm.p99.toFixed(1)} dropped ${row.warm.dropped}/${row.warm.frames} | jump p50/p99 ${row.jumps.p50.toFixed(1)}/${row.jumps.p99.toFixed(1)} | heap ${heap.toFixed(0)} MiB | dom ${dom}`);
    await ctx.close();
  }
}
await browser.close();
writeFileSync(process.argv[2] ?? 'bench/results/compare-pierre.json', JSON.stringify(results, null, 1));
