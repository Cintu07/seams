// The whole page slowed down, workers included: a laptop that is 4x or 6x slower than this one.
// Chrome's cpu throttle only reaches a web worker if the debugger attaches to that worker as it
// starts, which playwright doesn't expose, so this speaks the devtools protocol directly. Every
// page and worker is throttled before it runs a line, then the site's million-line demo is opened
// and scrolled with a mouse wheel.
//   serve the built site (node site/build.mjs, then any static server), then
//   node bench/slow_laptop.mjs http://localhost:4340/
import { spawn } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const url = process.argv[2] ?? 'http://localhost:4340/';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(rate) {
  const port = 9300 + rate;
  const edge = spawn(EDGE, [`--remote-debugging-port=${port}`, '--headless=new', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'slow-'))}`, '--window-size=1500,950', 'about:blank'], { stdio: 'ignore' });
  let info;
  for (let i = 0; i < 50 && !info; ++i) { await wait(200); info = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null); }
  const ws = new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const workers = [];
  ws.addEventListener('message', async ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
    if (m.method === 'Target.attachedToTarget') {
      const child = m.params.sessionId, type = m.params.targetInfo.type;
      // throttle it, follow anything it starts, then let it run
      if (type === 'worker' || type === 'iframe') {
        await send('Emulation.setCPUThrottlingRate', { rate }, child).catch(() => {});
        await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, child).catch(() => {});
        workers.push(type);
      }
      await send('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
    }
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId: page } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, page);
  await send('Emulation.setCPUThrottlingRate', { rate }, page);
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false }, page);
  await send('Page.enable', {}, page);
  await send('Page.navigate', { url }, page);
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, page)).result.value;
  while (!(await evaluate(`!!document.querySelector('[data-demo="million"]') && document.readyState === 'complete'`))) await wait(200);
  await wait(800);
  const t0 = Date.now();
  await evaluate(`document.getElementById('try').scrollIntoView(); document.querySelector('[data-demo="million"]').click(); true`);
  while (!(await evaluate(`/generated/.test(document.getElementById('stats').textContent)`))) await wait(100);
  const opened = Date.now() - t0;
  const stats = await evaluate(`document.getElementById('stats').textContent`);
  // a mouse wheel over the diff for four seconds, frame times measured inside the page
  const box = await evaluate(`(() => { const b = document.querySelector('#viewer canvas[role=img]').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; })()`);
  await evaluate(`window.__f = []; (function f(t) { window.__f.push(t); if (window.__f.length < 2000) requestAnimationFrame(f); })(performance.now()); true`);
  const until = Date.now() + 4000;
  while (Date.now() < until) { await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box[0], y: box[1], deltaX: 0, deltaY: 100 }, page); await wait(90); }
  const t = await evaluate(`window.__f`);
  const d = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
  const q = (p) => d[Math.min(d.length - 1, Math.floor(p * d.length))].toFixed(1);
  // edge accepts the throttle for workers and then ignores it, so the worker's diff is timed again
  // here on the main thread, where the throttle does apply: the same wasm, a million lines, 100 edits
  const diffMs = await evaluate(`(async () => {
    const { loadSeams } = await import('/wasm/seams.mjs');
    const seams = await loadSeams(await (await fetch('/build/seams.wasm')).arrayBuffer());
    // the files are built from one repeated line so making them costs almost nothing, even slowed down
    const line = new TextEncoder().encode('    total += row(123456);\\n'), n = 1e6, A = new Uint8Array(line.length * n);
    for (let i = 0; i < n; ++i) A.set(line, i * line.length);
    const B = A.slice();
    for (let i = 9999; i < n; i += 10000) B[i * line.length + 10] = 45;   // += becomes -= on 100 lines
    const times = [];
    for (let k = 0; k < 3; ++k) { const t0 = performance.now(); seams.diff(A, B, { fast: true }); times.push(performance.now() - t0); }
    return times;
  })()`);
  ws.close(); edge.kill();
  return { rate, opened, stats: stats.replace(/\s+/g, ' ').trim(), diffOnSlowCpu: `cold ${diffMs[0].toFixed(0)} ms, warm ${Math.min(diffMs[1], diffMs[2]).toFixed(0)} ms`, frames: `median ${q(0.5)} ms, p95 ${q(0.95)} ms, worst ${d.at(-1).toFixed(1)} ms` };
}

for (const rate of (process.argv[3] ?? "1,4,6").split(",").map(Number)) console.log(JSON.stringify(await run(rate)));
