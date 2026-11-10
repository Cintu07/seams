// A whole pull request: a file list beside one diff viewer. Every file is diffed in the background as
// soon as the review opens, so the list fills in with +/- counts while you read the first file.
//
//   const review = createReview(el, { theme: 'sage' });
//   await review.setFiles([{ path: 'src/a.ts', old: '...', new: '...' }, ...]);   // old or new null: added / deleted
//
// ] and [ (or n/p on the list) move between files; typing in the box filters paths.
import { createDiffViewer } from './embed.mjs';

const enc = new TextEncoder();
const bytesOf = (x) => (x == null ? new Uint8Array(0) : typeof x === 'string' ? enc.encode(x) : x);
const CSS = `
.seams-review { display: grid; grid-template-columns: minmax(220px, 300px) 1fr; height: 100%; min-height: 0; font: 13px/1.4 var(--seams-font, "IBM Plex Mono", Consolas, monospace); }
.seams-review .files { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--seams-line, rgba(0,0,0,.15)); }
.seams-review .files-head { padding: 8px 10px; display: grid; gap: 6px; border-bottom: 1px solid var(--seams-line, rgba(0,0,0,.15)); }
.seams-review .files-head b { font-weight: 500; }
.seams-review .files-head input { font: inherit; padding: 5px 8px; border: 1px solid var(--seams-line, rgba(0,0,0,.2)); border-radius: 6px; background: transparent; color: inherit; }
.seams-review .list { overflow: auto; flex: 1; position: relative; }
.seams-review .list > div { position: absolute; left: 0; right: 0; }
.seams-review .file { display: flex; gap: 8px; align-items: center; height: 26px; padding: 0 10px; cursor: pointer; white-space: nowrap; }
.seams-review .file:hover { background: rgba(127,127,127,.12); }
.seams-review .file.on { background: rgba(127,127,127,.24); }
.seams-review .file .name { overflow: hidden; text-overflow: ellipsis; flex: 1; direction: rtl; text-align: left; }
.seams-review .file .st { width: 12px; font-weight: 600; }
.seams-review .add { color: #2f7d3f; } .seams-review .del { color: #a4432e; } .seams-review .mod { color: #a07a1f; } .seams-review .ren { color: #3d6fa8; }
.seams-review .n { font-variant-numeric: tabular-nums; font-size: 12px; }
.seams-review .main { min-width: 0; min-height: 0; }
@media (max-width: 700px) { .seams-review { grid-template-columns: 1fr; grid-template-rows: 38% 1fr; } .seams-review .files { border-right: 0; border-bottom: 1px solid var(--seams-line, rgba(0,0,0,.15)); } }
`;
const ROW = 26;

export function createReview(element, options = {}) {
  if (!document.getElementById('seams-review-css')) {
    const s = document.createElement('style'); s.id = 'seams-review-css'; s.textContent = CSS; document.head.append(s);
  }
  element.classList.add('seams-review');
  element.innerHTML = `<div class="files"><div class="files-head"><b></b><input type="search" placeholder="filter files" aria-label="filter files"></div><div class="list" tabindex="0"><div></div></div></div><div class="main"></div>`;
  const [head, filter, list] = [element.querySelector('.files-head b'), element.querySelector('input'), element.querySelector('.list')];
  const inner = list.firstElementChild;
  const viewer = createDiffViewer(element.querySelector('.main'), options);
  let files = [], shown = [], current = -1, counts = [], workers = [], generation = 0;
  const onChange = options.onChange ?? (() => {});

  const status = (f) => (f.old == null ? 'add' : f.new == null ? 'del' : f.oldPath ? 'ren' : 'mod');
  const LETTER = { add: 'A', del: 'D', mod: 'M', ren: 'R' };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const totals = () => {
    let del = 0, ins = 0, done = 0;
    for (const c of counts) if (c) { del += c.deleted; ins += c.inserted; done++; }
    head.innerHTML = `${files.length.toLocaleString()} files <span class="n add">+${ins.toLocaleString()}</span> <span class="n del">−${del.toLocaleString()}</span>${done < files.length ? ` <span class="n">· diffing ${done.toLocaleString()}</span>` : ''}`;
  };

  // only the rows in view exist in the dom, so 5,000 files cost as much as 30
  function drawList() {
    inner.style.height = `${shown.length * ROW}px`;
    const first = Math.max(0, Math.floor(list.scrollTop / ROW) - 5), last = Math.min(shown.length, first + Math.ceil(list.clientHeight / ROW) + 10);
    let html = '';
    for (let k = first; k < last; ++k) {
      const i = shown[k], f = files[i], c = counts[i], st = status(f);
      const n = c ? `<span class="n add">+${c.inserted}</span><span class="n del">−${c.deleted}</span>` : '<span class="n">…</span>';
      html += `<div class="file${i === current ? ' on' : ''}" data-i="${i}" style="position:absolute;top:${k * ROW}px;left:0;right:0"><span class="st ${st}">${LETTER[st]}</span><span class="name" title="${esc(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}">&lrm;${esc(f.path)}&lrm;</span>${n}</div>`;
    }
    inner.innerHTML = html;
  }
  list.addEventListener('scroll', () => requestAnimationFrame(drawList), { passive: true });
  new ResizeObserver(drawList).observe(list);
  list.addEventListener('click', (e) => { const row = e.target.closest('.file'); if (row) open(Number(row.dataset.i)); });
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    shown = q ? files.map((_, i) => i).filter((i) => files[i].path.toLowerCase().includes(q)) : files.map((_, i) => i);
    list.scrollTop = 0; drawList();
  });

  async function open(i) {
    if (i < 0 || i >= files.length) return;
    current = i;
    const k = shown.indexOf(i);
    if (k >= 0 && (k * ROW < list.scrollTop || (k + 1) * ROW > list.scrollTop + list.clientHeight)) list.scrollTop = k * ROW - list.clientHeight / 2;
    drawList();
    const f = files[i];
    const result = await viewer.setFiles(bytesOf(f.old), bytesOf(f.new), { name: f.path, oldName: f.oldPath ?? f.path, newName: f.path });
    onChange({ index: i, path: f.path, result });
    return result;
  }
  const step = (d) => { const k = shown.indexOf(current); open(shown[Math.min(shown.length - 1, Math.max(0, (k < 0 ? 0 : k) + d))]); };
  element.addEventListener('keydown', (e) => {
    if (e.target === filter) return;
    if (e.key === ']' || (e.target === list && (e.key === 'n' || e.key === 'ArrowDown' || e.key === 'j'))) { e.preventDefault(); step(1); }
    else if (e.key === '[' || (e.target === list && (e.key === 'p' || e.key === 'ArrowUp' || e.key === 'k'))) { e.preventDefault(); step(-1); }
  });

  // every file, diffed off the main thread in batches spread over a few workers
  function countAll() {
    const mine = ++generation;
    workers.forEach((w) => w.terminate());
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    // a page importing seams from another site (by url) can't start that site's worker directly
    const url = new URL('./count_worker.mjs', import.meta.url);
    const start = () => url.origin === location.origin ? new Worker(url, { type: 'module' })
      : new Worker(URL.createObjectURL(new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' })), { type: 'module' });
    workers = Array.from({ length: n }, start);
    const t0 = performance.now();
    let next = 0;
    const feed = (w) => {
      if (next >= files.length) return;
      const batch = [];
      let bytes = 0;
      while (next < files.length && batch.length < 64 && bytes < 4 << 20) {
        const f = files[next], a = bytesOf(f.old).slice().buffer, b = bytesOf(f.new).slice().buffer;
        batch.push({ i: next++, a, b }); bytes += a.byteLength + b.byteLength;
      }
      w.postMessage({ batch }, batch.flatMap((x) => [x.a, x.b]));
    };
    let pending = 0;
    for (const w of workers) {
      w.onmessage = ({ data }) => {
        if (mine !== generation) return;
        for (const c of data.counts) counts[c.i] = c;
        totals(); drawList();
        if (counts.filter(Boolean).length === files.length) { api.countMs = performance.now() - t0; onChange({ counted: files.length, ms: api.countMs }); workers.forEach((x) => x.terminate()); workers = []; }
        else feed(w);
      };
      feed(w); pending++;
    }
  }

  const api = {
    viewer,
    countMs: null,
    async setFiles(items) {
      files = items; shown = files.map((_, i) => i); counts = new Array(files.length); current = -1;
      totals(); if (files.length) countAll();
      drawList();
      return files.length ? open(0) : null;
    },
    open, next: () => step(1), previous: () => step(-1),
    get index() { return current; },
    destroy() { workers.forEach((w) => w.terminate()); viewer.destroy(); element.innerHTML = ''; },
  };
  return api;
}
