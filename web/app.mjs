// Viewer page: loads two files, diffs them in a worker, renders with WebGL2, owns scrolling.
// window.viewer exposes load/scroll/jump hooks for the automated benchmark (web/bench_viewer.mjs).
import { DiffRenderer } from './renderer.mjs';
import { THEMES, icon, face, drawSkyline } from './look.mjs';
import { createInteraction } from './interact.mjs';
import { languageOf } from './lex.mjs';
import { readPack } from './pack.mjs';

const $ = (id) => document.getElementById(id);
const canvas = $('view'), stats = $('stats'), bar = $('bar'), thumb = $('thumb'), marks = $('marks');
const empty = $('empty'), city = $('city'), mascot = $('mascot'), say = $('say');

const storage = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
let theme = THEMES[storage.get('seams-theme')] ?? THEMES.sage;

// the canvas atlas needs the real font, so wait for it (briefly) before the first draw
await Promise.race([document.fonts.load('13px "IBM Plex Mono"'), new Promise((r) => setTimeout(r, 1500))]);
const renderer = new DiffRenderer(canvas, { palette: theme.renderer });
const worker = new Worker(new URL('./diff_worker.mjs', import.meta.url), { type: 'module' });
const ix = createInteraction({
  renderer, canvas, getDiff: () => current, redraw: () => requestFrame(),
  findUi: { bar: $('find'), input: $('findInput'), count: $('findCount'), close: $('findClose') },
  mirror: $('mirror'),
});

let current = null;
let requestId = 0;
let frameQueued = false;
const frameTimes = [];  // CPU ms spent building and submitting each frame

// ------------------------------------------------------------------ look

function setMood(name, words) {
  mascot.innerHTML = face(name, { scale: 3, accent: theme.renderer.insertedMark });
  say.textContent = words;
  mascot.classList.remove('bounce');
  void mascot.offsetWidth;
  mascot.classList.add('bounce');
}

function applyTheme(next) {
  theme = next;
  const css = document.documentElement.style;
  css.setProperty('--page', theme.page); css.setProperty('--panel', theme.panel); css.setProperty('--ink', theme.ink);
  css.setProperty('--soft', theme.soft); css.setProperty('--line', theme.line);
  css.setProperty("--sky-ink", theme.skyInk); css.setProperty("--sky-glow", theme.skyGlow);
  css.setProperty('--del', theme.renderer.deletedMark); css.setProperty('--ins', theme.renderer.insertedMark);
  document.documentElement.dataset.theme = theme.name;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.page);
  $('oldIcon').innerHTML = icon('oldFile', { scale: 2 });
  $('newIcon').innerHTML = icon('newFile', { scale: 2, accent: '#e0a03a' });
  renderer.setPalette(theme.renderer);
  if (!empty.hidden) drawSkyline(city, theme);
  drawMarks();
  requestFrame();
  storage.set('seams-theme', theme.name);
}

function tick() {
  const d = new Date();
  $('clock').textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  $('date').textContent = `${d.getDate()}日 ${d.getHours()}時`;
}
setInterval(tick, 1000);
tick();

mascot.addEventListener('click', () => {
  applyTheme(theme.name === 'sage' ? THEMES.dusk : THEMES.sage);
  setMood(current ? (current.records ? 'happy' : 'same') : 'idle', theme.name === 'sage' ? 'sage, like a calm morning' : 'dusk, city lights on');
});

// ------------------------------------------------------------------ drawing

function requestFrame() {
  if (frameQueued) return;
  frameQueued = true;
  requestAnimationFrame(() => {
    frameQueued = false;
    const t0 = performance.now();
    renderer.draw(ix.decorate);
    frameTimes.push(performance.now() - t0);
    ix.updateMirror();
    if (frameTimes.length > 240) frameTimes.shift();
    placeThumb();
  });
}

function placeThumb() {
  thumb.hidden = !current;
  if (!current) return;
  const h = bar.clientHeight, total = renderer.rowCount, page = renderer.pageRows;
  const size = Math.max(20, h * Math.min(1, page / total));
  const top = renderer.maxScrollRow ? (renderer.scrollRow / renderer.maxScrollRow) * (h - size) : 0;
  thumb.style.height = `${size}px`;
  thumb.style.top = `${top}px`;
}

// one pixel row of the scrollbar per slice of rows; red left, green right where that slice changes
function drawMarks() {
  const dpr = devicePixelRatio || 1;
  marks.width = Math.max(1, Math.round(bar.clientWidth * dpr));
  marks.height = Math.max(1, Math.round(bar.clientHeight * dpr));
  const ctx = marks.getContext('2d');
  ctx.clearRect(0, 0, marks.width, marks.height);
  if (!current) return;
  const total = renderer.rowCount, h = marks.height;
  const deleted = new Uint8Array(h), inserted = new Uint8Array(h);
  for (let r = 0; r < total; ++r) {
    const y = Math.floor((r / total) * h);
    if (renderer.split) { if (current.split.left[r] === 1) deleted[y] = 1; if (current.split.right[r] === 2) inserted[y] = 1; continue; }
    const k = current.rows.kind[r];
    if (k === 1) deleted[y] = 1; else if (k === 2) inserted[y] = 1;
  }
  const mark = Math.max(2, Math.round(2 * dpr));
  for (let y = 0; y < h; ++y) {
    if (deleted[y]) { ctx.fillStyle = theme.renderer.deletedMark; ctx.fillRect(0, y, marks.width / 2, mark); }
    if (inserted[y]) { ctx.fillStyle = theme.renderer.insertedMark; ctx.fillRect(marks.width / 2, y, marks.width / 2, mark); }
  }
}

function showStats() {
  if (!current) return;
  const sorted = [...frameTimes].sort((x, y) => x - y);
  const p = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0).toFixed(2);
  const t = current.timing;
  stats.innerHTML =
    `${renderer.rowCount.toLocaleString()} rows  <span class="del">−${current.deleted.toLocaleString()}</span>  <span class="ins">+${current.inserted.toLocaleString()}</span>\n` +
    `diff ${t.diff.toFixed(1)} ms · first frame ${(t.firstFrame ?? 0).toFixed(1)} ms · frame ${p(0.99)} ms · row ${Math.floor(renderer.scrollRow + 1).toLocaleString()}`;
}
setInterval(showStats, 250);

// ------------------------------------------------------------------ loading

// line-start states for the highlighter arrive after the first frame
worker.addEventListener('message', ({ data }) => {
  if (!data.states || !current || data.id !== current.id) return;
  current.timing.states = data.timing.states;
  renderer.highlighter?.setStates(data.states);
  requestFrame();
});

function diffInWorker(a, b, lang) {
  const id = ++requestId;
  return new Promise((resolve) => {
    const onMessage = ({ data }) => {
      if (data.id !== id || data.states) return;
      worker.removeEventListener('message', onMessage);
      resolve(data);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({ id, a, b, lang }, [a, b]);
  });
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(performance.now())));
const shortName = (path) => String(path).split(/[\\/]/).pop();

// a and b are ArrayBuffers already in memory; the timer starts here
async function show(a, b, names) {
  setMood('busy', 'diffing…');
  const t0 = performance.now();
  const lang = languageOf(names[1]) ?? languageOf(names[0]);
  const result = await diffInWorker(a, b, lang);
  result.lang = lang;
  result.a = new Uint8Array(result.a);
  result.b = new Uint8Array(result.b);
  return present(result, names, t0);
}

// a pack was diffed ahead of time: no worker, no diff, only rows to lay out and a frame to draw
async function showPack(buffer, label) {
  const t0 = performance.now();
  const result = readPack(buffer);
  return present(result, result.names ?? [label, label], t0);
}

async function present(result, names, t0) {
  ix.clear();
  renderer.setDiff(result);
  current = result;
  if (result.states) renderer.highlighter?.setStates(result.states);
  renderer.draw();
  await nextFrame();
  result.timing.firstFrame = performance.now() - t0;
  empty.hidden = true;
  const [oldName, newName] = names.map(shortName);
  $('files').textContent = `${oldName} → ${newName}`;
  $('oldName').textContent = oldName;
  $('newName').textContent = newName;
  document.title = `seams · ${newName}`;
  if (result.records) setMood('happy', `−${result.deleted.toLocaleString()} +${result.inserted.toLocaleString()} · n for next change`);
  else setMood('same', 'identical files ✿');
  drawMarks();
  requestFrame();
  showStats();
  return { ...result.timing, rows: renderer.rowCount, deleted: result.deleted, inserted: result.inserted };
}

async function loadPack(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.url}: ${r.status}`);
  return showPack(await r.arrayBuffer(), url);
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
  else if (e.key === 't') { mascot.click(); e.preventDefault(); }
  else if (e.key === 'v') { toggleView(); e.preventDefault(); }
});

// unified <-> split, keeping the same old line at the top of the view
function toggleView() {
  if (!current) return;
  const top = Math.floor(renderer.scrollRow);
  const line = renderer.split ? current.split.aLine[top] : current.rows.aLine[top];
  renderer.split = !renderer.split;
  if (line >= 0) renderer.scrollTo((renderer.split ? current.split.aRow : current.rows.aRow)[line]);
  $('viewToggle').textContent = renderer.split ? 'unified view' : 'split view';
  $('viewToggle').setAttribute('aria-pressed', String(renderer.split));
  ix.viewChanged();
  drawMarks();
  requestFrame();
}
$('viewToggle').addEventListener('click', () => { toggleView(); canvas.focus(); });
$('findOpen').addEventListener('click', () => ix.openFind());

// next or previous change from the current row; n / p
function jumpToChange(direction) {
  if (!current) return;
  const kind = renderer.split ? { length: renderer.rowCount, at: (r) => current.split.left[r] | current.split.right[r] } : null;
  const changed = (r) => (kind ? (current.split.left[r] !== 0 || current.split.right[r] !== 0) : current.rows.kind[r] !== 0);
  const n = renderer.rowCount;
  let r = Math.floor(renderer.scrollRow) + 3 + direction;
  while (r >= 0 && r < n && changed(r) && changed(r - direction)) r += direction;
  while (r >= 0 && r < n && !changed(r)) r += direction;
  if (r >= 0 && r < n) { renderer.scrollTo(r - 3); requestFrame(); }
  else setMood('sleepy', direction > 0 ? 'no more changes below' : 'no more changes above');
}

function scrollToBarY(y) {
  renderer.scrollTo((y / bar.clientHeight) * renderer.rowCount - renderer.pageRows / 2);
  requestFrame();
}
let dragging = false;
bar.addEventListener('pointerdown', (e) => { dragging = true; bar.setPointerCapture(e.pointerId); scrollToBarY(e.offsetY); });
bar.addEventListener('pointermove', (e) => { if (dragging) scrollToBarY(e.clientY - bar.getBoundingClientRect().top); });
bar.addEventListener('pointerup', () => { dragging = false; });

new ResizeObserver(() => {
  renderer.resize();
  drawMarks();
  if (!empty.hidden) drawSkyline(city, theme);
  requestFrame();
}).observe(canvas);
matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener('change', () => { renderer.resize(); requestFrame(); });

// files: the two page buttons, or drop the old file then the new one
const picked = { old: null, new: null };
async function tryShowPicked() {
  if (picked.old && !picked.new) setMood('idle', `${picked.old.name} · now the new one`);
  if (!picked.old || !picked.new) return;
  const [a, b] = await Promise.all([picked.old.arrayBuffer(), picked.new.arrayBuffer()]);
  await show(a, b, [picked.old.name, picked.new.name]);
  canvas.focus();
}
$('pickOld').addEventListener('click', () => $('oldFile').click());
$('pickNew').addEventListener('click', () => $('newFile').click());
$('oldFile').addEventListener('change', (e) => { picked.old = e.target.files[0]; tryShowPicked(); });
$('newFile').addEventListener('change', (e) => { picked.new = e.target.files[0]; tryShowPicked(); });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const pack = [...e.dataTransfer.files].find((f) => f.name.endsWith('.seamspack'));
  if (pack) { pack.arrayBuffer().then((buf) => showPack(buf, pack.name)).then(() => canvas.focus()); return; }
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

window.viewer = { loadUrls, loadPack, autoscroll, jumps, idle, renderer };

applyTheme(theme);
setMood('idle', 'hello · drop two files');
const params = new URLSearchParams(location.search);
if (params.get('pack')) {
  loadPack(`/fixtures/${params.get('pack')}`)
    .then(() => { window.viewerReady = true; canvas.focus(); })
    .catch((e) => { say.textContent = String(e); });
} else if (params.get('old') && params.get('new')) {
  loadUrls(`/fixtures/${params.get('old')}`, `/fixtures/${params.get('new')}`)
    .then(() => { window.viewerReady = true; canvas.focus(); })
    .catch((e) => { say.textContent = String(e); });
} else window.viewerReady = true;
