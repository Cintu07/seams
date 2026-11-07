// The side-by-side video for milestone 12: seams and @pierre/diffs open the same 1M-line diff at the
// same moment, then take the same scroll gestures. Each page is recorded through the browser's own
// screencast (frames carry real timestamps), then the two are stitched side by side with ffmpeg.
//   node bench/record_side_by_side.mjs <ffmpeg> <out.mp4> [old] [new]
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';

const [ffmpeg, out, oldName = '1m.old.ts', newName = '1m.e100.new.ts'] = process.argv.slice(2);
const W = 960, H = 1000;
const browser = await chromium.launch({ channel: 'msedge', headless: false, args: [`--window-size=${W},${H + 80}`] });
const sides = [
  { name: 'seams', url: `http://localhost:4174/?old=${oldName}&new=${newName}`, ready: () => window.viewerReady === true },
  { name: 'pierre', url: 'http://localhost:4173/?version=164&highlighter=highlights&diffLib=jsdiff', ready: () => window.benchReady === true },
];
const start = Date.now();
await Promise.all(sides.map(async (s) => {
  s.dir = `${out}.frames-${s.name}/`;
  rmSync(s.dir, { recursive: true, force: true });
  mkdirSync(s.dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  s.page = await ctx.newPage();
  s.cdp = await ctx.newCDPSession(s.page);
  s.frames = [];
  s.cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    s.frames.push([Date.now() - start, data]);
    await s.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await s.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
}));
// both start at once: seams loads its files from the URL, Pierre is told to load the same pair
await Promise.all(sides.map((s) => s.page.goto(s.url)));
await Promise.all([
  sides[0].page.waitForFunction(sides[0].ready, null, { timeout: 120000 }),
  sides[1].page.waitForFunction(sides[1].ready, null, { timeout: 120000 }).then(() => sides[1].page.evaluate(([o, n]) => window.bench.load(o, n), [oldName, newName])),
]);
await new Promise((r) => setTimeout(r, 1500));
// the same scroll gestures on both
for (const [dy, speed] of [[-12000, 3000], [-30000, 9000], [20000, 6000]]) {
  await Promise.all(sides.map((s) => s.cdp.send('Input.synthesizeScrollGesture', { x: W / 2, y: H / 2, yDistance: dy, speed, gestureSourceType: 'mouse' })));
}
await new Promise((r) => setTimeout(r, 800));
const end = Date.now() - start;
await Promise.all(sides.map((s) => s.cdp.send('Page.stopScreencast')));
await browser.close();

// each side: frames held for their real duration, then the two side by side with labels
for (const s of sides) {
  let list = '';
  s.frames.forEach(([t, data], i) => {
    const file = `${s.dir}${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(file, Buffer.from(data, 'base64'));
    const next = s.frames[i + 1]?.[0] ?? end;
    list += `file '${file}'\nduration ${Math.max(0.001, (next - t) / 1000).toFixed(3)}\n`;
  });
  // hold the first frame from t=0 so both sides start together
  if (s.frames.length) list = `file '${s.dir}00000.jpg'\nduration ${(s.frames[0][0] / 1000).toFixed(3)}\n` + list;
  writeFileSync(`${s.dir}list.txt`, list);
}
const label = (text) => `drawbox=x=0:y=0:w=iw:h=44:color=black@0.75:t=fill,drawtext=fontfile='C\:/Windows/Fonts/consola.ttf':text='${text}':x=16:y=12:fontsize=22:fontcolor=white`;
execFileSync(ffmpeg, ['-y', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0', '-i', `${sides[0].dir}list.txt`,
  '-f', 'concat', '-safe', '0', '-i', `${sides[1].dir}list.txt`,
  '-filter_complex', `[0:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H},${label('seams (wasm + webgl)')}[l];[1:v]fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H},${label('@pierre/diffs 1.6.4 (best settings)')}[r];[l][r]hstack=2,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-movflags', '+faststart', out]);
for (const s of sides) rmSync(s.dir, { recursive: true, force: true });
console.log(`wrote ${out}: seams ${sides[0].frames.length} frames, pierre ${sides[1].frames.length} frames, ${(end / 1000).toFixed(1)} s`);
