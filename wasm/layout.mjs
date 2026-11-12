// The one place the descriptor layout is defined. build.mjs substitutes #name in the .wat
// with these byte offsets; the JS host reads and writes the same offsets.
// Every field is a u32: a byte address in linear memory, a length or a count.

const fields = [
  // inputs
  'a_ptr', 'a_len', 'b_ptr', 'b_len', 'flags',
  // line table of a, then of b, in the same order (TABLE_FIELDS below)
  'a_start', 'a_lens', 'a_hash', 'a_id', 'a_count', 'a_capacity',
  'b_start', 'b_lens', 'b_hash', 'b_id', 'b_count', 'b_capacity',
  // intern table shared by both files
  'slots', 'id_hash', 'id_ptr', 'id_len', 'count_a', 'count_b',
  'slot_count', 'id_capacity', 'id_total', 'active_mask',
  // diff scratch
  'work_a', 'work_b', 'map_a', 'map_b', 'changed_a', 'changed_b', 'kv_f', 'kv_b', 'kv_capacity',
  // filled by diff for the matcher: kv arrays centred on diagonal 0, changed offset past the prefix
  'kv_f_centre', 'kv_b_centre', 'match_changed_a', 'match_changed_b',
  // edit script
  's_a_start', 's_b_start', 's_a_count', 's_b_count', 's_count', 's_capacity',
  // apply output
  'out_ptr', 'out_capacity', 'out_len',
  // with FLAG_FAST: rounds a middle-snake search may take before it splits at its furthest point
  'cost_limit',
];

export const FIELD = Object.fromEntries(fields.map((name, i) => [name, i * 4]));
export const DESCRIPTOR_BYTES = fields.length * 4;

// offsets inside one line table block, relative to #a_start or #b_start
export const TABLE = { t_start: 0, t_lens: 4, t_hash: 8, t_id: 12, t_count: 16, t_capacity: 20 };

export const CONST = {
  OK: 0, EINVAL: -1, E2BIG: -2, ENOSPC: -3, EBADSCRIPT: -4,
  FLAG_SIMD: 1,
  FLAG_FAST: 2,
  MIN_COST_LIMIT: 4096,
  HEUR_MIN_COST: 256,
  SNAKE_COUNT: 20,
  SNAKE_COUNT_LESS_ONE: 19,
  K_HEUR: 4,
  FIRST_ACTIVE_SLOTS: 16,
  KV_UNREACHED_LOW: -1,
  KV_UNREACHED_HIGH: 0x7fffffff,
};

export const ALIGN = 16;
