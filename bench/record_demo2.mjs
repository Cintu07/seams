// Demo 2: the seams site and the command line, recorded the way a person uses them, 4K 60 fps.
// Time is stepped frame by frame for smoothness, so anywhere seams actually computes something the
// screen holds for the real measured time: the video is never faster than the program.
//   node bench/record_demo2.mjs <ffmpeg> <terminal dir from run.sh> <out.mp4>
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { mkdirSync, rmSync, readFileSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';

const [ffmpeg, termDir, out] = process.argv.slice(2);
const W = 1920, H = 1080, FPS = 60;
const dir = `${out}.frames/`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage();

let frame = 0, cx = W + 40, cy = H * 0.6;
const file = (i) => `${dir}${String(i).padStart(5, '0')}.jpg`;
async function snap() {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: file(frame++), type: 'jpeg', quality: 93 });
}
const hold = async (sec) => { for (let i = 0; i < Math.round(sec * FPS); ++i) await snap(); };
// the screen as it was, for as long as the real work took
const freeze = (ms) => { const last = frame - 1; for (let i = 0; i < Math.round(ms / 1000 * FPS); ++i) copyFileSync(file(last), file(frame++)); };

let seed = 11;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const ease = (t) => t * t * t * (10 - 15 * t + 6 * t * t);

// ---------------------------------------------------------------- the cursor and the hand
async function addCursor() {
  await page.addStyleTag({ content: `#cur { position: fixed; left: 0; top: 0; width: 22px; height: 33px; z-index: 2147483647; pointer-events: none; filter: drop-shadow(0 1.5px 1.5px rgba(0,0,0,.35)); } html { scroll-behavior: auto !important; }` });
  await page.evaluate(() => {
    const d = document.createElement('div'); d.id = 'cur';
    d.innerHTML = '<svg viewBox="0 0 12 18" width="22" height="33"><path d="M1 1 L1 15 L4.6 11.6 L7 17 L9.2 16 L6.8 10.7 L11.4 10.7 Z" fill="#fff" stroke="#111" stroke-width="1" stroke-linejoin="round"/></svg>';
    document.body.append(d);
  });
}
const place = (x, y) => page.evaluate(([x, y]) => { const c = document.getElementById('cur'); if (c) c.style.transform = `translate(${x - 1}px, ${y - 1}px)`; }, [x, y]);
async function move(x, y, sec = 0.7) {
  const x0 = cx, y0 = cy, n = Math.max(2, Math.round(sec * FPS));
  const dx = x - x0, dy = y - y0, len = Math.hypot(dx, dy) || 1;
  const bend = (rnd() - 0.5) * 0.22 * len, ox = (-dy / len) * bend, oy = (dx / len) * bend, over = 0.03 + rnd() * 0.03;
  for (let i = 1; i <= n; ++i) {
    const t = i / n, e = ease(t), o = Math.sin(Math.PI * t) * (1 - t * 0.3);
    const settle = t > 0.75 ? Math.sin(((t - 0.75) / 0.25) * Math.PI) * over : 0;
    cx = x0 + dx * (e + settle) + ox * o; cy = y0 + dy * (e + settle) + oy * o;
    await place(cx, cy); await page.mouse.move(cx, cy); await snap();
  }
  cx = x; cy = y;
}
async function flick(pixels, sec = 1.1) {
  const n = Math.round(sec * FPS), k = 4.2, total = (1 - Math.exp(-k)) / k;
  for (let i = 0; i < n; ++i) {
    const t0 = i / n, t1 = (i + 1) / n;
    await page.mouse.wheel(0, pixels * ((Math.exp(-k * t0) - Math.exp(-k * t1)) / k) / total);
    await snap();
  }
}
const click = async () => { await page.mouse.down(); await snap(); await page.mouse.up(); await snap(); };
const key = async (k, after = 0.25) => { await page.keyboard.press(k); await snap(); await hold(after); };
async function type(text) { for (const ch of text) { await page.keyboard.type(ch); await hold(0.07 + rnd() * 0.12 + (ch === ' ' ? 0.08 : 0)); } }
const box = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };

// ---------------------------------------------------------------- part one: the site
await page.goto('http://localhost:4340/', { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1500);
await addCursor();
await place(cx, cy);
await hold(1.0);
await move(W * 0.62, H * 0.42, 1.2);           // drifts over the headline, reads it
await hold(1.4);
await move(W * 0.86, H * 0.55, 0.8);
await flick(900, 1.3); await hold(0.6);         // down to the live viewer
const tryHead = await box('#try');
await flick(tryHead.b.y - 70, 1.1); await hold(0.8);

// a million lines, generated and diffed in this tab
const chip = await box('[data-demo="million"]');
await move(chip.x, chip.y, 0.9);
await hold(0.3);
const before = await page.locator('#stats').textContent();
const t0 = Date.now();                           // before the click: the work starts inside it
await page.mouse.down(); await snap(); await page.mouse.up();
await page.waitForFunction((b) => document.getElementById('stats').textContent !== b && /generated/.test(document.getElementById('stats').textContent), before, { timeout: 60000 });
const took = Date.now() - t0;
console.log('million demo, wall clock', took, 'ms');
freeze(took);
await snap();
const stats = await box('#stats');
await move(stats.b.x + Math.min(stats.b.width * 0.55, 620), stats.y + 4, 0.9);
await hold(2.2);                                 // reads how long it took

// read it like a person: flicks, next change, split view, find
const view = await box('#viewer');
await move(view.x - 160, view.y - 40, 0.8);
await page.mouse.click(cx, cy); await snap();
await flick(2400, 1.2); await hold(0.4);
await flick(5200, 1.3); await hold(0.5);
await flick(-1500, 0.9); await hold(0.7);
await flick(16000, 1.5); await hold(0.5);
await key('n', 0.6); await key('n', 0.5); await key('n', 0.9);
await key('v', 1.0);
console.log('split frame', frame);
await flick(1600, 1.0); await hold(1.4);
await key('Control+f', 0.35);
await type('return');
await hold(0.6);
await key('Enter', 0.45); await key('Enter', 0.45); await key('Enter', 0.8);
await key('Escape', 0.4);
await key('v', 0.7);

// night mode, then the numbers
const theme = await box('#theme');
await move(theme.x, theme.y, 1.1);
await hold(0.25);
await click();
await hold(0.8);
await move(view.x + 260, view.y + 80, 0.9);
await flick(6000, 1.3); await hold(0.8);
await move(W * 0.9, H * 0.85, 0.7);
const nums = await box('#numbers');
await flick(nums.b.y - 60, 1.4);
await hold(3.0);

// ---------------------------------------------------------------- part two: the terminal
const T = (i, f) => readFileSync(`${termDir}/${f}${i}.txt`, 'utf8').replace(/\n$/, '');
const steps = [1, 2, 3, 4, 5, 6].map((i) => ({ cmd: T(i, 'cmd'), out: T(i, 'out'), ms: Number(T(i, 'ms').split(' ')[0]) }));
await page.setContent(`<!doctype html><html><head><style>
@font-face { font-family: Code; src: local("Cascadia Mono"), local("CascadiaMono-Regular"); }
html, body { margin: 0; background: #0f1419; height: 100%; }
body { padding: 40px 54px; box-sizing: border-box; color: #d8dee4; font: 25px/1.5 Code, Consolas, monospace; }
.bar { position: fixed; top: 0; left: 0; right: 0; height: 34px; background: #1b2128; color: #8b96a0; font: 15px/34px "Segoe UI", sans-serif; padding-left: 18px; }
#t { white-space: pre-wrap; margin-top: 18px; }
.p1 { color: #8fdba8; } .p2 { color: #79b8ff; } .err { color: #f2907c; } .dim { color: #8b96a0; }
.add { color: #8fdba8; } .del { color: #f2907c; } .hunk { color: #79b8ff; }
.cur { background: #d8dee4; color: #0f1419; }
</style></head><body><div class="bar">pavan@laptop: ~/seams-demo</div><div id="t"></div></body></html>`);
await page.evaluate(() => document.fonts.ready);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const colour = (line) => /^seams: /.test(line) ? `<span class="err">${esc(line)}</span>`
  : /^@@/.test(line) ? `<span class="hunk">${esc(line)}</span>`
  : /^\+(?!\+\+)/.test(line) ? `<span class="add">${esc(line)}</span>`
  : /^-(?!--)/.test(line) ? `<span class="del">${esc(line)}</span>`
  : /^(real|user|sys)\b/.test(line) ? `<span class="dim">${esc(line)}</span>` : esc(line);
const prompt = '<span class="p1">pavan@laptop</span>:<span class="p2">~/seams-demo</span>$ ';
let done = '', typing = '', blink = 0;
const draw = (cursor = true) => page.evaluate((h) => { document.getElementById('t').innerHTML = h; }, done + prompt + esc(typing) + (cursor ? '<span class="cur"> </span>' : ' '));
async function tick(sec) { for (let i = 0; i < Math.round(sec * FPS); ++i) { await draw(Math.floor(blink++ / 32) % 2 === 0); await snap(); } }
await tick(1.2);
for (const [n, s] of steps.entries()) {
  // typed by hand, with the odd slip fixed on the spot
  for (let i = 0; i < s.cmd.length; ++i) {
    if (rnd() < 0.025 && /[a-z]/.test(s.cmd[i])) { typing += 'qwertyuiopasdfghjkl'[Math.floor(rnd() * 19)]; blink = 0; await tick(0.12 + rnd() * 0.1); await tick(0.25); typing = typing.slice(0, -1); blink = 0; await tick(0.1); }
    typing += s.cmd[i]; blink = 0;
    await tick(0.055 + rnd() * 0.1 + (s.cmd[i] === ' ' ? 0.07 : 0) + (rnd() < 0.05 ? 0.4 : 0));
  }
  await tick(0.35);
  done += prompt + esc(typing) + '\n'; typing = '';
  await draw(false); await snap();
  freeze(s.ms);                                     // as long as it really took
  if (s.out) done += s.out.split('\n').map(n === 1 || n === 5 ? colour : esc).join('\n') + '\n';   // only diff output and errors get colour
  blink = 0;
  await tick(n === 1 ? 2.6 : 1.6);
  if (n === 1 || n === 3) { done = ''; await tick(0.5); }   // clear, like ctrl+l
}
await tick(2.0);
await browser.close();

console.log(`${frame} frames, ${(frame / FPS).toFixed(1)} s`);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}%05d.jpg`,
  '-vf', 'scale=3840:2160:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-profile:v', 'high', '-movflags', '+faststart', out]);
rmSync(dir, { recursive: true, force: true });
console.log('wrote', out);
