// WebGL2 renderer for the unified diff view.
// Every glyph and every row background is one instanced quad. Each frame: find the visible rows,
// fill one instance buffer, one draw call. Text is read straight from the file bytes.

const ROW_DELETED = 1, ROW_INSERTED = 2, ROW_EMPTY = 3;
const FIRST_GLYPH = 32, LAST_GLYPH = 126;
// atlas cells after the printable ASCII range
const SOLID = LAST_GLYPH + 1, UNKNOWN = LAST_GLYPH + 2;
// every other character gets a cell the first time it is drawn; a wide one (CJK, emoji) gets two side by side
const ATLAS_COLUMNS = 32, ATLAS_ROWS = 64, FIRST_DYNAMIC_CELL = UNKNOWN - FIRST_GLYPH + 1;
const FALLBACK_FONTS = `"Noto Sans JP", "Yu Gothic", "Meiryo", "Noto Sans CJK SC", "Segoe UI Symbol", "Segoe UI Emoji", sans-serif`;
const TAB_WIDTH = 4, GUTTER_DIGITS = 7;
// per instance: column, row, width in cells, atlas cell, palette colour
const FLOATS_PER_INSTANCE = 5;

const vertexShader = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 cell;   // column, row, width, atlas cell
layout(location = 2) in float colour;
uniform vec2 cellSize;               // device pixels
uniform vec2 viewport;               // device pixels
uniform float rowOffset;             // device pixels the first visible row is scrolled up by
uniform float atlasColumns;
uniform vec2 atlasCellUv;
out vec2 uv;
flat out int paletteIndex;
void main() {
  vec2 pixel = vec2((cell.x + corner.x * cell.z) * cellSize.x, (cell.y + corner.y) * cellSize.y - rowOffset);
  gl_Position = vec4(pixel / viewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  float atlasCell = cell.w;
  vec2 origin = vec2(mod(atlasCell, atlasColumns), floor(atlasCell / atlasColumns)) * atlasCellUv;
  // a background spans many columns but samples the solid cell, so keep its uv inside one cell
  vec2 inside = cell.z > 1.0 ? vec2(0.5) : corner;
  uv = origin + inside * atlasCellUv;
  paletteIndex = int(colour);
}`;

const fragmentShader = `#version 300 es
precision mediump float;
in vec2 uv;
flat in int paletteIndex;
uniform sampler2D atlas;
uniform vec4 palette[32];
out vec4 outColour;
void main() {
  vec4 t = texture(atlas, uv);
  if (paletteIndex == 31) { outColour = vec4(t.rgb * t.a, t.a); return; }   // a colour glyph: its own pixels
  vec4 c = palette[paletteIndex];
  float coverage = t.a * c.a;
  outColour = vec4(c.rgb * coverage, coverage);
}`;

import { THEMES } from "./look.mjs";
import { Highlighter, CLASS_COLOUR } from "./lex.mjs";
import { wordDiff } from "./words.mjs";

export const PALETTE = THEMES.sage.renderer;
const COLOUR = Object.fromEntries(Object.keys(PALETTE).map((name, i) => [name, i]));
const TOKEN_COLOUR = CLASS_COLOUR.map((name) => (name ? COLOUR[name] : 0));
const IMAGE = 31;   // the palette slot the shader reads as "use the glyph's own colours" (the palette has 24)

function hexToRgba(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

export class DiffRenderer {
  constructor(canvas, { fontPx = 13, lineHeight = 1.75, fontFamily = `"IBM Plex Mono", "Cascadia Mono", Consolas, monospace`, palette = PALETTE } = {}) {
    this.palette = palette;
    this.canvas = canvas;
    this.font = { fontPx, lineHeight, fontFamily };
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    this.program = program;
    this.u = {};
    for (const name of ['cellSize', 'viewport', 'rowOffset', 'atlasColumns', 'atlasCellUv', 'atlas', 'palette'])
      this.u[name] = gl.getUniformLocation(program, name);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    this.instances = new Float32Array(0);
    this.atlasTexture = gl.createTexture();
    this.scrollRow = 0;     // fractional row at the top of the view
    this.scrollColumn = 0;
    this.resize();
  }

  // the atlas is rebuilt whenever the device pixel ratio changes, so text stays crisp at any zoom
  #buildAtlas() {
    const { fontPx, lineHeight, fontFamily } = this.font;
    const dpr = this.dpr;
    const font = `${Math.round(fontPx * dpr)}px ${fontFamily}`;
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font;
    const cellW = Math.max(1, Math.round(probe.measureText('M').width));
    const cellH = Math.max(1, Math.round(fontPx * lineHeight * dpr));
    const columns = ATLAS_COLUMNS, rows = ATLAS_ROWS;
    const atlas = document.createElement('canvas');
    atlas.width = columns * cellW;
    atlas.height = rows * cellH;
    const ctx = atlas.getContext('2d');
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    const place = (cell) => [(cell % columns) * cellW, Math.floor(cell / columns) * cellH];
    for (let code = FIRST_GLYPH; code <= LAST_GLYPH; ++code) {
      const [x, y] = place(code - FIRST_GLYPH);
      ctx.fillText(String.fromCharCode(code), x, y + cellH / 2);
    }
    const [sx, sy] = place(SOLID - FIRST_GLYPH);
    ctx.fillRect(sx, sy, cellW, cellH);
    const [ux, uy] = place(UNKNOWN - FIRST_GLYPH);
    ctx.fillText('·', ux, uy + cellH / 2);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.cell = { w: cellW, h: cellH, columns, uvW: 1 / columns, uvH: 1 / rows };
    this.glyphFont = `${font}, ${FALLBACK_FONTS}`;
    // colour emoji ask the emoji fonts first, before any flat symbol font can claim them
    this.emojiFont = `${Math.round(fontPx * dpr)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", ${FALLBACK_FONTS}`;
    this.glyphs = new Map(); this.flat = new Set();
    this.nextCell = FIRST_DYNAMIC_CELL;
    this.atlasFull = false;
    // one small canvas per glyph width, uploaded whole: no read back from the canvas, which stalls
    this.glyphCanvas = [1, 2].map((n) => { const c = document.createElement('canvas'); c.width = n * cellW; c.height = cellH; return c; });
  }

  // the atlas cell of a character beyond ascii, drawn into the atlas the first time it is asked for
  // cp is a code point, or the text of a whole cluster (a base with its accents, a joined emoji)
  #glyph(cp, wide, colourGlyph = false) {
    const known = this.glyphs.get(cp);
    if (known !== undefined) return known;
    const { w: cellW, h: cellH, columns } = this.cell;
    let at = this.nextCell;
    if (wide && at % columns === columns - 1) ++at;          // both halves on one row of the atlas
    if (at + (wide ? 2 : 1) > columns * ATLAS_ROWS) { this.atlasFull = true; return UNKNOWN - FIRST_GLYPH; }
    const g = this.glyphCanvas[wide ? 1 : 0], ctx = g.getContext('2d');
    ctx.clearRect(0, 0, g.width, g.height);
    ctx.font = colourGlyph ? this.emojiFont : this.glyphFont;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    const span = (wide ? 2 : 1) * cellW, ch = typeof cp === 'string' ? cp : String.fromCodePoint(cp);
    // a glyph from a fallback font may be wider than its cells: squeeze it in rather than clip it
    const measured = ctx.measureText(ch).width;
    if (measured > span) { ctx.save(); ctx.translate(span / 2, 0); ctx.scale(span / measured, 1); ctx.fillText(ch, 0, cellH / 2); ctx.restore(); }
    else ctx.fillText(ch, span / 2, cellH / 2);
    // an emoji the system font can't colour (flags on windows come out as two letters) is drawn like text
    if (colourGlyph) {
      const px = ctx.getImageData(0, 0, Math.ceil(span), Math.ceil(cellH)).data;
      let tinted = false;
      for (let k = 0; k < px.length && !tinted; k += 4) tinted = px[k + 3] > 40 && (Math.abs(px[k] - px[k + 1]) > 24 || Math.abs(px[k + 1] - px[k + 2]) > 24);
      if (!tinted) this.flat.add(cp);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, (at % columns) * cellW, Math.floor(at / columns) * cellH, gl.RGBA, gl.UNSIGNED_BYTE, g);
    this.glyphs.set(cp, at);
    this.nextCell = at + (wide ? 2 : 1);
    return at;
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr)), height = Math.max(1, Math.round(rect.height * dpr));
    if (dpr !== this.dpr) { this.dpr = dpr; this.#buildAtlas(); }
    this.canvas.width = width;
    this.canvas.height = height;
    this.visibleRows = Math.ceil(height / this.cell.h) + 1;
    this.visibleColumns = Math.ceil(width / this.cell.w) + 1;
    const capacity = 2 * this.visibleRows * (this.visibleColumns + 8);
    if (this.instances.length < capacity * FLOATS_PER_INSTANCE) {
      this.instances = new Float32Array(capacity * FLOATS_PER_INSTANCE);
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.instanceBuffer);
      this.gl.bufferData(this.gl.ARRAY_BUFFER, this.instances.byteLength, this.gl.DYNAMIC_DRAW);
    }
  }

  // rows of the view per screen, for page up / down
  get pageRows() { return Math.max(1, Math.floor(this.canvas.height / this.cell.h) - 1); }

  setDiff(diff) {
    this.diff = diff;
    this.wordCache = new Map();
    this.highlighter = diff.lang ? new Highlighter(diff.lang) : null;
    this.scrollRow = 0;
    this.scrollColumn = 0;
  }

  // the panes of the current view: where each starts, where its text starts, how wide it is.
  // unified: old number, new number, marker, text. split: old | new, each with one number and a marker.
  panes() {
    const columns = this.visibleColumns;
    if (!this.split) return [{ side: 'u', x0: 0, text: 2 * GUTTER_DIGITS + 4, end: columns }];
    const half = Math.floor(columns / 2);
    return [
      { side: 'a', x0: 0, text: GUTTER_DIGITS + 3, end: half },
      { side: 'b', x0: half + 1, text: half + 1 + GUTTER_DIGITS + 3, end: columns },
    ];
  }

  // what a row shows in a pane: [kind, side, line] (side 'a' or 'b'; line -1 for an empty split row)
  rowCell(row, pane) {
    const d = this.diff;
    if (pane === 'u') {
      const kind = d.rows.kind[row];
      return kind === ROW_INSERTED ? [kind, 'b', d.rows.bLine[row]] : [kind, 'a', d.rows.aLine[row]];
    }
    if (pane === 'a') return [d.split.left[row], 'a', d.split.aLine[row]];
    return [d.split.right[row], 'b', d.split.bLine[row]];
  }

  // bytes of a line, without its line ending
  lineSpan(side, line) {
    const d = this.diff;
    const bytes = side === 'a' ? d.a : d.b;
    const start = (side === 'a' ? d.tables.aStart : d.tables.bStart)[line];
    let end = start + (side === 'a' ? d.tables.aLen : d.tables.bLen)[line];
    while (end > start && (bytes[end - 1] === 10 || bytes[end - 1] === 13)) --end;
    return [bytes, start, end];
  }

  // the changed-word spans of a line, or null: byte ranges relative to the line start
  #words(side, line) {
    const d = this.diff;
    if (!d.pairs) return null;
    const other = (side === 'a' ? d.pairs.pairA : d.pairs.pairB)[line];
    if (other < 0) return null;
    const aLine = side === 'a' ? line : other, bLine = side === 'a' ? other : line;
    const key = aLine * 4294967296 + bLine;
    this.wordCache ??= new Map();
    let hit = this.wordCache.get(key);
    if (hit === undefined) {
      if (this.wordCache.size > 4096) this.wordCache.clear();
      const [ba, sa, ea] = this.lineSpan('a', aLine), [bb, sb, eb] = this.lineSpan('b', bLine);
      // very long lines (minified files) are not worth a word table
      hit = ea - sa < 4000 && eb - sb < 4000 ? wordDiff(ba, sa, ea, bb, sb, eb) : null;
      this.wordCache.set(key, hit);
    }
    return hit && (side === 'a' ? hit.a : hit.b);
  }

  get rowCount() { return this.diff ? (this.split ? this.diff.split.left.length : this.diff.rows.kind.length) : 0; }
  set rowCount(v) { /* derived from the view */ }
  get maxScrollRow() { return Math.max(0, this.rowCount - this.canvas.height / this.cell.h + 1); }
  scrollTo(row) { this.scrollRow = Math.min(Math.max(0, row), this.maxScrollRow); }

  // device-pixel point -> { row, pane, col } where col counts text columns (scroll included)
  hit(px, py) {
    const row = Math.floor(this.scrollRow + py / this.cell.h);
    const c = Math.floor(px / this.cell.w);
    const panes = this.panes();
    const pane = panes.find((p) => c < p.end) ?? panes[panes.length - 1];
    return { row: Math.min(Math.max(0, row), this.rowCount - 1), pane: pane.side, col: Math.max(0, c - pane.text + this.scrollColumn) };
  }

  // one frame: returns the number of quads drawn. decorate(row, pane) may return [[col0, col1, colourName], ...]
  draw(decorate) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const bg = hexToRgba(this.palette.background);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.diff) return 0;
    if (this.atlasFull) { this.glyphs.clear(); this.nextCell = FIRST_DYNAMIC_CELL; this.atlasFull = false; }
    const out = this.instances;
    let n = 0;
    const push = (column, row, width, glyph, colour) => {
      if (n * FLOATS_PER_INSTANCE >= out.length) return;
      const o = n * FLOATS_PER_INSTANCE;
      out[o] = column; out[o + 1] = row; out[o + 2] = width; out[o + 3] = glyph - FIRST_GLYPH; out[o + 4] = colour;
      ++n;
    };
    const first = Math.floor(this.scrollRow);
    const last = Math.min(this.rowCount, first + this.visibleRows);
    const skip = this.scrollColumn, panes = this.panes();
    const number = (value, column, y, colour) => {
      if (value < 0) return;
      let v = value + 1, c = column + GUTTER_DIGITS - 1;
      do { push(c--, y, 1, 48 + (v % 10), colour); v = Math.floor(v / 10); } while (v > 0 && c >= column);
    };
    for (let row = first; row < last; ++row) {
      const y = row - first;
      for (const pane of panes) {
        const [kind, side, line] = this.rowCell(row, pane.side);
        const width = pane.end - pane.x0;
        if (kind === ROW_DELETED) push(pane.x0, y, width, SOLID, COLOUR.deletedRow);
        else if (kind === ROW_INSERTED) push(pane.x0, y, width, SOLID, COLOUR.insertedRow);
        else if (kind === ROW_EMPTY) push(pane.x0, y, width, SOLID, COLOUR.emptyRow);
        const gutterColour = kind ? COLOUR.gutterChanged : COLOUR.gutter;
        if (pane.side === 'u') {
          number(this.diff.rows.aLine[row], 0, y, gutterColour);
          number(this.diff.rows.bLine[row], GUTTER_DIGITS + 1, y, gutterColour);
        } else number(line, pane.x0, y, gutterColour);
        if (kind === ROW_DELETED) push(pane.text - 2, y, 1, 45, COLOUR.deletedMark);
        if (kind === ROW_INSERTED) push(pane.text - 2, y, 1, 43, COLOUR.insertedMark);
        if (line < 0) continue;
        // selection and find matches sit under the text
        const marks = decorate ? decorate(row, pane.side) : null;
        if (marks) for (const [c0, c1, colourName] of marks) {
          const x0 = Math.max(pane.text, pane.text + c0 - skip), x1 = Math.min(pane.end, pane.text + c1 - skip);
          if (x1 > x0) push(x0, y, x1 - x0, SOLID, COLOUR[colourName]);
        }
        const [bytes, start, end] = this.lineSpan(side, line);
        const textColour = kind === ROW_DELETED ? COLOUR.deletedText : kind === ROW_INSERTED ? COLOUR.insertedText : COLOUR.text;
        const classes = this.highlighter ? this.highlighter.classes(side, line, bytes, start, end) : null;
        const words = kind === ROW_DELETED || kind === ROW_INSERTED ? this.#words(side, line) : null;
        const wordColour = kind === ROW_DELETED ? COLOUR.deletedWord : COLOUR.insertedWord;
        let column = 0, span = 0;
        for (let i = start; i < end;) {
          const byte = bytes[i];
          // plain ascii is the fast path; anything else is read as a whole cluster (base + accents, joined emoji)
          const ascii = byte < 0x80 && (i + 1 >= end || bytes[i + 1] < 0x80);
          const [cp, len, cw, colourGlyph, text] = ascii ? [byte, 1, byte === 9 ? -1 : 1, false, null] : cluster(bytes, i, end);
          const w = cw < 0 ? TAB_WIDTH - (column % TAB_WIDTH) : cw;
          const at = i - start;
          i += len;
          const x = column - skip;
          column += w;
          if (x < 0) continue;
          if (pane.text + x >= pane.end) break;
          if (words) {
            while (span < words.length && words[span][1] <= at) ++span;
            if (span < words.length && words[span][0] <= at) push(pane.text + x, y, Math.min(w, pane.end - pane.text - x), SOLID, wordColour);
          }
          if (byte === 32 || byte === 9) continue;
          const cls = classes && at < classes.length ? classes[at] : 0;
          const colour = cls ? TOKEN_COLOUR[cls] : textColour;
          if (len === 1 && byte >= FIRST_GLYPH && byte <= LAST_GLYPH) push(pane.text + x, y, 1, byte, colour);
          else if (!text && (cp < 32 || cp === 0x7f || cp === 0xfffd)) push(pane.text + x, y, 1, UNKNOWN, COLOUR.unknown);
          else {
            const cell = this.#glyph(text ?? cp, w === 2, colourGlyph);
            // colour emoji keep their own colours: the shader reads the atlas pixel instead of the palette
            const tint = cell === UNKNOWN - FIRST_GLYPH ? COLOUR.unknown : colourGlyph && !this.flat.has(text ?? cp) ? IMAGE : colour;
            push(pane.text + x, y, 1, FIRST_GLYPH + cell, tint);
            if (w === 2 && pane.text + x + 1 < pane.end) push(pane.text + x + 1, y, 1, FIRST_GLYPH + cell + 1, tint);
          }
        }
      }
      if (this.split) push(panes[1].x0 - 1, y, 1, SOLID, COLOUR.gutter);
    }
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out, 0, n * FLOATS_PER_INSTANCE);
    gl.uniform2f(this.u.cellSize, this.cell.w, this.cell.h);
    gl.uniform2f(this.u.viewport, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.rowOffset, (this.scrollRow - first) * this.cell.h);
    gl.uniform1f(this.u.atlasColumns, this.cell.columns);
    gl.uniform2f(this.u.atlasCellUv, this.cell.uvW, this.cell.uvH);
    gl.uniform4fv(this.u.palette, Object.keys(PALETTE).flatMap((k) => hexToRgba(this.palette[k])));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
    gl.uniform1i(this.u.atlas, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    return n;
  }
}

// theme changes only touch the palette; fonts change the atlas
DiffRenderer.prototype.setPalette = function (palette) { this.palette = palette; };
DiffRenderer.prototype.rebuildAtlas = function () { this.dpr = 0; this.resize(); };

// one UTF-8 character at i: [code point, byte length]. a broken sequence reads as U+FFFD, one byte long
export function decode(bytes, i, end) {
  const b = bytes[i];
  const len = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
  if (len === 1 || i + len > end) return [0xfffd, 1];
  let cp = b & (0xff >> (len + 1));
  for (let k = 1; k < len; ++k) {
    const c = bytes[i + k];
    if ((c & 0xc0) !== 0x80) return [0xfffd, 1];
    cp = (cp << 6) | (c & 0x3f);
  }
  return [cp, len];
}

// columns a character takes: 0 for combining marks and joiners, 2 for East Asian wide and emoji, else 1
export function charWidth(cp) {
  if (cp < 0x300) return 1;
  if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0x900 && cp <= 0x903) || (cp >= 0x93a && cp <= 0x94f && cp !== 0x93d) || (cp >= 0x951 && cp <= 0x957) || (cp >= 0x962 && cp <= 0x963) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xe0100 && cp <= 0xe01ef)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0x303e) || (cp >= 0x3041 && cp <= 0x33ff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0xa000 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f6ff) || (cp >= 0x1f900 && cp <= 0x1f9ff) || (cp >= 0x1fa70 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}

// one character as it is drawn: a base code point plus everything that attaches to it (accents,
// variation selectors, skin tones, tags, zero-width-joined emoji, the second half of a flag).
// returns [base code point, byte length, columns (-1 for a tab), colour glyph?, text or null when it is the base alone]
const RI = (cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const utf8 = new TextDecoder();
const PICTO = /\p{Extended_Pictographic}/u;
const graphemes = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const utf8Length = (s) => { let n = 0; for (const ch of s) { const c = ch.codePointAt(0); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4; } return n; };
export function cluster(bytes, i, end) {
  let cp = bytes[i], len = 1;
  if (cp >= 0x80) [cp, len] = decode(bytes, i, end);
  if (cp === 9) return [cp, 1, -1, false, null];
  if (i + len >= end || bytes[i + len] < 0x80) return [cp, len, Math.max(1, charWidth(cp)), RI(cp) || (cp >= 0x1f000 && PICTO.test(String.fromCodePoint(cp))), null];
  // the browser's grapheme rules know every script: accents, devanagari conjuncts, joined emoji, flags
  let text;
  if (graphemes) {
    const chunk = utf8.decode(bytes.subarray(i, Math.min(end, i + 64)));
    text = graphemes.segment(chunk)[Symbol.iterator]().next().value.segment;
  } else text = String.fromCodePoint(cp);
  const bytesLen = Math.max(len, utf8Length(text));
  const colour = RI(cp) || (cp >= 0x80 && PICTO.test(String.fromCodePoint(cp)));
  let width = 0;
  if (colour && (cp >= 0x1f000 || text.includes('\ufe0f'))) width = 2;
  else for (const ch of text) width += charWidth(ch.codePointAt(0));
  return [cp, bytesLen, Math.max(1, width), colour, bytesLen > len ? text : null];
}
// the same walk, for columns only; plain ascii skips the cluster check
function step(bytes, i, end) {
  const b = bytes[i];
  if (b < 0x80 && (i + 1 >= end || bytes[i + 1] < 0x80)) return [1, b === 9 ? -1 : 1];
  const c = cluster(bytes, i, end);
  return [c[1], c[2]];
}
// display column of a byte offset in a line (tabs to the next stop of 4, wide characters two columns)
export function columnAt(bytes, start, end, offset) {
  let column = 0;
  for (let i = start; i < Math.min(offset, end);) {
    const [len, w] = step(bytes, i, end);
    column += w < 0 ? TAB_WIDTH - (column % TAB_WIDTH) : w;
    i += len;
  }
  return column;
}
// byte offset of the character covering a display column; the end of the line past its last column
export function offsetAt(bytes, start, end, col) {
  let column = 0;
  for (let i = start; i < end;) {
    const [len, cw] = step(bytes, i, end);
    const w = cw < 0 ? TAB_WIDTH - (column % TAB_WIDTH) : cw;
    if (column + w > col) return i;
    column += w;
    i += len;
  }
  return end;
}
