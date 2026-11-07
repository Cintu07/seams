// What a canvas viewer has to rebuild that the DOM gives for free: text selection and copy, find,
// and a mirror of the visible lines for screen readers. Every position here is (row, pane, column)
// with the same column rules the renderer draws with (tabs to 4, one column per UTF-8 character).
import { columnAt, offsetAt } from './renderer.mjs';

const decoder = new TextDecoder();
const order = (a, b) => (a.row - b.row) || (a.col - b.col);

// scope: when given, copy and the find keys only act while focus is inside it (one page, many viewers)
export function createInteraction({ renderer, canvas, getDiff, redraw, findUi, mirror, scope = null }) {
  const inScope = () => !scope || scope.contains(document.activeElement);
  // ---------------------------------------------------------------- selection
  let sel = null;          // { pane, anchor: { row, col }, head: { row, col } }
  let selecting = false;

  const point = (e) => {
    const r = canvas.getBoundingClientRect(), dpr = renderer.dpr;
    return renderer.hit((e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
  };
  const range = () => {
    if (!sel) return null;
    const [from, to] = [sel.anchor, sel.head].sort(order);
    return order(from, to) === 0 ? null : { pane: sel.pane, from, to };
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !getDiff()) return;
    const p = point(e);
    if (e.shiftKey && sel && sel.pane === p.pane) sel.head = p;
    else sel = { pane: p.pane, anchor: p, head: p };
    selecting = true;
    canvas.setPointerCapture(e.pointerId);
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!selecting) return;
    const r = canvas.getBoundingClientRect();
    // dragging past the top or bottom edge scrolls
    if (e.clientY < r.top + 10) renderer.scrollTo(renderer.scrollRow - 1);
    if (e.clientY > r.bottom - 10) renderer.scrollTo(renderer.scrollRow + 1);
    const p = point(e);
    sel.head = { row: p.row, col: p.col };
    redraw();
  });
  canvas.addEventListener('pointerup', () => { selecting = false; });
  // double click selects the whole line
  canvas.addEventListener('dblclick', (e) => {
    const p = point(e);
    sel = { pane: p.pane, anchor: { row: p.row, col: 0 }, head: { row: p.row, col: 1e9 } };
    redraw();
  });

  // the text of the selection, decoded from the file bytes
  function selectedText() {
    const r = range();
    if (!r) return '';
    const lines = [];
    for (let row = r.from.row; row <= r.to.row; ++row) {
      const [, side, line] = renderer.rowCell(row, r.pane);
      if (line < 0) continue;
      const [bytes, start, end] = renderer.lineSpan(side, line);
      const s = row === r.from.row ? offsetAt(bytes, start, end, r.from.col) : start;
      const t = row === r.to.row ? offsetAt(bytes, start, end, r.to.col) : end;
      lines.push(decoder.decode(bytes.subarray(s, t)));
    }
    return lines.join('\n');
  }
  // Ctrl+C, the context menu and the Edit menu all fire 'copy'
  const onCopy = (e) => {
    if (document.activeElement === findUi.input || !inScope()) return;
    const text = selectedText();
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };
  document.addEventListener('copy', onCopy);

  // ---------------------------------------------------------------- find
  // matches as parallel arrays: row in the current view, pane ('a' or 'b' or 'u'), columns
  let found = { rows: [], panes: [], c0: [], c1: [] }, current = -1, query = '', searchId = 0;

  // all byte offsets of needle in haystack, scanning in slices so the page never freezes
  async function scan(bytes, needle, out, id) {
    const first = needle[0], n = needle.length;
    let i = 0;
    while (i <= bytes.length - n) {
      const stop = Math.min(bytes.length - n + 1, i + (4 << 20));
      for (; i < stop; ++i) {
        if (bytes[i] !== first) continue;
        let k = 1;
        while (k < n && bytes[i + k] === needle[k]) ++k;
        if (k === n) { out.push(i); if (out.length > 200000) return; }
      }
      await new Promise((r) => setTimeout(r));
      if (id !== searchId) return;
    }
  }
  // offset -> line, by binary search over the line starts
  const lineOf = (starts, offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo;
  };

  async function search(q) {
    const d = getDiff(), id = ++searchId;
    query = q;
    found = { rows: [], panes: [], c0: [], c1: [] };
    current = -1;
    if (!d || !q) { findUi.count.textContent = ''; redraw(); return; }
    findUi.count.textContent = 'searching…';
    const needle = new TextEncoder().encode(q);
    const hits = [];
    for (const side of ['a', 'b']) {
      const offsets = [];
      await scan(side === 'a' ? d.a : d.b, needle, offsets, id);
      if (id !== searchId) return;
      const starts = side === 'a' ? d.tables.aStart : d.tables.bStart;
      for (const off of offsets) {
        const line = lineOf(starts, off);
        let row, pane;
        if (renderer.split) { row = (side === 'a' ? d.split.aRow : d.split.bRow)[line]; pane = side; }
        else {
          // unified rows show the old text for context and deleted lines, the new text for inserted ones
          row = (side === 'a' ? d.rows.aRow : d.rows.bRow)[line];
          const kind = d.rows.kind[row];
          if (side === 'b' && kind !== 2) continue;
          pane = 'u';
        }
        const [bytes, start, end] = renderer.lineSpan(side, line);
        if (off >= end) continue;
        const c0 = columnAt(bytes, start, end, off), c1 = columnAt(bytes, start, end, off + needle.length);
        hits.push([row, pane, c0, c1]);
      }
    }
    hits.sort((x, y) => (x[0] - y[0]) || (x[2] - y[2]) || (x[1] < y[1] ? -1 : 1));
    for (const [row, pane, c0, c1] of hits) { found.rows.push(row); found.panes.push(pane); found.c0.push(c0); found.c1.push(c1); }
    // start from the first match at or below the top of the view
    const top = Math.floor(renderer.scrollRow);
    current = found.rows.length ? Math.max(0, found.rows.findIndex((r) => r >= top)) : -1;
    if (current >= 0) reveal();
    status();
    redraw();
  }
  function status() {
    const n = found.rows.length;
    findUi.count.textContent = !query ? '' : n ? `${current + 1} / ${n.toLocaleString()}${n > 200000 ? '+' : ''}` : 'no matches';
  }
  function reveal() {
    const row = found.rows[current], view = renderer.pageRows;
    if (row < renderer.scrollRow || row > renderer.scrollRow + view - 2) renderer.scrollTo(row - Math.floor(view / 3));
    const col = found.c0[current];
    const width = renderer.panes()[0].end - renderer.panes()[0].text;
    if (col < renderer.scrollColumn || col > renderer.scrollColumn + width - 8) renderer.scrollColumn = Math.max(0, col - 8);
  }
  function step(direction) {
    if (!found.rows.length) return;
    current = (current + direction + found.rows.length) % found.rows.length;
    reveal(); status(); redraw();
  }

  // find matches on a row, by binary search for the first one
  function matchesOn(row) {
    let lo = 0, hi = found.rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (found.rows[mid] < row) lo = mid + 1; else hi = mid; }
    const out = [];
    for (let i = lo; i < found.rows.length && found.rows[i] === row; ++i) out.push(i);
    return out;
  }

  // what the renderer paints under the text of a row
  function decorate(row, pane) {
    let marks = null;
    const r = range();
    if (r && r.pane === pane && row >= r.from.row && row <= r.to.row) {
      marks = [[row === r.from.row ? r.from.col : 0, row === r.to.row ? r.to.col : 1e9, 'selection']];
    }
    if (found.rows.length) for (const i of matchesOn(row)) {
      if (found.panes[i] !== pane) continue;
      (marks ??= []).push([found.c0[i], found.c1[i], i === current ? 'matchCurrent' : 'match']);
    }
    return marks;
  }

  // ---------------------------------------------------------------- find bar
  let typing;
  findUi.input.addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => search(findUi.input.value), 120); });
  findUi.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (query !== findUi.input.value) search(findUi.input.value); else step(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') closeFind();
  });
  function openFind() {
    findUi.bar.hidden = false;
    const r = range();
    if (r && r.from.row === r.to.row) findUi.input.value = selectedText();
    findUi.input.focus();
    findUi.input.select();
    if (findUi.input.value && findUi.input.value !== query) search(findUi.input.value);
  }
  function closeFind() { findUi.bar.hidden = true; search(''); canvas.focus(); }
  findUi.close?.addEventListener('click', closeFind);
  const onKey = (e) => {
    if (!inScope()) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'f' && getDiff()) { e.preventDefault(); openFind(); }
    else if (e.key === 'F3' || ((e.ctrlKey || e.metaKey) && e.key === 'g')) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  };
  addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- screen-reader mirror
  // the canvas is invisible to assistive tech, so the visible lines are mirrored as a list
  let mirrorTimer;
  function updateMirror() {
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => {
      const d = getDiff();
      if (!d) return;
      const first = Math.floor(renderer.scrollRow), last = Math.min(renderer.rowCount, first + renderer.pageRows);
      const items = [];
      const word = ['', 'deleted', 'inserted', 'empty'];
      for (let row = first; row < last; ++row) {
        for (const pane of renderer.panes()) {
          const [kind, side, line] = renderer.rowCell(row, pane.side);
          if (line < 0) continue;
          const [bytes, start, end] = renderer.lineSpan(side, line);
          const li = document.createElement('li');
          li.textContent = `${kind ? word[kind] + ', ' : ''}${side === 'a' ? 'old' : 'new'} line ${line + 1}: ${decoder.decode(bytes.subarray(start, Math.min(end, start + 300)))}`;
          items.push(li);
        }
      }
      mirror.replaceChildren(...items);
    }, 150);
  }

  return {
    decorate, updateMirror, openFind, selectedText,
    clear() { sel = null; found = { rows: [], panes: [], c0: [], c1: [] }; current = -1; },
    // a view change moves every row, so selections and match rows are redone in the new view
    viewChanged() { sel = null; if (query) search(query); },
    destroy() { document.removeEventListener('copy', onCopy); removeEventListener('keydown', onKey); clearTimeout(mirrorTimer); },
  };
}
