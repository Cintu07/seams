// Viewer page: loads two files, diffs them in a worker, renders with WebGL2, owns scrolling.
// window.viewer exposes load/scroll/jump hooks for the automated benchmark (web/bench_viewer.mjs).
import { DiffRenderer, PALETTE } from './renderer.mjs';

const canvas = document.getElementById('view');
const stats = document.getElementById('stats');
const bar = document.getElementById('bar'), thumb = document.getElementById('thumb'), marks = document.getElementById('marks');
const drop = document.getElementById('drop');
const renderer = new DiffRenderer(canvas);
const worker = new Worker(new URL('./diff_worker.mjs', import.meta.url), { type: 'module' });

let current = null;
let requestId = 0;
let frameQueued = false;
const frameTimes = [];  // CPU ms spent building and submitting each frame

function requestFrame() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    const t0 = performance.now();
    renderer.draw();
    frameTimes.push(performance.now() - t0);
    if (frameTimes.length > 240) frameTimes.shift();
    placeThumb();
  });
}

function placeThumb() {
  if (!current) return;
  const h = bar.clientHeight, total = renderer.rowCount, page = renderer.pageRows;
  const size = Math.max(18, h * Math.min(1, page / total));
  const top = renderer.maxScrollRow ? (renderer.scrollRow / renderer.maxScrollRow) * (h - size) : 0;
  thumb.style.height = `${size}px`;
  thumb.style.top = `${top}px`;
}

// one pixel row of the scrollbar per slice of rows; red or green where that slice has changes
function drawMarks() {
  const dpr = devicePixelRatio || 1;
  marks.width = Math.max(1, Math.round(bar.clientWidth * dpr));
  marks.height = Math.max(1, Math.round(bar.clientHeight * dpr));
  const ctx = marks.getContext('2d');
  ctx.clearRect(0, 0, marks.width, marks.height);
  if (!current) return;
  const kind = current.rows.kind, total = kind.length, h = marks.height;
  const deleted = new Uint8Array(h), inserted = new Uint8Array(h);
  for (let r = 0; r < total; ++r) {
    if (!kind[r]) continue;
    const y = Math.floor((r / total) * h);
    if (kind[r] === 1) deleted[y] = 1; else inserted[y] = 1;
  }
  for (let y = 0; y < h; ++y) {
    if (deleted[y]) { ctx.fillStyle = PALETTE.deletedMark; ctx.fillRect(0, y, marks.width / 2, Math.max(1, dpr)); }
    if (inserted[y]) { ctx.fillStyle = PALETTE.insertedMark; ctx.fillRect(marks.width / 2, y, marks.width / 2, Math.max(1, dpr)); }
  }
}

function showStats(extra = '') {
  if (!current) return;
  const sorted = [...frameTimes].sort((x, y) => x - y);
  const p = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0).toFixed(2);
  const t = current.timing;
  stats.innerHTML =
    `${current.rows.kind.length.toLocaleString()} rows  <span class="del">-${current.deleted.toLocaleString()}</span> <span class="ins">+${current.inserted.toLocaleString()}</span>  ` +
    `diff ${t.diff.toFixed(1)} ms  layout ${t.layout.toFixed(1)} ms  first frame ${t.firstFrame.toFixed(1)} ms\n` +
    `frame cpu p50 ${p(0.5)} ms  p99 ${p(0.99)} ms  row ${Math.floor(renderer.scrollRow + 1).toLocaleString()}${extra}`;
}
setInterval(() => showStats(), 250);

function diffInWorker(a, b) {
  const id = ++requestId;
  return new Promise((resolve) => {
    const onMessage = ({ data }) => {
      if (data.id !== id) return;
      worker.removeEventListener('message', onMessage);
      resolve(data);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, a, b }, [a, b]);
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));

// a and b are ArrayBuffers already in memory; the timer starts here
async function show(a, b, names) {
  const t0 = performance.now();
  const result = await diffInWorker(a, b);
  result.a = new Uint8Array(result.a);
  result.b = new Uint8Array(result.b);
  renderer.setDiff(result);
  current = result;
  renderer.draw();
  await nextFrame();
  result.timing.firstFrame = performance.now() - t0;
  result.names = names;
  drop.hidden = true;
  document.title = `seams: ${names[1]}`;
  drawMarks();
  requestFrame();
  showStats();
  return { ...result.timing, rows: result.rows.kind.length, deleted: result.deleted, inserted: result.inserted };
}

async function loadUrls(oldUrl, newUrl) {
  const [a, b] = await Promise.all([fetch(oldUrl), fetch(newUrl)].map((p) => p.then((r) => {
    if (!r.ok) throw new Error(`${r.url}: ${r.status}`);
    return r.arrayBuffer();
  })));
  return show(a, b, [oldUrl, newUrl]);
}

// ------------------------------------------------------------------ input

function scrollBy(rows) {
  if (!current) return;
  renderer.scrollTo(renderer.scrollRow + rows);
  requestFrame();
}

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rowsPerPixel = 1 / (renderer.cell.h / renderer.dpr);
  const unit = e.deltaMode === 1 ? 1 : e.deltaMode === 2 ? renderer.pageRows : rowsPerPixel;
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    renderer.scrollColumn = Math.max(0, renderer.scrollColumn + Math.round((e.deltaX || e.deltaY) * unit));
    requestFrame();
  } else scrollBy(e.deltaY * unit);
}, { passive: false });

canvas.addEventListener('keydown', (e) => {
  const keys = { ArrowDown: 1, ArrowUp: -1, PageDown: renderer.pageRows, PageUp: -renderer.pageRows, ' ': renderer.pageRows };
  if (e.key in keys) { scrollBy(keys[e.key]); e.preventDefault(); }
  else if (e.key === 'Home') { renderer.scrollTo(0); requestFrame(); e.preventDefault(); }
  else if (e.key === 'End') { renderer.scrollTo(Infinity); requestFrame(); e.preventDefault(); }
  else if (e.key === 'n' || e.key === 'p') { jumpToChange(e.key === 'n' ? 1 : -1); e.preventDefault(); }
});

// next or previous change from the current row; n / p
function jumpToChange(direction) {
  const kind = current?.rows.kind;
  if (!kind) return;
  let r = Math.floor(renderer.scrollRow) + direction;
  while (r >= 0 && r < kind.length && kind[r] && kind[r - direction]) r += direction;
  while (r >= 0 && r < kind.length && !kind[r]) r += direction;
  if (r >= 0 && r < kind.length) { renderer.scrollTo(r - 3); requestFrame(); }
}

function scrollToBarY(y) {
  const h = bar.clientHeight;
  renderer.scrollTo((y / h) * renderer.rowCount - renderer.pageRows / 2);
  requestFrame();
}
let dragging = false;
bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); scrollToBarY(e.offsetY); });
bar.addEventListener('pointermove', (e) => { if (dragging) scrollToBarY(e.clientY - bar.getBoundingClientRect().top); });
bar.addEventListener('pointerup', () => { dragging = false; });

document.getElementById('goto').addEventListener('change', (e) => {
  renderer.scrollTo(Number(e.target.value) - 1);
  requestFrame();
  canvas.focus();
});

new ResizeObserver(() => { renderer.resize(); drawMarks(); requestFrame(); }).observe(canvas);
matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { renderer.resize(); requestFrame(); });

// files: two pickers, or drop the old file then the new one
const picked = { old: null, new: null };
async function tryShowPicked() {
  if (!picked.old || !picked.new) return;
  const [a, b] = await Promise.all([picked.old.arrayBuffer(), picked.new.arrayBuffer()]);
  await show(a, b, [picked.old.name, picked.new.name]);
  canvas.focus();
}
document.getElementById('oldFile').addEventListener('change', (e) => { picked.old = e.target.files[0]; tryShowPicked(); });
document.getElementById('newFile').addEventListener('change', (e) => { picked.new = e.target.files[0]; tryShowPicked(); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  if (files.length >= 2) { picked.old = files[0]; picked.new = files[1]; }
  else if (files.length === 1) { if (!picked.old || picked.new) { picked.old = files[0]; picked.new = null; } else picked.new = files[0]; }
  tryShowPicked();
});

// ------------------------------------------------------------------ benchmark hooks

function frameStats(deltas) {
  const s = [...deltas].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { frames: s.length, p50: q(0.5), p99: q(0.99), max: s[s.length - 1] };
}

// scroll a fixed number of rows every frame; returns frame-to-frame time and CPU time per frame
async function autoscroll(rowsPerFrame, frames) {
  const deltas = [], cpu = [];
  let last = await nextFrame();
  for (let i = 0; i < frames; ++i) {
    renderer.scrollTo(renderer.scrollRow + rowsPerFrame);
    const t0 = performance.now();
    renderer.draw();
    cpu.push(performance.now() - t0);
    const now = await nextFrame();
    deltas.push(now - last);
    last = now;
  }
  return { frame: frameStats(deltas), cpu: frameStats(cpu) };
}

// jump to random rows, one per frame, the way "go to line" or the scrollbar would
async function jumps(count) {
  const deltas = [], cpu = [];
  let seed = 12345, last = await nextFrame();
  for (let i = 0; i < count; ++i) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    renderer.scrollTo(seed % renderer.rowCount);
    const t0 = performance.now();
    renderer.draw();
    cpu.push(performance.now() - t0);
    const now = await nextFrame();
    deltas.push(now - last);
    last = now;
  }
  return { frame: frameStats(deltas), cpu: frameStats(cpu) };
}

async function idle(ms) {
  const deltas = [];
  let last = await nextFrame();
  const end = last + ms;
  while (last < end) { const now = await nextFrame(); deltas.push(now - last); last = now; }
  return frameStats(deltas);
}

window.viewer = { loadUrls, autoscroll, jumps, idle, renderer };

const params = new URLSearchParams(location.search);
if (params.get('old') && params.get('new')) {
  loadUrls(`/fixtures/${params.get('old')}`, `/fixtures/${params.get('new')}`)
    .then(() => { window.viewerReady = true; canvas.focus(); })
    .catch((e) => { stats.textContent = String(e); });
} else window.viewerReady = true;
