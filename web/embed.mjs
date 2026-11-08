// The embeddable viewer: everything the demo page does that a host page needs, inside one element.
//   const viewer = createDiffViewer(element, { theme: 'sage', view: 'unified' });
//   await viewer.setFiles(oldText, newText, { name: 'main.ts' });
// Files can be strings, Uint8Arrays, ArrayBuffers or Blobs. All viewers on a page share one worker.
import { DiffRenderer } from './renderer.mjs';
import { THEMES } from './look.mjs';
import { createInteraction } from './interact.mjs';
import { languageOf } from './lex.mjs';
import { readPack } from './pack.mjs';

let worker = null, nextId = 0;
const waiting = new Map();   // id -> { resolve, onStates }
function getWorker() {
  if (worker) return worker;
  const url = new URL('./diff_worker.mjs', import.meta.url);
  // a page that imports seams from another site (by url) can't start a worker from there directly,
  // so it starts a one-line worker of its own that imports the real one
  worker = url.origin === location.origin
    ? new Worker(url, { type: 'module' })
    : new Worker(URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' })), { type: 'module' });
  worker.addEventListener('message', ({ data }) => {
    const w = waiting.get(data.id);
    if (!w) return;
    if (data.states) { waiting.delete(data.id); w.onStates(data); }
    else { if (!w.lang) waiting.delete(data.id); w.resolve(data); }
  });
  return worker;
}

async function toBuffer(input) {
  if (input == null) return new ArrayBuffer(0);
  if (typeof input === 'string') return new TextEncoder().encode(input).buffer;
  if (input instanceof ArrayBuffer) return input.slice(0);              // the worker takes ownership
  if (ArrayBuffer.isView(input)) return input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  if (typeof input.arrayBuffer === 'function') return input.arrayBuffer();
  throw new TypeError('seams: a file must be a string, ArrayBuffer, typed array or Blob');
}

const CSS = `
.seams-root { position: relative; overflow: hidden; background: var(--seams-bg); color: var(--seams-ink); font: 12px/1.4 ui-monospace, Consolas, monospace; }
.seams-root canvas { position: absolute; inset: 0 12px 0 0; width: calc(100% - 12px); height: 100%; outline: none; cursor: text; touch-action: none; }
.seams-bar { position: absolute; top: 0; right: 0; bottom: 0; width: 12px; background: var(--seams-bar); }
.seams-bar canvas { position: absolute; inset: 0; width: 100%; height: 100%; cursor: default; }
.seams-thumb { position: absolute; left: 2px; right: 2px; border-radius: 3px; background: var(--seams-ink); opacity: .25; pointer-events: none; }
.seams-find { position: absolute; top: 8px; right: 24px; display: flex; gap: 6px; align-items: center; padding: 6px 8px; background: var(--seams-bar); border: 1px solid var(--seams-ink); border-radius: 4px; }
.seams-find[hidden] { display: none; }
.seams-find input { font: inherit; width: 180px; background: var(--seams-bg); color: inherit; border: 1px solid var(--seams-ink); border-radius: 3px; padding: 2px 6px; }
.seams-find button { font: inherit; background: none; color: inherit; border: 0; cursor: pointer; }
.seams-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
`;
function injectCss() {
  if (document.getElementById('seams-css')) return;
  const style = document.createElement('style');
  style.id = 'seams-css';
  style.textContent = CSS;
  document.head.append(style);
}

const themeOf = (t) => (typeof t === 'string' ? THEMES[t] ?? THEMES.sage : t);

export function createDiffViewer(element, { theme = 'sage', view = 'unified', fontSize = 13, lineHeight = 1.75, fontFamily } = {}) {
  injectCss();
  let look = themeOf(theme);
  const root = document.createElement('div');
  root.className = 'seams-root';
  root.style.width = '100%';
  root.style.height = '100%';
  root.innerHTML = `<canvas tabindex="0" role="img" aria-roledescription="diff"></canvas>
    <div class="seams-bar"><canvas></canvas><div class="seams-thumb" hidden></div></div>
    <div class="seams-find" role="search" hidden><input type="search" placeholder="find" aria-label="find in diff"><span aria-live="polite"></span><button type="button" aria-label="close find">×</button></div>
    <ol class="seams-sr"></ol>`;
  element.append(root);
  const [canvas, marks] = root.querySelectorAll('canvas');
  const bar = root.querySelector('.seams-bar'), thumb = root.querySelector('.seams-thumb');
  const findBar = root.querySelector('.seams-find'), mirror = root.querySelector('.seams-sr');
  mirror.id = `seams-mirror-${Math.random().toString(36).slice(2)}`;
  canvas.setAttribute('aria-describedby', mirror.id);

  const renderer = new DiffRenderer(canvas, { fontPx: fontSize, lineHeight, palette: look.renderer, ...(fontFamily ? { fontFamily } : {}) });
  renderer.split = view === 'split';
  let current = null, frameQueued = false, destroyed = false, loadId = 0;
  const ix = createInteraction({
    renderer, canvas, getDiff: () => current, redraw: () => requestFrame(), scope: root,
    findUi: { bar: findBar, input: findBar.querySelector('input'), count: findBar.querySelector('span'), close: findBar.querySelector('button') },
    mirror,
  });

  function requestFrame() {
    if (frameQueued || destroyed) return;
    frameQueued = true;
    requestAnimationFrame(() => {
      frameQueued = false;
      if (destroyed) return;
      renderer.draw(ix.decorate);
      ix.updateMirror();
      placeThumb();
    });
  }
  function placeThumb() {
    thumb.hidden = !current;
    if (!current) return;
    const h = bar.clientHeight, size = Math.max(20, h * Math.min(1, renderer.pageRows / renderer.rowCount));
    thumb.style.height = `${size}px`;
    thumb.style.top = `${renderer.maxScrollRow ? (renderer.scrollRow / renderer.maxScrollRow) * (h - size) : 0}px`;
  }
  function drawMarks() {
    const dpr = devicePixelRatio || 1;
    marks.width = Math.max(1, Math.round(bar.clientWidth * dpr));
    marks.height = Math.max(1, Math.round(bar.clientHeight * dpr));
    const ctx = marks.getContext('2d');
    ctx.clearRect(0, 0, marks.width, marks.height);
    if (!current) return;
    const total = renderer.rowCount, h = marks.height, w = marks.width;
    const del = new Uint8Array(h), ins = new Uint8Array(h);
    for (let r = 0; r < total; ++r) {
      const y = Math.floor((r / total) * h);
      if (renderer.split) { if (current.split.left[r] === 1) del[y] = 1; if (current.split.right[r] === 2) ins[y] = 1; }
      else { const k = current.rows.kind[r]; if (k === 1) del[y] = 1; else if (k === 2) ins[y] = 1; }
    }
    const mark = Math.max(2, Math.round(2 * dpr));
    for (let y = 0; y < h; ++y) {
      if (del[y]) { ctx.fillStyle = look.renderer.deletedMark; ctx.fillRect(0, y, w / 2, mark); }
      if (ins[y]) { ctx.fillStyle = look.renderer.insertedMark; ctx.fillRect(w / 2, y, w / 2, mark); }
    }
  }
  function applyLook() {
    root.style.setProperty('--seams-bg', look.renderer.background);
    root.style.setProperty('--seams-ink', look.renderer.text);
    root.style.setProperty('--seams-bar', look.renderer.emptyRow);
    renderer.setPalette(look.renderer);
    drawMarks();
    requestFrame();
  }

  const scrollBy = (rows) => { if (current) { renderer.scrollTo(renderer.scrollRow + rows); requestFrame(); } };
  canvas.addEventListener('wheel', (e) => {
    if (!current) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 1 : e.deltaMode === 2 ? renderer.pageRows : renderer.dpr / renderer.cell.h;
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      renderer.scrollColumn = Math.max(0, renderer.scrollColumn + Math.round((e.deltaX || e.deltaY) * unit));
      requestFrame();
    } else scrollBy(e.deltaY * unit);
  }, { passive: false });
  // touch: drag to scroll (selection stays a mouse and pen gesture)
  let touchY = null;
  canvas.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    if (touchY === null) return;
    const y = e.touches[0].clientY;
    scrollBy(((touchY - y) * renderer.dpr) / renderer.cell.h);
    touchY = y;
  }, { passive: true });
  canvas.addEventListener('keydown', (e) => {
    const keys = { ArrowDown: 1, ArrowUp: -1, PageDown: renderer.pageRows, PageUp: -renderer.pageRows, ' ': renderer.pageRows };
    if (e.key in keys) scrollBy(keys[e.key]);
    else if (e.key === 'Home') { renderer.scrollTo(0); requestFrame(); }
    else if (e.key === 'End') { renderer.scrollTo(Infinity); requestFrame(); }
    else if (e.key === 'n' || e.key === 'p') api.nextChange(e.key === 'n' ? 1 : -1);
    else return;
    e.preventDefault();
  });
  const barTo = (y) => { renderer.scrollTo((y / bar.clientHeight) * renderer.rowCount - renderer.pageRows / 2); requestFrame(); };
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => { if (!current) return; dragging = true; bar.setPointerCapture(e.pointerId); barTo(e.offsetY); });
  bar.addEventListener('pointermove', (e) => { if (dragging) barTo(e.clientY - bar.getBoundingClientRect().top); });
  bar.addEventListener('pointerup', () => { dragging = false; });

  const resized = new ResizeObserver(() => { renderer.resize(); drawMarks(); requestFrame(); });
  resized.observe(canvas);
  // the atlas is drawn with whatever font is ready; redraw it once web fonts arrive
  document.fonts?.ready.then(() => { if (!destroyed) { renderer.rebuildAtlas(); requestFrame(); } });

  async function show(result, t0) {
    ix.clear();
    renderer.setDiff(result);
    current = result;
    if (result.states) renderer.highlighter?.setStates(result.states);
    renderer.draw(ix.decorate);
    await new Promise((r) => requestAnimationFrame(r));
    result.timing.firstFrame = performance.now() - t0;
    canvas.setAttribute('aria-label', `diff, ${result.deleted} lines deleted, ${result.inserted} inserted`);
    drawMarks();
    requestFrame();
    return api.stats;
  }

  const api = {
    /** Diff two files and show them. Resolves with row counts and timings once the first frame is drawn. */
    async setFiles(oldFile, newFile, { name, oldName, newName, language } = {}) {
      const id = ++nextId, mine = ++loadId;
      const lang = language !== undefined ? language : languageOf(newName ?? name ?? '') ?? languageOf(oldName ?? '');
      const t0 = performance.now();
      const [a, b] = await Promise.all([toBuffer(oldFile), toBuffer(newFile)]);
      const result = await new Promise((resolve) => {
        waiting.set(id, {
          lang, resolve,
          onStates: (data) => {
            if (destroyed || current !== result || !renderer.highlighter) return;
            result.timing.states = data.timing.states;
            renderer.highlighter.setStates(data.states);
            requestFrame();
          },
        });
        getWorker().postMessage({ id, a, b, lang }, [a, b]);
      });
      if (destroyed || mine !== loadId) return null;   // a newer setFiles won
      result.a = new Uint8Array(result.a);
      result.b = new Uint8Array(result.b);
      result.lang = lang;
      return show(result, t0);
    },
    /** Open a diff made ahead of time with seams-pack: nothing is diffed in the browser. */
    async setPack(source) {
      const mine = ++loadId, t0 = performance.now();
      let buffer = source;
      if (typeof source === 'string' || source instanceof URL) {
        const r = await fetch(source);
        if (!r.ok) throw new Error(`seams: ${r.url}: ${r.status}`);
        buffer = await r.arrayBuffer();
      } else if (ArrayBuffer.isView(source)) buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
      else if (typeof source?.arrayBuffer === 'function') buffer = await source.arrayBuffer();
      if (destroyed || mine !== loadId) return null;
      return show(readPack(buffer), t0);
    },
    get stats() {

      return current && { rows: renderer.rowCount, deleted: current.deleted, inserted: current.inserted, changes: current.records, language: current.lang, timing: { ...current.timing } };
    },
    /** 'unified' or 'split'; the line at the top of the view stays there. */
    setView(next) {
      const split = next === 'split';
      if (split === !!renderer.split) return;
      if (!current) { renderer.split = split; return; }
      const top = Math.floor(renderer.scrollRow);
      const line = renderer.split ? current.split.aLine[top] : current.rows.aLine[top];
      renderer.split = split;
      if (line >= 0) renderer.scrollTo((split ? current.split.aRow : current.rows.aRow)[line]);
      ix.viewChanged();
      drawMarks();
      requestFrame();
    },
    /** 'sage', 'dusk', or a theme object with the same shape (see THEMES). */
    setTheme(next) { look = themeOf(next); applyLook(); },
    /** Bring a 1-based line of the old ('a') or new ('b') file into view. */
    scrollToLine(line, side = 'b') {
      if (!current) return;
      const map = renderer.split ? current.split : current.rows;
      const row = (side === 'a' ? map.aRow : map.bRow)[Math.max(0, line - 1)];
      if (row !== undefined) { renderer.scrollTo(row - 3); requestFrame(); }
    },
    /** Jump to the next (1) or previous (-1) change. Returns false when there is none. */
    nextChange(direction = 1) {
      if (!current) return false;
      const changed = renderer.split ? (r) => current.split.left[r] !== 0 || current.split.right[r] !== 0 : (r) => current.rows.kind[r] !== 0;
      const n = renderer.rowCount;
      let r = Math.floor(renderer.scrollRow) + 3 + direction;
      while (r >= 0 && r < n && changed(r) && changed(r - direction)) r += direction;
      while (r >= 0 && r < n && !changed(r)) r += direction;
      if (r < 0 || r >= n) return false;
      renderer.scrollTo(r - 3);
      requestFrame();
      return true;
    },
    openFind() { ix.openFind(); },
    selectedText() { return ix.selectedText(); },
    focus() { canvas.focus(); },
    destroy() {
      destroyed = true;
      resized.disconnect();
      ix.destroy();
      renderer.gl.getExtension('WEBGL_lose_context')?.loseContext();
      root.remove();
    },
    renderer,
  };
  applyLook();
  return api;
}

export { THEMES, languageOf };
