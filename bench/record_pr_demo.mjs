// Demo: reviewing 3,000 commits of tinygrad as one pull request, from the command that opens it to
// reading the changes. 4K, 60 fps, stepped frame by frame for smoothness; wherever seams is actually
// working (the command, the load, the background diffs) the video runs at wall-clock speed, so it is
// never faster than the program.
//   start the review first:  cd tinygrad; node ../seems/tools/seams-review.mjs master~3000..master
//   node bench/record_pr_demo.mjs <ffmpeg> <review url> <command output file> <command wall ms> <out.mp4>
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { mkdirSync, rmSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';

import { readFileSync } from 'fs';
const [ffmpeg, url, outputFile, wallArg, out] = process.argv.slice(2);
const commandOutput = readFileSync(outputFile, 'utf8').trim().split(String.fromCharCode(10)).map((l) => l.replace(String.fromCharCode(13), '')), wallMs = Number(wallArg);
const W = 1920, H = 1080, FPS = 60;
const dir = `${out}.frames/`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage();

let frame = 0, cx = W * 0.75, cy = H * 0.7;
const file = (i) => `${dir}${String(i).padStart(5, '0')}.jpg`;
async function snap() {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  await page.screenshot({ path: file(frame++), type: 'jpeg', quality: 93 });
}
const hold = async (sec) => { for (let i = 0; i < Math.round(sec * FPS); ++i) await snap(); };
// real time: each captured frame is repeated to cover the wall-clock time since the last one
async function realtime(until) {
  let last = performance.now();
  while (!(await page.evaluate(until))) {
    await snap();
    const now = performance.now(), copies = Math.round(((now - last) / 1000) * FPS) - 1;
    for (let i = 0; i < copies; ++i) copyFileSync(file(frame - 1), file(frame++));
    last = now;
  }
  await snap();
}
let seed = 23;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const ease = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
const place = (x, y) => page.evaluate(([x, y]) => { document.getElementById('cur').style.transform = `translate(${x - 1}px, ${y - 1}px)`; }, [x, y]);
async function move(x, y, sec = 0.7) {
  const x0 = cx, y0 = cy, n = Math.max(2, Math.round(sec * FPS)), dx = x - x0, dy = y - y0, len = Math.hypot(dx, dy) || 1;
  const bend = (rnd() - 0.5) * 0.2 * len, ox = (-dy / len) * bend, oy = (dx / len) * bend;
  for (let i = 1; i <= n; ++i) {
    const t = i / n, e = ease(t), o = Math.sin(Math.PI * t);
    cx = x0 + dx * e + ox * o; cy = y0 + dy * e + oy * o;
    await place(cx, cy); await page.mouse.move(cx, cy); await snap();
  }
  cx = x; cy = y;
}
async function flick(pixels, sec = 1.1) {
  const n = Math.round(sec * FPS), k = 4.2, total = (1 - Math.exp(-k)) / k;
  for (let i = 0; i < n; ++i) { const t0 = i / n, t1 = (i + 1) / n; await page.mouse.wheel(0, pixels * ((Math.exp(-k * t0) - Math.exp(-k * t1)) / k) / total); await snap(); }
}
const click = async () => { await page.mouse.down(); await snap(); await page.mouse.up(); await snap(); };
const key = async (k, after = 0.3) => { await page.keyboard.press(k); await snap(); await hold(after); };
async function type(text) { for (const ch of text) { await page.keyboard.type(ch); await hold(0.07 + rnd() * 0.11); } }
const box = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };

// ---------------------------------------------------------------- the command, in a terminal
const PROMPT = 'PS C:\\Users\\pavan\\Desktop\\tinygrad> ';
const COMMAND = 'node ..\\seems\\tools\\seams-review.mjs master~3000..master';
await page.setContent(`<!doctype html><style>
html,body{margin:0;height:100%;background:#0c0c0c;color:#cccccc;font:26px/1.5 "Cascadia Mono",Consolas,monospace}
.bar{height:40px;background:#1f1f1f;color:#9a9a9a;font:16px/40px "Segoe UI",sans-serif;padding-left:18px}
#t{padding:22px 30px;white-space:pre-wrap} .p{color:#cccccc} .c{color:#f9f1a5} .ok{color:#8fdba8} .cur{background:#cccccc;color:#0c0c0c}
</style><div class="bar">Windows PowerShell</div><div id="t"></div>`);
const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
let typed = '', shown = '', blink = 0;
const term = (cursor = true) => page.evaluate((h) => { document.getElementById('t').innerHTML = h; }, shown + '<span class="p">' + esc(PROMPT) + '</span><span class="c">' + esc(typed) + '</span>' + (cursor ? '<span class="cur"> </span>' : ''));
async function tick(sec) { for (let i = 0; i < Math.round(sec * FPS); ++i) { await term(Math.floor(blink++ / 32) % 2 === 0); await snap(); } }
await tick(1.0);
for (const ch of COMMAND) { typed += ch; blink = 0; await tick(0.055 + rnd() * 0.1 + (ch === ' ' ? 0.08 : 0) + (rnd() < 0.04 ? 0.35 : 0)); }
await tick(0.5);
shown = '<span class="p">' + esc(PROMPT) + '</span><span class="c">' + esc(typed) + '</span>\n'; typed = '';
await page.evaluate((h) => { document.getElementById('t').innerHTML = h; }, shown); await snap();
// the command really took wallMs from enter to its last line
for (let i = 0; i < Math.round((wallMs / 1000) * FPS) - 1; ++i) copyFileSync(file(frame - 1), file(frame++));
shown += commandOutput.map((l) => '<span class="ok">' + esc(l) + '</span>').join('\n');
await page.evaluate((h) => { document.getElementById('t').innerHTML = h; }, shown); await snap();
await hold(1.6);

// ---------------------------------------------------------------- the browser opens the review
await page.goto(url, { waitUntil: 'commit' });
await realtime(() => /every file diffed/.test(document.getElementById('s')?.textContent ?? ''));
await page.addStyleTag({ content: `#cur { position: fixed; left: 0; top: 0; z-index: 99; pointer-events: none; filter: drop-shadow(0 1.5px 1.5px rgba(0,0,0,.35)); }` });
await page.evaluate(() => { const d = document.createElement('div'); d.id = 'cur'; d.innerHTML = '<svg viewBox="0 0 12 18" width="22" height="33"><path d="M1 1 L1 15 L4.6 11.6 L7 17 L9.2 16 L6.8 10.7 L11.4 10.7 Z" fill="#fff" stroke="#111" stroke-width="1" stroke-linejoin="round"/></svg>'; document.body.append(d); });
await place(cx, cy);
await hold(2.5);                                       // read the numbers

// skim the file list
const list = await box('.list');
await move(list.x, list.y, 1.0);
await flick(2600, 1.3); await hold(0.5);
await flick(5200, 1.3); await hold(0.5);
await flick(-7000, 1.2); await hold(0.6);

// find the codegen changes and open a few
const search = await box('input[type=search]');
await move(search.x, search.y, 0.8);
await click();
await type('codegen/opt');
await hold(0.8);
let rows = await page.locator('.file').all();
let target = await rows[Math.min(2, rows.length - 1)].boundingBox();
await move(target.x + 120, target.y + target.height / 2, 0.8);
await click();
await hold(1.2);
const view = await box('.main');
await move(view.x, view.y + 60, 0.8);
await flick(1500, 1.1); await hold(0.6);
await flick(2600, 1.2); await hold(0.8);
// next files with ]
await key(']', 1.0); await key(']', 1.0); await key(']', 1.2);

// a file that moved: R, old path on hover
await move(search.x, search.y, 0.9);
await page.mouse.click(cx, cy, { clickCount: 3 }); await snap();
await type('renderer/amd/dsl');
await hold(0.6);
rows = await page.locator('.file').all();
target = await rows[0].boundingBox();
await move(target.x + 140, target.y + target.height / 2, 0.8);
await hold(1.4);
await click();
await hold(1.0);
await move(view.x + 60, view.y + 40, 0.7);
await flick(2000, 1.1); await hold(0.8);

// the biggest rewrite: the ops file
await move(search.x, search.y, 0.9);
await page.mouse.click(cx, cy, { clickCount: 3 }); await snap();
await type('uop/ops.py');
await hold(0.7);
rows = await page.locator('.file').all();
target = await rows[0].boundingBox();
await move(target.x + 120, target.y + target.height / 2, 0.8);
await click();
await hold(1.0);
await move(view.x + 100, view.y, 0.8);
await flick(3000, 1.2); await hold(0.5);
await flick(9000, 1.4); await hold(0.6);
await flick(-4000, 1.1); await hold(2.0);
await browser.close();

console.log(`${frame} frames, ${(frame / FPS).toFixed(1)} s`);
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}%05d.jpg`,
  '-vf', 'scale=3840:2160:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', out]);
rmSync(dir, { recursive: true, force: true });
console.log('wrote', out);
