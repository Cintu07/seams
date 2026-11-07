// the same 60 seeded jumps twice on the 1M-line diff: the second pass shows the steady cost of a jump
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'msedge', headless: false });
const p = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
await p.goto('http://localhost:4174/?old=1m.old.ts&new=1m.e10000.new.ts');
await p.waitForFunction(() => window.viewerReady === true, null, { timeout: 120000 });
await p.waitForTimeout(2000);
const passes = await p.evaluate(async () => {
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const run = async () => {
    let s = 12345; const rand = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
    const out = [];
    for (let i = 0; i < 60; ++i) {
      const t0 = performance.now(), r = window.viewer.renderer;
      r.scrollTo(Math.floor(rand() * r.rowCount)); r.draw();
      const cpu = performance.now() - t0;
      await raf(); await raf();
      out.push([performance.now() - t0, cpu]);
    }
    const q = (k, f) => [...out].map((x) => x[k]).sort((x, y) => x - y)[Math.floor(f * 59)].toFixed(1);
    return `frame p50 ${q(0, 0.5)} max ${q(0, 1)} | draw cpu p50 ${q(1, 0.5)} max ${q(1, 1)}`;
  };
  return [await run(), await run(), window.viewer.renderer.glyphs.size];
});
console.log('first pass :', passes[0]);
console.log('second pass:', passes[1]);
console.log('glyphs in atlas:', passes[2]);
await b.close();
