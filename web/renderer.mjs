// WebGL2 renderer for the unified diff view.
// Every glyph and every row background is one instanced quad. Each frame: find the visible rows,
// fill one instance buffer, one draw call. Text is read straight from the file bytes.

const ROW_DELETED = 1, ROW_INSERTED = 2, ROW_EMPTY = 3;
const FIRST_GLYPH = 32, LAST_GLYPH = 126;
// atlas cells after the printable ASCII range
const SOLID = LAST_GLYPH + 1, UNKNOWN = LAST_GLYPH + 2, ATLAS_CELLS = LAST_GLYPH + 3 - FIRST_GLYPH;
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
uniform vec4 palette[16];
out vec4 outColour;
void main() {
  vec4 c = palette[paletteIndex];
  float coverage = texture(atlas, uv).a * c.a;
  outColour = vec4(c.rgb * coverage, coverage);
}`;

import { THEMES } from "./look.mjs";

export const PALETTE = THEMES.sage.renderer;
const COLOUR = Object.fromEntries(Object.keys(PALETTE).map((name, i) => [name, i]));

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
    const columns = 16, rows = Math.ceil(ATLAS_CELLS / columns);
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
        let column = 0;
        for (let i = start; i < end; ++i) {
          const byte = bytes[i];
          // one glyph per UTF-8 character: continuation bytes take no column
          if (byte >= 0x80 && byte < 0xc0) continue;
          const w = byte === 9 ? TAB_WIDTH - (column % TAB_WIDTH) : 1;
          const x = column - skip;
          column += w;
          if (x < 0) continue;
          if (pane.text + x >= pane.end) break;
          if (byte === 32 || byte === 9) continue;
          if (byte >= FIRST_GLYPH && byte <= LAST_GLYPH) push(pane.text + x, y, 1, byte, textColour);
          else push(pane.text + x, y, 1, UNKNOWN, COLOUR.unknown);
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

// display column of a byte offset in a line (tabs to the next stop of 4, one column per UTF-8 character)
export function columnAt(bytes, start, end, offset) {
  let column = 0;
  for (let i = start; i < Math.min(offset, end); ++i) {
    const byte = bytes[i];
    if (byte >= 0x80 && byte < 0xc0) continue;
    column += byte === 9 ? TAB_WIDTH - (column % TAB_WIDTH) : 1;
  }
  return column;
}
// byte offset of the character covering a display column; the end of the line past its last column
export function offsetAt(bytes, start, end, col) {
  let column = 0;
  for (let i = start; i < end; ++i) {
    const byte = bytes[i];
    if (byte >= 0x80 && byte < 0xc0) continue;
    const w = byte === 9 ? TAB_WIDTH - (column % TAB_WIDTH) : 1;
    if (column + w > col) return i;
    column += w;
  }
  return end;
}
