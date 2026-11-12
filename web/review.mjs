// A whole pull request: a file list beside one diff viewer. Every file is diffed in the background as
// soon as the review opens, so the list fills in with +/- counts while you read the first file.
//
//   const review = createReview(el, { theme: 'sage' });
//   await review.setFiles([{ path: 'src/a.ts', old: '...', new: '...' }, ...]);   // old or new null: added / deleted
//
// ] and [ (or n/p on the list) move between files; typing in the box filters paths.
//
// Comment threads can be pinned to lines with review.setNotes([{ id, path, line, side: 'a' | 'b',
// comments: [{ author, body, at, url }] }]). Given options.onNote({ path, line, side, body, thread }),
// which returns a promise, a + appears in the gutter under the mouse and a pin's thread can be answered.
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
.seams-review .main { min-width: 0; min-height: 0; position: relative; }
.seams-review .notes { position: absolute; inset: 0 14px 0 0; pointer-events: none; overflow: hidden; }
.seams-review .pin { position: absolute; pointer-events: auto; cursor: pointer; display: flex; align-items: center; justify-content: center;
  min-width: 16px; padding: 0 3px; box-sizing: border-box; border-radius: 9px; font: 600 10px/1 var(--seams-font, "IBM Plex Mono", monospace);
  background: #3d6fa8; color: #fff; border: 0; transform: translateX(-50%); }
.seams-review .pin.ghost { background: transparent; color: #3d6fa8; border: 1.5px solid #3d6fa8; font-size: 13px; min-width: 18px; }
.seams-review .thread { position: absolute; pointer-events: auto; width: min(520px, calc(100% - 40px)); box-sizing: border-box; z-index: 2;
  background: #f6faf3; color: #1b2a21; border: 1px solid rgba(0,0,0,.18); border-radius: 8px; box-shadow: 0 6px 18px rgba(0,0,0,.18);
  padding: 8px 10px; font: 13px/1.45 var(--seams-font, "IBM Plex Mono", monospace); max-height: 60%; overflow: auto; }
.seams-review .thread .c { padding: 6px 0; border-bottom: 1px solid rgba(0,0,0,.08); }
.seams-review .thread .who { font-size: 12px; color: #45624e; display: flex; gap: 8px; }
.seams-review .thread .who a { color: inherit; margin-left: auto; }
.seams-review .thread .body { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 2px; }
.seams-review .thread textarea { width: 100%; box-sizing: border-box; min-height: 64px; margin-top: 8px; font: inherit; padding: 6px; border: 1px solid rgba(0,0,0,.2); border-radius: 6px; background: #fff; color: inherit; resize: vertical; }
.seams-review .thread .row { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
.seams-review .thread button { font: inherit; padding: 3px 10px; border-radius: 6px; border: 1px solid rgba(0,0,0,.25); background: #fff; color: inherit; cursor: pointer; }
.seams-review .thread button.go { background: #256f3e; color: #fff; border-color: #256f3e; }
.seams-review .thread .err { color: #a4432e; font-size: 12px; }
.seams-review .thread .where { font-size: 12px; color: #45624e; }
.seams-review .nt { color: #3d6fa8; }
.seams-review .pin[hidden], .seams-review .thread[hidden] { display: none; }
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
  const main = element.querySelector('.main');
  const viewer = createDiffViewer(main, { ...options, onFrame: () => placeNotes() });
  let files = [], shown = [], current = -1, counts = [], workers = [], generation = 0;
  const onChange = options.onChange ?? (() => {});
  const onNote = options.onNote;
  let notes = [], notesByPath = new Map();

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
      const talk = notesByPath.get(f.path)?.length;
      const n = (talk ? `<span class="n nt" title="${talk} comment thread${talk > 1 ? 's' : ''}">●${talk}</span>` : '') + (c ? `<span class="n add">+${c.inserted}</span><span class="n del">−${c.deleted}</span>` : '<span class="n">…</span>');
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

  // comment threads: pins over the gutter, one open thread at a time, and a + under the mouse
  const layer = document.createElement('div');
  layer.className = 'notes';
  main.append(layer);
  const ghost = document.createElement('button');
  ghost.className = 'pin ghost'; ghost.type = 'button'; ghost.textContent = '+'; ghost.hidden = true; ghost.title = 'comment on this line';
  layer.append(ghost);
  let pins = [], openThread = null, hovered = null;   // openThread: { path, line, side, thread, box }
  const when = (at) => (at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  function placeNotes() {
    const path = files[current]?.path;
    const mine = (path && notesByPath.get(path)) ?? [];
    while (pins.length < mine.length) { const b = document.createElement('button'); b.type = 'button'; b.className = 'pin'; layer.append(b); pins.push(b); }
    pins.forEach((pin, k) => {
      const t = mine[k], slot = t && viewer.lineSlot(t.line, t.side);
      pin.hidden = !slot;
      if (!slot) return;
      pin.textContent = t.comments.length;
      pin.title = `${t.comments[0].author}: ${t.comments[0].body.slice(0, 120)}`;
      pin.dataset.k = k;
      Object.assign(pin.style, { left: `${slot.x + 12}px`, top: `${slot.y + (slot.h - 16) / 2}px`, height: '16px' });
    });
    if (hovered && onNote) {
      const slot = viewer.lineSlot(hovered.line, hovered.side);
      const taken = mine.some((t) => t.line === hovered.line && t.side === hovered.side);
      ghost.hidden = !slot || taken;
      if (slot) Object.assign(ghost.style, { left: `${slot.x + 12}px`, top: `${slot.y + (slot.h - 18) / 2}px`, height: '18px' });
    } else ghost.hidden = true;
    if (openThread) {
      const slot = viewer.lineSlot(openThread.line, openThread.side);
      openThread.box.hidden = !slot;
      if (slot) {
        openThread.box.style.left = `${slot.x + 28}px`;
        openThread.box.style.top = `${Math.max(0, Math.min(slot.y + slot.h + 2, main.clientHeight - openThread.box.offsetHeight - 6))}px`;
      }
    }
  }
  function closeThread() { openThread?.box.remove(); openThread = null; }
  function showThread(spot) {   // spot: { line, side, thread? }
    closeThread();
    const f = files[current];
    const t = spot.thread ? notesByPath.get(f.path)?.find((x) => x.id === spot.thread) : null;
    const box = document.createElement('div');
    box.className = 'thread';
    box.innerHTML = `<div class="where">${esc(f.path)} · ${spot.side === 'a' ? 'old ' : ''}line ${spot.line}</div>`
      + (t ? t.comments.map((c) => `<div class="c"><div class="who"><b>${esc(c.author)}</b><span>${esc(when(c.at))}</span>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">open</a>` : ''}</div><div class="body">${esc(c.body)}</div></div>`).join('') : '')
      + (onNote ? `<textarea placeholder="${t ? 'reply' : 'leave a comment'}  (ctrl+enter sends)"></textarea><div class="row"><button class="go" type="button">${t ? 'reply' : 'comment'}</button><button class="x" type="button">close</button><span class="err"></span></div>`
        : '<div class="row"><button class="x" type="button">close</button></div>');
    layer.append(box);
    openThread = { ...spot, path: f.path, box };
    const text = box.querySelector('textarea'), go = box.querySelector('.go'), err = box.querySelector('.err');
    box.querySelector('.x').addEventListener('click', closeThread);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeThread(); viewer.focus(); }
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && go) { e.preventDefault(); go.click(); }
      e.stopPropagation();
    });
    go?.addEventListener('click', async () => {
      const body = text.value.trim();
      if (!body) return text.focus();
      go.disabled = true; err.textContent = 'sending…';
      try {
        await onNote({ path: f.path, line: spot.line, side: spot.side, body, thread: spot.thread ?? null });
        // the thread may have been redrawn with the new comment meanwhile; it's done either way
        if (openThread && openThread.path === f.path && openThread.line === spot.line && openThread.side === spot.side) closeThread();
      } catch (error) { err.textContent = error.message; go.disabled = false; }
    });
    placeNotes();
    (text ?? box.querySelector('.x')).focus();
  }
  layer.addEventListener('click', (e) => {
    const pin = e.target.closest('.pin');
    if (!pin) return;
    if (pin === ghost) return hovered && showThread({ line: hovered.line, side: hovered.side });
    const t = notesByPath.get(files[current].path)[Number(pin.dataset.k)];
    if (openThread?.thread === t.id) closeThread(); else showThread({ line: t.line, side: t.side, thread: t.id });
  });
  main.addEventListener('pointermove', (e) => {
    if (!onNote || e.target === ghost || e.target.closest('.thread')) return;
    const at = viewer.lineAt(e.clientX, e.clientY);
    const next = at && at.gutter ? { line: at.line, side: at.side } : null;
    if (next?.line !== hovered?.line || next?.side !== hovered?.side) { hovered = next; placeNotes(); }
  });
  main.addEventListener('pointerleave', () => { hovered = null; placeNotes(); });
  function groupNotes() {
    notesByPath = new Map();
    for (const t of notes) { if (!notesByPath.has(t.path)) notesByPath.set(t.path, []); notesByPath.get(t.path).push(t); }
    if (!openThread?.thread) return;
    // an open thread is redrawn with its new replies, keeping whatever was being typed
    if (!notesByPath.get(openThread.path)?.some((t) => t.id === openThread.thread)) return closeThread();
    const spot = openThread, draft = spot.box.querySelector('textarea')?.value;
    showThread(spot);
    if (draft) openThread.box.querySelector('textarea').value = draft;
  }

  async function open(i) {
    if (i < 0 || i >= files.length) return;
    if (i !== current) closeThread();
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
    if (e.target.closest('input, textarea')) return;
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
    /** keep: stay on the same file at the same line (for a pull request that just got new commits) */
    async setFiles(items, { keep = false } = {}) {
      const was = keep ? files[current]?.path : null, top = keep ? viewer.topLine : null;
      files = items; shown = files.map((_, i) => i); counts = new Array(files.length); current = -1;
      if (filter.value) filter.dispatchEvent(new Event('input'));
      totals(); if (files.length) countAll();
      drawList();
      const at = was ? Math.max(0, files.findIndex((f) => f.path === was)) : 0;
      const result = files.length ? await open(at) : null;
      if (top && files[at]?.path === was) viewer.scrollToLine(top.line, top.side);
      return result;
    },
    /** Comment threads to pin to lines: [{ id, path, line, side, comments: [{ author, body, at, url }] }] */
    setNotes(list) { notes = list; groupNotes(); drawList(); placeNotes(); },
    open, next: () => step(1), previous: () => step(-1),
    get index() { return current; },
    destroy() { workers.forEach((w) => w.terminate()); viewer.destroy(); element.innerHTML = ''; },
  };
  return api;
}
