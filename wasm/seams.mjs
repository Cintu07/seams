// JS host for the WebAssembly core. Like the C callers of the native engine, it owns all
// allocation: it lays out every array in linear memory, fills the descriptor and calls diff.
import { FIELD, TABLE, DESCRIPTOR_BYTES, CONST, ALIGN } from './layout.mjs';

const PAGE = 65536;
const align = (n) => Math.ceil(n / ALIGN) * ALIGN;

export class SeamsError extends Error {
  constructor(where, status) {
    super(`${where} failed with status ${status}`);
    this.status = status;
  }
}

export async function loadSeams(wasmBytes) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return new Seams(instance.exports);
}

export class Seams {
  constructor(exports) {
    this.x = exports;
    this.memory = exports.memory;
  }

  // bump allocator over one region; returns the byte address of each array
  #plan(sizes) {
    let at = align(DESCRIPTOR_BYTES);
    const where = {};
    for (const [name, bytes] of Object.entries(sizes)) {
      where[name] = at;
      at = align(at + Math.max(bytes, 1));
    }
    const need = at + 16;
    if (need > this.memory.buffer.byteLength) this.memory.grow(Math.ceil((need - this.memory.buffer.byteLength) / PAGE));
    return where;
  }

  #setTable(view, side, where, lines) {
    const base = FIELD[`${side}_start`];
    view.setUint32(base + TABLE.t_start, where[`${side}_start`], true);
    view.setUint32(base + TABLE.t_lens, where[`${side}_lens`], true);
    view.setUint32(base + TABLE.t_hash, where[`${side}_hash`], true);
    view.setUint32(base + TABLE.t_id, where[`${side}_id`], true);
    view.setUint32(base + TABLE.t_count, 0, true);
    view.setUint32(base + TABLE.t_capacity, lines, true);
  }

  // Minimal line diff of a and b (Uint8Array). Returns the change records as Uint32Arrays.
  diff(a, b, { simd = true, fast = false } = {}) {
    // copy the inputs first so the core can count their lines
    let where = this.#plan({ a: a.length, b: b.length });
    new Uint8Array(this.memory.buffer).set(a, where.a);
    new Uint8Array(this.memory.buffer).set(b, where.b);
    const na = this.x.count_lines(where.a, a.length);
    const nb = this.x.count_lines(where.b, b.length);
    const ids = na + nb;
    let slots = 16;
    while (slots < 2 * ids) slots *= 2;
    const records = Math.min(na, nb) + 1;
    where = this.#plan({
      a: a.length, b: b.length,
      a_start: 4 * na, a_lens: 4 * na, a_hash: 8 * na, a_id: 4 * na,
      b_start: 4 * nb, b_lens: 4 * nb, b_hash: 8 * nb, b_id: 4 * nb,
      slots: 8 * slots, id_hash: 8 * ids, id_ptr: 4 * ids, id_len: 4 * ids, count_a: 4 * ids, count_b: 4 * ids,
      work_a: 4 * na, work_b: 4 * nb, map_a: 4 * na, map_b: 4 * nb, changed_a: na, changed_b: nb,
      kv_f: 4 * (ids + 3), kv_b: 4 * (ids + 3),
      s_a_start: 4 * records, s_b_start: 4 * records, s_a_count: 4 * records, s_b_count: 4 * records,
    });
    const view = new DataView(this.memory.buffer);
    const set = (name, value) => view.setUint32(FIELD[name], value, true);
    set('a_ptr', where.a); set('a_len', a.length); set('b_ptr', where.b); set('b_len', b.length);
    set('flags', (simd ? CONST.FLAG_SIMD : 0) | (fast ? CONST.FLAG_FAST : 0));
    this.#setTable(view, 'a', where, na);
    this.#setTable(view, 'b', where, nb);
    for (const name of ['slots', 'id_hash', 'id_ptr', 'id_len', 'count_a', 'count_b', 'work_a', 'work_b', 'map_a', 'map_b',
      'changed_a', 'changed_b', 'kv_f', 'kv_b', 's_a_start', 's_b_start', 's_a_count', 's_b_count']) set(name, where[name]);
    set('slot_count', slots); set('id_capacity', ids); set('kv_capacity', ids + 3); set('s_capacity', records);
    const status = this.x.diff(0);
    if (status !== CONST.OK) throw new SeamsError('diff', status);
    const count = view.getUint32(FIELD.s_count, true);
    const column = (name) => new Uint32Array(this.memory.buffer, where[name], count).slice();
    this.last = { where, a, b, na, nb };
    return {
      aLines: na, bLines: nb, count,
      aStart: column('s_a_start'), bStart: column('s_b_start'), aCount: column('s_a_count'), bCount: column('s_b_count'),
    };
  }

  // Line starts and lengths of both files from the last diff call (every line, including trimmed ones).
  lineTables() {
    const { where, na, nb } = this.last;
    const copy = (name, n) => new Uint32Array(this.memory.buffer, where[name], n).slice();
    return { aStart: copy('a_start', na), aLen: copy('a_lens', na), bStart: copy('b_start', nb), bLen: copy('b_lens', nb) };
  }

  // Rebuilds b from a and a script, using the line tables of the last diff call.
  // A script from elsewhere (the native engine) may be passed to check it against these tables.
  apply(script) {
    const { where, a, b } = this.last;
    const n = script.count;
    const extra = this.#plan({
      a: a.length, b: b.length,
      a_start: 4 * this.last.na, a_lens: 4 * this.last.na, a_hash: 8 * this.last.na, a_id: 4 * this.last.na,
      b_start: 4 * this.last.nb, b_lens: 4 * this.last.nb, b_hash: 8 * this.last.nb, b_id: 4 * this.last.nb,
      slots: 0, id_hash: 0, id_ptr: 0, id_len: 0, count_a: 0, count_b: 0, work_a: 0, work_b: 0, map_a: 0, map_b: 0,
      changed_a: 0, changed_b: 0, kv_f: 0, kv_b: 0,
      s_a_start: 4 * n, s_b_start: 4 * n, s_a_count: 4 * n, s_b_count: 4 * n, out: b.length + 1,
    });
    // the tables are where the last diff left them; only the script and output move
    for (const k of ['a', 'b', 'a_start', 'b_start']) if (extra[k] !== where[k]) throw new Error('layout changed');
    const memory32 = (name) => new Uint32Array(this.memory.buffer, extra[name], n);
    memory32('s_a_start').set(script.aStart); memory32('s_b_start').set(script.bStart);
    memory32('s_a_count').set(script.aCount); memory32('s_b_count').set(script.bCount);
    const view = new DataView(this.memory.buffer);
    const set = (name, value) => view.setUint32(FIELD[name], value, true);
    for (const name of ['s_a_start', 's_b_start', 's_a_count', 's_b_count']) set(name, extra[name]);
    set('s_count', n); set('out_ptr', extra.out); set('out_capacity', b.length); set('out_len', 0);
    const status = this.x.apply(0);
    if (status !== CONST.OK) return { status };
    const len = view.getUint32(FIELD.out_len, true);
    return { status, bytes: new Uint8Array(this.memory.buffer, extra.out, len).slice() };
  }
}
