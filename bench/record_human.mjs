// A 4K demo of the viewer that moves like a person uses it, rendered frame by frame at 60 fps.
// The page is real and seams draws every frame itself; only time is stepped, so the video is smooth
// at a resolution no live screen capture of this laptop could reach. Input is real browser input
// (mouse, wheel, keys) with a drawn cursor on top, moving on eased, slightly curved paths.
//   node bench/record_human.mjs <ffmpeg> <out.mp4>
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const [ffmpeg, out] = process.argv.slice(2);
const W = 1920, H = 1080, FPS = 60;
const dir = `${out}.frames/`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage();
await page.goto('http://localhost:4174/');
await page.waitForFunction(() => window.viewerReady === true);
await page.evaluate(() => document.fonts.ready);

// the cursor: a plain arrow, the size a 4K screen shows it at
await page.addStyleTag({ content: `#cur { position: fixed; left: 0; top: 0; width: 22px; height: 33px; z-index: 2147483647; pointer-events: none; will-change: transform; filter: drop-shadow(0 1.5px 1.5px rgba(0,0,0,.35)); }` });
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'cur';
  d.innerHTML = '<svg viewBox="0 0 12 18" width="22" height="33"><path d="M1 1 L1 15 L4.6 11.6 L7 17 L9.2 16 L6.8 10.7 L11.4 10.7 Z" fill="#fff" stroke="#111" stroke-width="1" stroke-linejoin="round"/></svg>';
  document.body.append(d);
});

let frame = 0, cx = W + 40, cy = H * 0.78;
const place = (x, y) => page.evaluate(([x, y]) => { document.getElementById('cur').style.transform = `translate(${x - 1}px, ${y - 1}px)`; }, [x, y]);
async function snap() {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: `${dir}${String(frame++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 93 });
}
const hold = async (sec) => { for (let i = 0; i < Math.round(sec * FPS); ++i) await snap(); };

// seeded noise, so every take is the same take
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
// minimum-jerk easing: how a hand speeds up and settles
const ease = (t) => t * t * t * (10 - 15 * t + 6 * t * t);

// move to (x, y) the way a hand does: a slight arc, a small overshoot, then a settle
async function move(x, y, sec = 0.7) {
  const x0 = cx, y0 = cy, n = Math.max(2, Math.round(sec * FPS));
  const dx = x - x0, dy = y - y0, len = Math.hypot(dx, dy) || 1;
  const bend = (rnd() - 0.5) * 0.22 * len, ox = (-dy / len) * bend, oy = (dx / len) * bend;
  const over = 0.03 + rnd() * 0.03;
  for (let i = 1; i <= n; ++i) {
    const t = i / n, e = ease(t);
    const o = Math.sin(Math.PI * t) * (1 - t * 0.3);
    const settle = t > 0.75 ? Math.sin(((t - 0.75) / 0.25) * Math.PI) * over : 0;
    cx = x0 + dx * (e + settle) + ox * o;
    cy = y0 + dy * (e + settle) + oy * o;
    await place(cx, cy);
    await page.mouse.move(cx, cy);
    await snap();
  }
  cx = x; cy = y;
}
// a trackpad flick: a burst of scroll that coasts to a stop
async function flick(pixels, sec = 1.1) {
  const n = Math.round(sec * FPS), k = 4.2;
  const total = (1 - Math.exp(-k)) / k;
  let done = 0;
  for (let i = 0; i < n; ++i) {
    const t0 = i / n, t1 = (i + 1) / n;
    const part = ((Math.exp(-k * t0) - Math.exp(-k * t1)) / k) / total;
    const d = pixels * part;
    done += d;
    await page.mouse.wheel(0, d);
    await snap();
  }
}
const key = async (k, after = 0.25) => { await page.keyboard.press(k); await snap(); await hold(after); };
async function type(text) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await hold(0.07 + rnd() * 0.11 + (ch === ' ' ? 0.08 : 0));
  }
}
const box = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };

// ---------------------------------------------------------------- the take
await place(cx, cy);
await hold(0.8);
// the cursor comes in, looks at the old file, then the new one
const oldIcon = await box('#pickOld'), newIcon = await box('#pickNew');
await move(oldIcon.x + 6, oldIcon.y - 4, 1.1);
await hold(0.35);
await move(newIcon.x - 4, newIcon.y + 2, 1.0);
await hold(0.25);
// "opens" the pair: the same as picking both files, a million lines each
await page.mouse.down(); await snap(); await page.mouse.up();
const t0 = Date.now();
await page.evaluate(() => window.viewer.loadUrls('/fixtures/1m.old.ts', '/fixtures/1m.e100.new.ts'));
console.log('loaded in', Date.now() - t0, 'ms (wall clock, including the fetch)');
await hold(0.6);
// reads the stats line for a moment
const stats = await box('#stats');
await move(stats.b.x + stats.b.width * 0.7, stats.y + 6, 0.9);
await hold(1.1);
// into the text, and scrolls like someone reading
const view = await box('#view');
await move(view.x - 120, view.y + 40, 0.8);
await hold(0.3);
await flick(2600, 1.2); await hold(0.45);
await flick(4200, 1.3); await hold(0.6);
await flick(-1300, 0.9); await hold(0.8);
await flick(9000, 1.4); await hold(0.5);
// next change, a few times
await page.locator('#view').focus();
await key('n', 0.5); await key('n', 0.4); await key('n', 0.7);
// grabs the scrollbar and throws it across the million lines
const bar = await box('#bar');
await move(bar.x, bar.b.y + bar.b.height * 0.06, 0.9);
await page.mouse.down(); await snap();
for (const [f, s] of [[0.72, 1.3], [0.38, 0.9], [0.55, 0.6]]) {
  const y0 = cy, y1 = bar.b.y + bar.b.height * f, n = Math.round(s * FPS);
  for (let i = 1; i <= n; ++i) { cy = y0 + (y1 - y0) * ease(i / n); await place(cx, cy); await page.mouse.move(cx, cy); await snap(); }
  await hold(0.25);
}
await page.mouse.up(); await snap();
await hold(0.5);
// split view
await move(view.x + 80, view.y - 60, 0.7);
await page.locator('#view').focus();
await key('v', 0.9);
await flick(1800, 1.0); await hold(0.7);
// find, typed
await key('Control+f', 0.3);
await type('lineCount');
await hold(0.7);
await key('Enter', 0.45); await key('Enter', 0.45); await key('Enter', 0.9);
await key('Escape', 0.4);
// back to unified, selects a line and copies it
await page.locator('#view').focus();
await key('v', 0.6);
await move(view.b.x + view.b.width * 0.3, view.b.y + 196, 0.8);
await page.mouse.dblclick(cx, cy); await snap();
await hold(0.5);
await key('Control+c', 0.6);
// night
const mascot = await box('#mascot');
await move(mascot.x, mascot.y, 1.0);
await hold(0.2);
// the real click switches the theme (a second, scripted click would switch it straight back)
await page.mouse.down(); await snap(); await page.mouse.up();
await hold(0.4);
await move(view.x + 200, view.y + 120, 1.0);
await page.locator('#view').focus();
await flick(3000, 1.2);
await hold(1.6);
await browser.close();

console.log(`${frame} frames, ${(frame / FPS).toFixed(1)} s`);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}%05d.jpg`,
  '-vf', 'scale=3840:2160:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-movflags', '+faststart', out]);
rmSync(dir, { recursive: true, force: true });
console.log('wrote', out);
