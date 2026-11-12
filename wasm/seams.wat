;; seams diff core in hand-written WebAssembly text, a port of the NASM engine in src/.
;; Same pipeline and the same choices at every step, so both produce identical edit scripts.
;; #name is a byte offset from wasm/layout.mjs and @NAME a constant; build.mjs fills them in.
;; Every routine takes the descriptor $d, which the caller allocates; no global state.
(module
  (memory (export "memory") 1)

  ;; ---------------------------------------------------------------- scan

  ;; appends line [start, end) to table $t, or returns -1 when the table is full
  (func $add_line (param $t i32) (param $count i32) (param $start i32) (param $end i32) (result i32)
    (if (i32.ge_u (local.get $count) (i32.load offset=#t_capacity (local.get $t)))
      (then (return (i32.const -1))))
    (i32.store (i32.add (i32.load offset=#t_start (local.get $t)) (i32.shl (local.get $count) (i32.const 2)))
      (local.get $start))
    (i32.store (i32.add (i32.load offset=#t_lens (local.get $t)) (i32.shl (local.get $count) (i32.const 2)))
      (i32.sub (local.get $end) (local.get $start)))
    (i32.add (local.get $count) (i32.const 1)))

  ;; the last line may have no LF; it is still a line
  (func $finish_scan (param $t i32) (param $count i32) (param $start i32) (param $length i32) (result i32)
    (if (i32.lt_u (local.get $start) (local.get $length))
      (then (local.set $count (call $add_line (local.get $t) (local.get $count) (local.get $start) (local.get $length)))))
    (if (i32.lt_s (local.get $count) (i32.const 0))
      (then
        (i32.store offset=#t_count (local.get $t) (i32.const 0))
        (return (i32.const @ENOSPC))))
    (i32.store offset=#t_count (local.get $t) (local.get $count))
    (i32.const @OK))

  (func $scan_scalar (param $bytes i32) (param $length i32) (param $t i32) (result i32)
    (local $cursor i32) (local $start i32) (local $count i32)
    (block $all_bytes_seen
      (loop $next_byte
        (br_if $all_bytes_seen (i32.ge_u (local.get $cursor) (local.get $length)))
        (if (i32.eq (i32.load8_u (i32.add (local.get $bytes) (local.get $cursor))) (i32.const 10))
          (then
            (local.set $count (call $add_line (local.get $t) (local.get $count) (local.get $start)
              (i32.add (local.get $cursor) (i32.const 1))))
            (br_if $all_bytes_seen (i32.lt_s (local.get $count) (i32.const 0)))
            (local.set $start (i32.add (local.get $cursor) (i32.const 1)))))
        (local.set $cursor (i32.add (local.get $cursor) (i32.const 1)))
        (br $next_byte)))
    (if (i32.lt_s (local.get $count) (i32.const 0))
      (then (return (call $finish_scan (local.get $t) (i32.const -1) (i32.const 0) (i32.const 0)))))
    (call $finish_scan (local.get $t) (local.get $count) (local.get $start) (local.get $length)))

  ;; 16 bytes per step: compare against LF, take the bit mask, walk its set bits
  (func $scan_simd (param $bytes i32) (param $length i32) (param $t i32) (result i32)
    (local $cursor i32) (local $start i32) (local $count i32) (local $mask i32) (local $newline i32)
    (block $vectors_done
      (loop $next_vector
        (br_if $vectors_done (i32.gt_u (i32.add (local.get $cursor) (i32.const 16)) (local.get $length)))
        (local.set $mask (i8x16.bitmask (i8x16.eq
          (v128.load (i32.add (local.get $bytes) (local.get $cursor))) (i8x16.splat (i32.const 10)))))
        (block $mask_empty
          (loop $next_newline
            (br_if $mask_empty (i32.eqz (local.get $mask)))
            (local.set $newline (i32.add (local.get $cursor) (i32.ctz (local.get $mask))))
            (local.set $count (call $add_line (local.get $t) (local.get $count) (local.get $start)
              (i32.add (local.get $newline) (i32.const 1))))
            (br_if $vectors_done (i32.lt_s (local.get $count) (i32.const 0)))
            (local.set $start (i32.add (local.get $newline) (i32.const 1)))
            (local.set $mask (i32.and (local.get $mask) (i32.sub (local.get $mask) (i32.const 1))))
            (br $next_newline)))
        (local.set $cursor (i32.add (local.get $cursor) (i32.const 16)))
        (br $next_vector)))
    (if (i32.lt_s (local.get $count) (i32.const 0))
      (then (return (call $finish_scan (local.get $t) (i32.const -1) (i32.const 0) (i32.const 0)))))
    (block $tail_seen
      (loop $next_tail_byte
        (br_if $tail_seen (i32.ge_u (local.get $cursor) (local.get $length)))
        (if (i32.eq (i32.load8_u (i32.add (local.get $bytes) (local.get $cursor))) (i32.const 10))
          (then
            (local.set $count (call $add_line (local.get $t) (local.get $count) (local.get $start)
              (i32.add (local.get $cursor) (i32.const 1))))
            (br_if $tail_seen (i32.lt_s (local.get $count) (i32.const 0)))
            (local.set $start (i32.add (local.get $cursor) (i32.const 1)))))
        (local.set $cursor (i32.add (local.get $cursor) (i32.const 1)))
        (br $next_tail_byte)))
    (if (i32.lt_s (local.get $count) (i32.const 0))
      (then (return (call $finish_scan (local.get $t) (i32.const -1) (i32.const 0) (i32.const 0)))))
    (call $finish_scan (local.get $t) (local.get $count) (local.get $start) (local.get $length)))

  (func (export "scan_scalar") (param $bytes i32) (param $length i32) (param $t i32) (result i32)
    (call $scan_scalar (local.get $bytes) (local.get $length) (local.get $t)))
  (func (export "scan_simd") (param $bytes i32) (param $length i32) (param $t i32) (result i32)
    (call $scan_simd (local.get $bytes) (local.get $length) (local.get $t)))

  ;; exact number of lines scanning will produce, so callers can allocate once
  (func (export "count_lines") (param $bytes i32) (param $length i32) (result i32)
    (local $cursor i32) (local $count i32)
    (if (i32.eqz (local.get $length)) (then (return (i32.const 0))))
    (block $counted
      (loop $next_vector
        (br_if $counted (i32.gt_u (i32.add (local.get $cursor) (i32.const 16)) (local.get $length)))
        (local.set $count (i32.add (local.get $count) (i32.popcnt (i8x16.bitmask (i8x16.eq
          (v128.load (i32.add (local.get $bytes) (local.get $cursor))) (i8x16.splat (i32.const 10)))))))
        (local.set $cursor (i32.add (local.get $cursor) (i32.const 16)))
        (br $next_vector)))
    (block $tail_counted
      (loop $next_byte
        (br_if $tail_counted (i32.ge_u (local.get $cursor) (local.get $length)))
        (if (i32.eq (i32.load8_u (i32.add (local.get $bytes) (local.get $cursor))) (i32.const 10))
          (then (local.set $count (i32.add (local.get $count) (i32.const 1)))))
        (local.set $cursor (i32.add (local.get $cursor) (i32.const 1)))
        (br $next_byte)))
    (if (i32.ne (i32.load8_u (i32.sub (i32.add (local.get $bytes) (local.get $length)) (i32.const 1))) (i32.const 10))
      (then (local.set $count (i32.add (local.get $count) (i32.const 1)))))
    (local.get $count))

  ;; ---------------------------------------------------------------- hash

  ;; same value as the native hash; loads stay below buffer_end
  (func $hash_line (param $cursor i32) (param $remaining i32) (param $buffer_end i32) (result i64)
    (local $hash i64) (local $word i64) (local $shift i64) (local $line_length i32) (local $k i32)
    ;;IF BAD_HASH
    ;; test build: almost every line collides, so intern must compare bytes
    (return (i64.extend_i32_u (i32.and (local.get $remaining) (i32.const 1))))
    ;;END
    (local.set $hash (i64.extend_i32_u (local.get $remaining)))
    (local.set $line_length (local.get $remaining))
    (block $words_hashed
      (loop $next_word
        (br_if $words_hashed (i32.lt_u (local.get $remaining) (i32.const 8)))
        (local.set $hash (i64.rotl
          (i64.mul (i64.xor (local.get $hash) (i64.load (local.get $cursor))) (i64.const @HASH_MULTIPLIER))
          (i64.const 31)))
        (local.set $cursor (i32.add (local.get $cursor) (i32.const 8)))
        (local.set $remaining (i32.sub (local.get $remaining) (i32.const 8)))
        (br $next_word)))
    (if (local.get $remaining)
      (then
        (local.set $shift (i64.extend_i32_u (i32.sub (i32.const 64) (i32.shl (local.get $remaining) (i32.const 3)))))
        (if (i32.ge_u (local.get $line_length) (i32.const 8))
          (then
            ;; the last eight bytes of the line; drop the ones already hashed
            (local.set $word (i64.shr_u
              (i64.load (i32.sub (i32.add (local.get $cursor) (local.get $remaining)) (i32.const 8)))
              (local.get $shift))))
          (else
            (if (i32.le_u (i32.add (local.get $cursor) (i32.const 8)) (local.get $buffer_end))
              (then
                (local.set $word (i64.shr_u (i64.shl (i64.load (local.get $cursor)) (local.get $shift))
                  (local.get $shift))))
              (else
                (loop $next_tail_byte
                  (local.set $word (i64.or (local.get $word)
                    (i64.shl (i64.load8_u (i32.add (local.get $cursor) (local.get $k)))
                      (i64.extend_i32_u (i32.shl (local.get $k) (i32.const 3))))))
                  (local.set $k (i32.add (local.get $k) (i32.const 1)))
                  (br_if $next_tail_byte (i32.lt_u (local.get $k) (local.get $remaining))))))))))
    (local.set $hash (i64.mul (i64.xor (local.get $hash) (local.get $word)) (i64.const @HASH_MULTIPLIER)))
    (i64.xor (local.get $hash) (i64.shr_u (local.get $hash) (i64.const 32))))

  (func (export "hash_line") (param $bytes i32) (param $length i32) (result i64)
    (call $hash_line (local.get $bytes) (local.get $length) (i32.add (local.get $bytes) (local.get $length))))

  ;; hashes lines first .. end-1; every line of the table must be scanned
  (func $hash_range (param $bytes i32) (param $t i32) (param $first i32) (param $end i32)
    (local $starts i32) (local $lengths i32) (local $hashes i32) (local $buffer_end i32) (local $last i32)
    (if (i32.ge_u (local.get $first) (local.get $end)) (then (return)))
    (local.set $starts (i32.load offset=#t_start (local.get $t)))
    (local.set $lengths (i32.load offset=#t_lens (local.get $t)))
    (local.set $hashes (i32.load offset=#t_hash (local.get $t)))
    ;; the last line ends where the buffer ends, so loads below that point are safe
    (local.set $last (i32.shl (i32.sub (i32.load offset=#t_count (local.get $t)) (i32.const 1)) (i32.const 2)))
    (local.set $buffer_end (i32.add (local.get $bytes) (i32.add
      (i32.load (i32.add (local.get $starts) (local.get $last)))
      (i32.load (i32.add (local.get $lengths) (local.get $last))))))
    (loop $next_line
      (i64.store (i32.add (local.get $hashes) (i32.shl (local.get $first) (i32.const 3)))
        (call $hash_line
          (i32.add (local.get $bytes) (i32.load (i32.add (local.get $starts) (i32.shl (local.get $first) (i32.const 2)))))
          (i32.load (i32.add (local.get $lengths) (i32.shl (local.get $first) (i32.const 2))))
          (local.get $buffer_end)))
      (local.set $first (i32.add (local.get $first) (i32.const 1)))
      (br_if $next_line (i32.lt_u (local.get $first) (local.get $end)))))

  ;; ---------------------------------------------------------------- intern

  ;; 8 bytes at a time; lines of 8+ bytes finish with one overlapping load
  (func $bytes_equal (param $p i32) (param $q i32) (param $length i32) (result i32)
    (local $i i32)
    (if (i32.ge_u (local.get $length) (i32.const 8))
      (then
        (block $words_compared
          (loop $next_word
            (br_if $words_compared (i32.gt_u (i32.add (local.get $i) (i32.const 8)) (local.get $length)))
            (if (i64.ne (i64.load (i32.add (local.get $p) (local.get $i))) (i64.load (i32.add (local.get $q) (local.get $i))))
              (then (return (i32.const 0))))
            (local.set $i (i32.add (local.get $i) (i32.const 8)))
            (br $next_word)))
        (return (i64.eq
          (i64.load (i32.sub (i32.add (local.get $p) (local.get $length)) (i32.const 8)))
          (i64.load (i32.sub (i32.add (local.get $q) (local.get $length)) (i32.const 8)))))))
    (block $bytes_compared
      (loop $next_byte
        (br_if $bytes_compared (i32.ge_u (local.get $i) (local.get $length)))
        (if (i32.ne (i32.load8_u (i32.add (local.get $p) (local.get $i))) (i32.load8_u (i32.add (local.get $q) (local.get $i))))
          (then (return (i32.const 0))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next_byte)))
    (i32.const 1))

  ;; slot_count is a power of two, at least 2 * id_capacity; only a small prefix is used at first
  (func $intern_reset (param $d i32) (result i32)
    (local $slot_count i32) (local $active i32)
    (local.set $slot_count (i32.load offset=#slot_count (local.get $d)))
    (if (i32.or (i32.eqz (local.get $slot_count))
          (i32.and (local.get $slot_count) (i32.sub (local.get $slot_count) (i32.const 1))))
      (then (return (i32.const @EINVAL))))
    (if (i32.gt_u (i32.load offset=#id_capacity (local.get $d)) (i32.shr_u (local.get $slot_count) (i32.const 1)))
      (then (return (i32.const @EINVAL))))
    (local.set $active (select (local.get $slot_count) (i32.const @FIRST_ACTIVE_SLOTS)
      (i32.lt_u (local.get $slot_count) (i32.const @FIRST_ACTIVE_SLOTS))))
    (i32.store offset=#active_mask (local.get $d) (i32.sub (local.get $active) (i32.const 1)))
    (i32.store offset=#id_total (local.get $d) (i32.const 0))
    (memory.fill (i32.load offset=#slots (local.get $d)) (i32.const 255) (i32.shl (local.get $active) (i32.const 3)))
    (i32.const @OK))

  (func $store_in_free_slot (param $d i32) (param $hash i64) (param $id i32)
    (local $slots i32) (local $mask i32) (local $slot i32)
    (local.set $slots (i32.load offset=#slots (local.get $d)))
    (local.set $mask (i32.load offset=#active_mask (local.get $d)))
    (local.set $slot (i32.and (i32.wrap_i64 (local.get $hash)) (local.get $mask)))
    (block $free_slot_found
      (loop $next_slot
        (br_if $free_slot_found (i64.eq (i64.load (i32.add (local.get $slots) (i32.shl (local.get $slot) (i32.const 3))))
          (i64.const -1)))
        (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
        (br $next_slot)))
    (i64.store (i32.add (local.get $slots) (i32.shl (local.get $slot) (i32.const 3)))
      (i64.or (i64.and (local.get $hash) (i64.const 0xffffffff00000000)) (i64.extend_i32_u (local.get $id)))))

  ;; double the active slots and put every id back, using the stored hashes
  (func $intern_grow (param $d i32)
    (local $active i32) (local $id i32) (local $id_hash i32)
    (local.set $active (i32.shl (i32.add (i32.load offset=#active_mask (local.get $d)) (i32.const 1)) (i32.const 1)))
    (if (i32.gt_u (local.get $active) (i32.load offset=#slot_count (local.get $d))) (then (return)))
    (i32.store offset=#active_mask (local.get $d) (i32.sub (local.get $active) (i32.const 1)))
    (memory.fill (i32.load offset=#slots (local.get $d)) (i32.const 255) (i32.shl (local.get $active) (i32.const 3)))
    (local.set $id_hash (i32.load offset=#id_hash (local.get $d)))
    (block $all_ids_placed
      (loop $next_id
        (br_if $all_ids_placed (i32.ge_u (local.get $id) (i32.load offset=#id_total (local.get $d))))
        (call $store_in_free_slot (local.get $d)
          (i64.load (i32.add (local.get $id_hash) (i32.shl (local.get $id) (i32.const 3)))) (local.get $id))
        (local.set $id (i32.add (local.get $id) (i32.const 1)))
        (br $next_id))))

  ;; id of this line's bytes, adding it on first sight; -1 when out of ids
  (func $find_or_add (param $d i32) (param $line i32) (param $length i32) (param $hash i64) (result i32)
    (local $slots i32) (local $mask i32) (local $slot i32) (local $entry i64) (local $id i32)
    (local.set $slots (i32.load offset=#slots (local.get $d)))
    (local.set $mask (i32.load offset=#active_mask (local.get $d)))
    (local.set $slot (i32.and (i32.wrap_i64 (local.get $hash)) (local.get $mask)))
    (block $empty_slot_found
      (loop $probe_slot
        (local.set $entry (i64.load (i32.add (local.get $slots) (i32.shl (local.get $slot) (i32.const 3)))))
        (br_if $empty_slot_found (i64.eq (local.get $entry) (i64.const -1)))
        ;; equal tags are not trusted: compare the bytes
        (if (i64.eqz (i64.shr_u (i64.xor (local.get $entry) (local.get $hash)) (i64.const 32)))
          (then
            (local.set $id (i32.wrap_i64 (local.get $entry)))
            (if (i32.eq (i32.load (i32.add (i32.load offset=#id_len (local.get $d)) (i32.shl (local.get $id) (i32.const 2))))
                        (local.get $length))
              (then
                (if (call $bytes_equal (local.get $line)
                      (i32.load (i32.add (i32.load offset=#id_ptr (local.get $d)) (i32.shl (local.get $id) (i32.const 2))))
                      (local.get $length))
                  (then (return (local.get $id))))))))
        (local.set $slot (i32.and (i32.add (local.get $slot) (i32.const 1)) (local.get $mask)))
        (br $probe_slot)))
    (local.set $id (i32.load offset=#id_total (local.get $d)))
    (if (i32.ge_u (local.get $id) (i32.load offset=#id_capacity (local.get $d)))
      (then (return (i32.const -1))))
    (i64.store (i32.add (local.get $slots) (i32.shl (local.get $slot) (i32.const 3)))
      (i64.or (i64.and (local.get $hash) (i64.const 0xffffffff00000000)) (i64.extend_i32_u (local.get $id))))
    (i64.store (i32.add (i32.load offset=#id_hash (local.get $d)) (i32.shl (local.get $id) (i32.const 3))) (local.get $hash))
    (i32.store (i32.add (i32.load offset=#id_ptr (local.get $d)) (i32.shl (local.get $id) (i32.const 2))) (local.get $line))
    (i32.store (i32.add (i32.load offset=#id_len (local.get $d)) (i32.shl (local.get $id) (i32.const 2))) (local.get $length))
    (i32.store (i32.add (i32.load offset=#count_a (local.get $d)) (i32.shl (local.get $id) (i32.const 2))) (i32.const 0))
    (i32.store (i32.add (i32.load offset=#count_b (local.get $d)) (i32.shl (local.get $id) (i32.const 2))) (i32.const 0))
    (i32.store offset=#id_total (local.get $d) (i32.add (local.get $id) (i32.const 1)))
    ;; keep the active slots at most half full, so probing ends
    (if (i32.gt_u (i32.shl (i32.add (local.get $id) (i32.const 1)) (i32.const 1)) (local.get $mask))
      (then (call $intern_grow (local.get $d))))
    (local.get $id))

  ;; interns lines first .. end-1 and counts them for this side
  (func $intern_range (param $d i32) (param $bytes i32) (param $t i32) (param $counts i32) (param $first i32) (param $end i32) (result i32)
    (local $id i32) (local $at i32)
    (block $all_lines_interned
      (loop $next_line
        (br_if $all_lines_interned (i32.ge_u (local.get $first) (local.get $end)))
        (local.set $at (i32.shl (local.get $first) (i32.const 2)))
        (local.set $id (call $find_or_add (local.get $d)
          (i32.add (local.get $bytes) (i32.load (i32.add (i32.load offset=#t_start (local.get $t)) (local.get $at))))
          (i32.load (i32.add (i32.load offset=#t_lens (local.get $t)) (local.get $at)))
          (i64.load (i32.add (i32.load offset=#t_hash (local.get $t)) (i32.shl (local.get $first) (i32.const 3))))))
        (if (i32.lt_s (local.get $id) (i32.const 0)) (then (return (i32.const @ENOSPC))))
        (i32.store (i32.add (i32.load offset=#t_id (local.get $t)) (local.get $at)) (local.get $id))
        (local.set $at (i32.add (local.get $counts) (i32.shl (local.get $id) (i32.const 2))))
        (i32.store (local.get $at) (i32.add (i32.load (local.get $at)) (i32.const 1)))
        (local.set $first (i32.add (local.get $first) (i32.const 1)))
        (br $next_line)))
    (i32.const @OK))

  ;; ---------------------------------------------------------------- trim

  ;; count of equal leading bytes, at most limit
  (func $equal_prefix_bytes (param $a i32) (param $b i32) (param $limit i32) (param $simd i32) (result i32)
    (local $matched i32) (local $word i64) (local $mask i32)
    (if (local.get $simd)
      (then
        (block $vectors_done
          (loop $next_vector
            (br_if $vectors_done (i32.gt_u (i32.add (local.get $matched) (i32.const 16)) (local.get $limit)))
            (local.set $mask (i32.xor (i32.const 0xffff) (i8x16.bitmask (i8x16.eq
              (v128.load (i32.add (local.get $a) (local.get $matched)))
              (v128.load (i32.add (local.get $b) (local.get $matched)))))))
            (if (local.get $mask) (then (return (i32.add (local.get $matched) (i32.ctz (local.get $mask))))))
            (local.set $matched (i32.add (local.get $matched) (i32.const 16)))
            (br $next_vector)))))
    (block $words_done
      (loop $next_word
        (br_if $words_done (i32.gt_u (i32.add (local.get $matched) (i32.const 8)) (local.get $limit)))
        (local.set $word (i64.xor (i64.load (i32.add (local.get $a) (local.get $matched)))
                                  (i64.load (i32.add (local.get $b) (local.get $matched)))))
        ;; lowest differing bit; the bytes below it are equal
        (if (i64.ne (local.get $word) (i64.const 0))
          (then (return (i32.add (local.get $matched) (i32.wrap_i64 (i64.shr_u (i64.ctz (local.get $word)) (i64.const 3)))))))
        (local.set $matched (i32.add (local.get $matched) (i32.const 8)))
        (br $next_word)))
    (block $bytes_done
      (loop $next_byte
        (br_if $bytes_done (i32.ge_u (local.get $matched) (local.get $limit)))
        (br_if $bytes_done (i32.ne (i32.load8_u (i32.add (local.get $a) (local.get $matched)))
                                   (i32.load8_u (i32.add (local.get $b) (local.get $matched)))))
        (local.set $matched (i32.add (local.get $matched) (i32.const 1)))
        (br $next_byte)))
    (local.get $matched))

  ;; count of equal trailing bytes before a_end and b_end, at most limit
  (func $equal_suffix_bytes (param $a_end i32) (param $b_end i32) (param $limit i32) (param $simd i32) (result i32)
    (local $matched i32) (local $word i64) (local $mask i32)
    (if (local.get $simd)
      (then
        (block $vectors_done
          (loop $next_vector
            (br_if $vectors_done (i32.gt_u (i32.add (local.get $matched) (i32.const 16)) (local.get $limit)))
            (local.set $mask (i32.xor (i32.const 0xffff) (i8x16.bitmask (i8x16.eq
              (v128.load (i32.sub (i32.sub (local.get $a_end) (local.get $matched)) (i32.const 16)))
              (v128.load (i32.sub (i32.sub (local.get $b_end) (local.get $matched)) (i32.const 16)))))))
            ;; highest differing lane; the lanes above it are equal
            (if (local.get $mask)
              (then (return (i32.add (local.get $matched) (i32.sub (i32.clz (local.get $mask)) (i32.const 16))))))
            (local.set $matched (i32.add (local.get $matched) (i32.const 16)))
            (br $next_vector)))))
    (block $words_done
      (loop $next_word
        (br_if $words_done (i32.gt_u (i32.add (local.get $matched) (i32.const 8)) (local.get $limit)))
        (local.set $word (i64.xor
          (i64.load (i32.sub (i32.sub (local.get $a_end) (local.get $matched)) (i32.const 8)))
          (i64.load (i32.sub (i32.sub (local.get $b_end) (local.get $matched)) (i32.const 8)))))
        (if (i64.ne (local.get $word) (i64.const 0))
          (then (return (i32.add (local.get $matched) (i32.wrap_i64 (i64.shr_u (i64.clz (local.get $word)) (i64.const 3)))))))
        (local.set $matched (i32.add (local.get $matched) (i32.const 8)))
        (br $next_word)))
    (block $bytes_done
      (loop $next_byte
        (br_if $bytes_done (i32.ge_u (local.get $matched) (local.get $limit)))
        (br_if $bytes_done (i32.ne
          (i32.load8_u (i32.sub (i32.sub (local.get $a_end) (local.get $matched)) (i32.const 1)))
          (i32.load8_u (i32.sub (i32.sub (local.get $b_end) (local.get $matched)) (i32.const 1)))))
        (local.set $matched (i32.add (local.get $matched) (i32.const 1)))
        (br $next_byte)))
    (local.get $matched))

  ;; Lines in the longest common byte prefix and suffix of the two scanned files. They pair up one
  ;; to one in a minimal script, so only the lines between them are hashed, interned and matched.
  ;; Returns prefix lines, suffix lines (same counts in both files); the two never overlap.
  (func $trim_ends (param $d i32) (result i32 i32)
    (local $a i32) (local $b i32) (local $a_len i32) (local $b_len i32) (local $starts i32) (local $lengths i32)
    (local $line_count i32) (local $limit i32) (local $matched i32) (local $low i32) (local $high i32)
    (local $middle i32) (local $prefix_lines i32) (local $prefix_bytes i32) (local $tail i32) (local $simd i32)
    (local.set $a (i32.load offset=#a_ptr (local.get $d)))
    (local.set $b (i32.load offset=#b_ptr (local.get $d)))
    (local.set $a_len (i32.load offset=#a_len (local.get $d)))
    (local.set $b_len (i32.load offset=#b_len (local.get $d)))
    (local.set $starts (i32.load offset=#a_start (local.get $d)))
    (local.set $lengths (i32.load offset=#a_lens (local.get $d)))
    (local.set $line_count (i32.load offset=#a_count (local.get $d)))
    (local.set $simd (i32.and (i32.load offset=#flags (local.get $d)) (i32.const @FLAG_SIMD)))
    (local.set $limit (select (local.get $a_len) (local.get $b_len) (i32.lt_u (local.get $a_len) (local.get $b_len))))
    (local.set $matched (call $equal_prefix_bytes (local.get $a) (local.get $b) (local.get $limit) (local.get $simd)))
    ;; lines that end at or before the first differing byte
    (local.set $high (local.get $line_count))
    (block $prefix_searched
      (loop $prefix_search
        (br_if $prefix_searched (i32.ge_u (local.get $low) (local.get $high)))
        (local.set $middle (i32.shr_u (i32.add (local.get $low) (local.get $high)) (i32.const 1)))
        (if (i32.gt_u (i32.add (i32.load (i32.add (local.get $starts) (i32.shl (local.get $middle) (i32.const 2))))
                               (i32.load (i32.add (local.get $lengths) (i32.shl (local.get $middle) (i32.const 2)))))
                      (local.get $matched))
          (then (local.set $high (local.get $middle)))
          (else (local.set $low (i32.add (local.get $middle) (i32.const 1)))))
        (br $prefix_search)))
    ;; a last line without LF matches only if the other file also ends there
    (if (i32.and (i32.and (i32.eq (local.get $low) (local.get $line_count)) (i32.ne (local.get $low) (i32.const 0)))
                 (i32.ne (local.get $a_len) (local.get $b_len)))
      (then
        (if (i32.ne (i32.load8_u (i32.sub (i32.add (local.get $a) (local.get $a_len)) (i32.const 1))) (i32.const 10))
          (then (local.set $low (i32.sub (local.get $low) (i32.const 1)))))))
    (local.set $prefix_lines (local.get $low))
    ;; the suffix may not reach back into the prefix lines
    (if (local.get $low)
      (then (local.set $prefix_bytes (i32.add
        (i32.load (i32.sub (i32.add (local.get $starts) (i32.shl (local.get $low) (i32.const 2))) (i32.const 4)))
        (i32.load (i32.sub (i32.add (local.get $lengths) (i32.shl (local.get $low) (i32.const 2))) (i32.const 4)))))))
    (local.set $matched (call $equal_suffix_bytes
      (i32.add (local.get $a) (local.get $a_len)) (i32.add (local.get $b) (local.get $b_len))
      (i32.sub (local.get $limit) (local.get $prefix_bytes)) (local.get $simd)))
    ;; first line of a that starts inside the equal tail
    (local.set $tail (i32.sub (local.get $a_len) (local.get $matched)))
    (local.set $low (local.get $prefix_lines))
    (local.set $high (local.get $line_count))
    (block $suffix_searched
      (loop $suffix_search
        (br_if $suffix_searched (i32.ge_u (local.get $low) (local.get $high)))
        (local.set $middle (i32.shr_u (i32.add (local.get $low) (local.get $high)) (i32.const 1)))
        (if (i32.ge_u (i32.load (i32.add (local.get $starts) (i32.shl (local.get $middle) (i32.const 2)))) (local.get $tail))
          (then (local.set $high (local.get $middle)))
          (else (local.set $low (i32.add (local.get $middle) (i32.const 1)))))
        (br $suffix_search)))
    ;; a line starting exactly where the tail starts must also start a line in b
    (if (i32.lt_u (local.get $low) (local.get $line_count))
      (then
        (if (i32.and (i32.eq (i32.load (i32.add (local.get $starts) (i32.shl (local.get $low) (i32.const 2)))) (local.get $tail))
                     (i32.ne (local.get $matched) (local.get $b_len)))
          (then
            (if (i32.ne (i32.load8_u (i32.sub (i32.sub (i32.add (local.get $b) (local.get $b_len)) (local.get $matched)) (i32.const 1)))
                        (i32.const 10))
              (then (local.set $low (i32.add (local.get $low) (i32.const 1)))))))))
    (local.get $prefix_lines)
    (i32.sub (local.get $line_count) (local.get $low)))

  ;; ---------------------------------------------------------------- match

  ;; lines whose id never occurs in the other file cannot be in any common subsequence.
  ;; ids and changed point at the first line to sort; map gets indexes relative to it.
  (func $discard (param $ids i32) (param $other_counts i32) (param $work i32) (param $map i32) (param $changed i32)
                 (param $line_count i32) (result i32)
    (local $line i32) (local $id i32) (local $kept i32)
    (block $all_lines_sorted
      (loop $next_line
        (br_if $all_lines_sorted (i32.ge_u (local.get $line) (local.get $line_count)))
        (local.set $id (i32.load (i32.add (local.get $ids) (i32.shl (local.get $line) (i32.const 2)))))
        (if (i32.eqz (i32.load (i32.add (local.get $other_counts) (i32.shl (local.get $id) (i32.const 2)))))
          (then (i32.store8 (i32.add (local.get $changed) (local.get $line)) (i32.const 1)))
          (else
            (i32.store8 (i32.add (local.get $changed) (local.get $line)) (i32.const 0))
            (i32.store (i32.add (local.get $work) (i32.shl (local.get $kept) (i32.const 2))) (local.get $id))
            (i32.store (i32.add (local.get $map) (i32.shl (local.get $kept) (i32.const 2))) (local.get $line))
            (local.set $kept (i32.add (local.get $kept) (i32.const 1)))))
        (local.set $line (i32.add (local.get $line) (i32.const 1)))
        (br $next_line)))
    (local.get $kept))

  (func $mark_changed (param $map i32) (param $changed i32) (param $position i32) (param $limit i32)
    (block $all_marked
      (loop $next_position
        (br_if $all_marked (i32.ge_s (local.get $position) (local.get $limit)))
        (i32.store8 (i32.add (local.get $changed) (i32.load (i32.add (local.get $map) (i32.shl (local.get $position) (i32.const 2)))))
          (i32.const 1))
        (local.set $position (i32.add (local.get $position) (i32.const 1)))
        (br $next_position))))

  (func $common_prefix (param $ids_a i32) (param $ids_b i32) (param $limit i32) (result i32)
    (local $matched i32)
    (block $prefix_found
      (loop $compare_next
        (br_if $prefix_found (i32.ge_u (local.get $matched) (local.get $limit)))
        (br_if $prefix_found (i32.ne (i32.load (i32.add (local.get $ids_a) (i32.shl (local.get $matched) (i32.const 2))))
                                     (i32.load (i32.add (local.get $ids_b) (i32.shl (local.get $matched) (i32.const 2))))))
        (local.set $matched (i32.add (local.get $matched) (i32.const 1)))
        (br $compare_next)))
    (local.get $matched))

  ;; ids_a_end and ids_b_end point one past the last id of each run
  (func $common_suffix (param $ids_a_end i32) (param $ids_b_end i32) (param $limit i32) (result i32)
    (local $matched i32)
    (block $suffix_found
      (loop $compare_previous
        (br_if $suffix_found (i32.ge_u (local.get $matched) (local.get $limit)))
        (local.set $ids_a_end (i32.sub (local.get $ids_a_end) (i32.const 4)))
        (local.set $ids_b_end (i32.sub (local.get $ids_b_end) (i32.const 4)))
        (br_if $suffix_found (i32.ne (i32.load (local.get $ids_a_end)) (i32.load (local.get $ids_b_end))))
        (local.set $matched (i32.add (local.get $matched) (i32.const 1)))
        (br $compare_previous)))
    (local.get $matched))

  ;; kv value at diagonal; kv points at diagonal 0 and diagonals may be negative
  (func $kv (param $kv i32) (param $diagonal i32) (result i32)
    (i32.load (i32.add (local.get $kv) (i32.shl (local.get $diagonal) (i32.const 2)))))
  (func $set_kv (param $kv i32) (param $diagonal i32) (param $x i32)
    (i32.store (i32.add (local.get $kv) (i32.shl (local.get $diagonal) (i32.const 2))) (local.get $x)))

  ;; Middle snake of the box: forward and backward searches by increasing cost until they meet.
  ;; Returns the point where they meet; the same rounds, in the same order, as src/myers.asm.
  (func $split (param $d i32) (param $off1 i32) (param $lim1 i32) (param $off2 i32) (param $lim2 i32) (result i32 i32)
    (local $ids_a i32) (local $ids_b i32) (local $kv_f i32) (local $kv_b i32)
    (local $dmin i32) (local $dmax i32) (local $fmin i32) (local $fmax i32) (local $bmin i32) (local $bmax i32)
    (local $odd i32) (local $diagonal i32) (local $x i32) (local $y i32) (local $limit i32)
    (local $cost i32) (local $best i32) (local $best_x i32) (local $best_y i32)
    (local $snake i32) (local $start i32) (local $centre i32) (local $score i32) (local $step i32) (local $threshold i32)
    (local.set $ids_a (i32.load offset=#work_a (local.get $d)))
    (local.set $ids_b (i32.load offset=#work_b (local.get $d)))
    (local.set $kv_f (i32.load offset=#kv_f_centre (local.get $d)))
    (local.set $kv_b (i32.load offset=#kv_b_centre (local.get $d)))
    (local.set $dmin (i32.sub (local.get $off1) (local.get $lim2)))
    (local.set $dmax (i32.sub (local.get $lim1) (local.get $off2)))
    (local.set $fmin (i32.sub (local.get $off1) (local.get $off2)))
    (local.set $fmax (local.get $fmin))
    (call $set_kv (local.get $kv_f) (local.get $fmin) (local.get $off1))
    (local.set $bmin (i32.sub (local.get $lim1) (local.get $lim2)))
    (local.set $bmax (local.get $bmin))
    (call $set_kv (local.get $kv_b) (local.get $bmin) (local.get $lim1))
    ;; the search meets after a forward step when the two diagonal centres differ by an odd count
    (local.set $odd (i32.and (i32.sub (local.get $fmin) (local.get $bmin)) (i32.const 1)))
    (loop $next_cost
      (local.set $snake (i32.const 0))
      ;; forward round: widen the band of diagonals by one each side, or narrow it where the box ends
      (if (i32.gt_s (local.get $fmin) (local.get $dmin))
        (then
          (local.set $fmin (i32.sub (local.get $fmin) (i32.const 1)))
          (call $set_kv (local.get $kv_f) (i32.sub (local.get $fmin) (i32.const 1)) (i32.const @KV_UNREACHED_LOW)))
        (else (local.set $fmin (i32.add (local.get $fmin) (i32.const 1)))))
      (if (i32.lt_s (local.get $fmax) (local.get $dmax))
        (then
          (local.set $fmax (i32.add (local.get $fmax) (i32.const 1)))
          (call $set_kv (local.get $kv_f) (i32.add (local.get $fmax) (i32.const 1)) (i32.const @KV_UNREACHED_LOW)))
        (else (local.set $fmax (i32.sub (local.get $fmax) (i32.const 1)))))
      (local.set $diagonal (local.get $fmax))
      (block $forward_done
        (loop $next_forward_diagonal
          (br_if $forward_done (i32.lt_s (local.get $diagonal) (local.get $fmin)))
          (local.set $x (call $kv (local.get $kv_f) (i32.sub (local.get $diagonal) (i32.const 1))))
          (if (i32.lt_s (local.get $x) (call $kv (local.get $kv_f) (i32.add (local.get $diagonal) (i32.const 1))))
            (then (local.set $x (call $kv (local.get $kv_f) (i32.add (local.get $diagonal) (i32.const 1)))))
            (else (local.set $x (i32.add (local.get $x) (i32.const 1)))))
          (local.set $start (local.get $x))
          (local.set $y (i32.sub (local.get $x) (local.get $diagonal)))
          (local.set $limit (i32.sub (local.get $lim1) (local.get $x)))
          (if (i32.lt_s (i32.sub (local.get $lim2) (local.get $y)) (local.get $limit))
            (then (local.set $limit (i32.sub (local.get $lim2) (local.get $y)))))
          (if (i32.gt_s (local.get $limit) (i32.const 0))
            (then
              (local.set $limit (i32.add (local.get $limit) (local.get $x)))
              (block $snake_followed
                (loop $extend_snake
                  (br_if $snake_followed (i32.ne (i32.load (i32.add (local.get $ids_a) (i32.shl (local.get $x) (i32.const 2))))
                                                 (i32.load (i32.add (local.get $ids_b) (i32.shl (local.get $y) (i32.const 2))))))
                  (local.set $x (i32.add (local.get $x) (i32.const 1)))
                  (local.set $y (i32.add (local.get $y) (i32.const 1)))
                  (br_if $extend_snake (i32.lt_s (local.get $x) (local.get $limit)))))))
          (if (i32.gt_s (i32.sub (local.get $x) (local.get $start)) (i32.const @SNAKE_COUNT)) (then (local.set $snake (i32.const 1))))
          (call $set_kv (local.get $kv_f) (local.get $diagonal) (local.get $x))
          (if (local.get $odd)
            (then
              (if (i32.and (i32.ge_s (local.get $diagonal) (local.get $bmin)) (i32.le_s (local.get $diagonal) (local.get $bmax)))
                (then
                  (if (i32.le_s (call $kv (local.get $kv_b) (local.get $diagonal)) (local.get $x))
                    (then (return (local.get $x) (local.get $y))))))))
          (local.set $diagonal (i32.sub (local.get $diagonal) (i32.const 2)))
          (br $next_forward_diagonal)))
      ;; backward round
      (if (i32.gt_s (local.get $bmin) (local.get $dmin))
        (then
          (local.set $bmin (i32.sub (local.get $bmin) (i32.const 1)))
          (call $set_kv (local.get $kv_b) (i32.sub (local.get $bmin) (i32.const 1)) (i32.const @KV_UNREACHED_HIGH)))
        (else (local.set $bmin (i32.add (local.get $bmin) (i32.const 1)))))
      (if (i32.lt_s (local.get $bmax) (local.get $dmax))
        (then
          (local.set $bmax (i32.add (local.get $bmax) (i32.const 1)))
          (call $set_kv (local.get $kv_b) (i32.add (local.get $bmax) (i32.const 1)) (i32.const @KV_UNREACHED_HIGH)))
        (else (local.set $bmax (i32.sub (local.get $bmax) (i32.const 1)))))
      (local.set $diagonal (local.get $bmax))
      (block $backward_done
        (loop $next_backward_diagonal
          (br_if $backward_done (i32.lt_s (local.get $diagonal) (local.get $bmin)))
          (local.set $x (call $kv (local.get $kv_b) (i32.sub (local.get $diagonal) (i32.const 1))))
          (if (i32.ge_s (local.get $x) (call $kv (local.get $kv_b) (i32.add (local.get $diagonal) (i32.const 1))))
            (then (local.set $x (i32.sub (call $kv (local.get $kv_b) (i32.add (local.get $diagonal) (i32.const 1))) (i32.const 1)))))
          (local.set $start (local.get $x))
          (local.set $y (i32.sub (local.get $x) (local.get $diagonal)))
          (local.set $limit (i32.sub (local.get $x) (local.get $off1)))
          (if (i32.lt_s (i32.sub (local.get $y) (local.get $off2)) (local.get $limit))
            (then (local.set $limit (i32.sub (local.get $y) (local.get $off2)))))
          (if (i32.gt_s (local.get $limit) (i32.const 0))
            (then
              (local.set $limit (i32.sub (local.get $x) (local.get $limit)))
              (block $snake_followed
                (loop $extend_snake
                  (br_if $snake_followed (i32.ne
                    (i32.load (i32.sub (i32.add (local.get $ids_a) (i32.shl (local.get $x) (i32.const 2))) (i32.const 4)))
                    (i32.load (i32.sub (i32.add (local.get $ids_b) (i32.shl (local.get $y) (i32.const 2))) (i32.const 4)))))
                  (local.set $x (i32.sub (local.get $x) (i32.const 1)))
                  (local.set $y (i32.sub (local.get $y) (i32.const 1)))
                  (br_if $extend_snake (i32.gt_s (local.get $x) (local.get $limit)))))))
          (if (i32.gt_s (i32.sub (local.get $start) (local.get $x)) (i32.const @SNAKE_COUNT)) (then (local.set $snake (i32.const 1))))
          (call $set_kv (local.get $kv_b) (local.get $diagonal) (local.get $x))
          (if (i32.eqz (local.get $odd))
            (then
              (if (i32.and (i32.ge_s (local.get $diagonal) (local.get $fmin)) (i32.le_s (local.get $diagonal) (local.get $fmax)))
                (then
                  (if (i32.le_s (local.get $x) (call $kv (local.get $kv_f) (local.get $diagonal)))
                    (then (return (local.get $x) (local.get $y))))))))
          (local.set $diagonal (i32.sub (local.get $diagonal) (i32.const 2)))
          (br $next_backward_diagonal)))
      ;; out of budget: split at the furthest point the forward search reached, the same
      ;; diagonals in the same order as seams_cut_short in src/myers.asm
      (local.set $cost (i32.add (local.get $cost) (i32.const 1)))
      ;; FAST, past HEUR_MIN_COST, after a long run of matches: split early at a point far along a
      ;; front whose last SNAKE_COUNT steps all matched (seams_good_snake in src/myers.asm)
      (if (i32.and (i32.and (i32.ne (i32.load offset=#cost_limit (local.get $d)) (i32.const 0)) (local.get $snake))
                   (i32.gt_u (local.get $cost) (i32.const @HEUR_MIN_COST)))
        (then
          (local.set $threshold (i32.mul (local.get $cost) (i32.const @K_HEUR)))
          (local.set $best (i32.const 0))
          (local.set $centre (i32.sub (local.get $off1) (local.get $off2)))
          (local.set $diagonal (local.get $fmax))
          (block $forward_seen
            (loop $next_forward
              (br_if $forward_seen (i32.lt_s (local.get $diagonal) (local.get $fmin)))
              (local.set $x (call $kv (local.get $kv_f) (local.get $diagonal)))
              (local.set $y (i32.sub (local.get $x) (local.get $diagonal)))
              (local.set $step (i32.sub (local.get $diagonal) (local.get $centre)))
              (if (i32.lt_s (local.get $step) (i32.const 0)) (then (local.set $step (i32.sub (i32.const 0) (local.get $step)))))
              (local.set $score (i32.sub (i32.sub (i32.add (local.get $x) (local.get $y)) (i32.add (local.get $off1) (local.get $off2))) (local.get $step)))
              (if (i32.and (i32.and (i32.gt_s (local.get $score) (local.get $threshold)) (i32.gt_s (local.get $score) (local.get $best)))
                           (i32.and (i32.and (i32.ge_s (local.get $x) (i32.add (local.get $off1) (i32.const @SNAKE_COUNT))) (i32.lt_s (local.get $x) (local.get $lim1)))
                                    (i32.and (i32.ge_s (local.get $y) (i32.add (local.get $off2) (i32.const @SNAKE_COUNT))) (i32.lt_s (local.get $y) (local.get $lim2)))))
                (then
                  (local.set $step (i32.const 1))
                  (block $not_a_snake
                    (loop $compare
                      (br_if $not_a_snake (i32.ne
                        (i32.load (i32.add (local.get $ids_a) (i32.shl (i32.sub (local.get $x) (local.get $step)) (i32.const 2))))
                        (i32.load (i32.add (local.get $ids_b) (i32.shl (i32.sub (local.get $y) (local.get $step)) (i32.const 2))))))
                      (if (i32.eq (local.get $step) (i32.const @SNAKE_COUNT))
                        (then
                          (local.set $best (local.get $score))
                          (local.set $best_x (local.get $x))
                          (local.set $best_y (local.get $y))
                          (br $not_a_snake)))
                      (local.set $step (i32.add (local.get $step) (i32.const 1)))
                      (br $compare)))))
              (local.set $diagonal (i32.sub (local.get $diagonal) (i32.const 2)))
              (br $next_forward)))
          (if (i32.gt_s (local.get $best) (i32.const 0)) (then (return (local.get $best_x) (local.get $best_y))))
          (local.set $centre (i32.sub (local.get $lim1) (local.get $lim2)))
          (local.set $diagonal (local.get $bmax))
          (block $backward_seen
            (loop $next_backward
              (br_if $backward_seen (i32.lt_s (local.get $diagonal) (local.get $bmin)))
              (local.set $x (call $kv (local.get $kv_b) (local.get $diagonal)))
              (local.set $y (i32.sub (local.get $x) (local.get $diagonal)))
              (local.set $step (i32.sub (local.get $diagonal) (local.get $centre)))
              (if (i32.lt_s (local.get $step) (i32.const 0)) (then (local.set $step (i32.sub (i32.const 0) (local.get $step)))))
              (local.set $score (i32.sub (i32.sub (i32.add (local.get $lim1) (local.get $lim2)) (i32.add (local.get $x) (local.get $y))) (local.get $step)))
              (if (i32.and (i32.and (i32.gt_s (local.get $score) (local.get $threshold)) (i32.gt_s (local.get $score) (local.get $best)))
                           (i32.and (i32.and (i32.gt_s (local.get $x) (local.get $off1)) (i32.le_s (local.get $x) (i32.sub (local.get $lim1) (i32.const @SNAKE_COUNT))))
                                    (i32.and (i32.gt_s (local.get $y) (local.get $off2)) (i32.le_s (local.get $y) (i32.sub (local.get $lim2) (i32.const @SNAKE_COUNT))))))
                (then
                  (local.set $step (i32.const 0))
                  (block $not_a_snake
                    (loop $compare
                      (br_if $not_a_snake (i32.ne
                        (i32.load (i32.add (local.get $ids_a) (i32.shl (i32.add (local.get $x) (local.get $step)) (i32.const 2))))
                        (i32.load (i32.add (local.get $ids_b) (i32.shl (i32.add (local.get $y) (local.get $step)) (i32.const 2))))))
                      (if (i32.eq (local.get $step) (i32.const @SNAKE_COUNT_LESS_ONE))
                        (then
                          (local.set $best (local.get $score))
                          (local.set $best_x (local.get $x))
                          (local.set $best_y (local.get $y))
                          (br $not_a_snake)))
                      (local.set $step (i32.add (local.get $step) (i32.const 1)))
                      (br $compare)))))
              (local.set $diagonal (i32.sub (local.get $diagonal) (i32.const 2)))
              (br $next_backward)))
          (if (i32.gt_s (local.get $best) (i32.const 0)) (then (return (local.get $best_x) (local.get $best_y))))))
      (if (i32.and (i32.ne (i32.load offset=#cost_limit (local.get $d)) (i32.const 0))
                   (i32.ge_u (local.get $cost) (i32.load offset=#cost_limit (local.get $d))))
        (then
          (local.set $best (i32.add (local.get $off1) (local.get $off2)))
          (local.set $diagonal (local.get $fmax))
          (block $all_seen
            (loop $next_seen
              (br_if $all_seen (i32.lt_s (local.get $diagonal) (local.get $fmin)))
              (local.set $x (call $kv (local.get $kv_f) (local.get $diagonal)))
              (local.set $y (i32.sub (local.get $x) (local.get $diagonal)))
              (if (i32.and (i32.and (i32.le_s (local.get $x) (local.get $lim1)) (i32.le_s (local.get $y) (local.get $lim2)))
                           (i32.and (i32.ge_s (local.get $y) (local.get $off2)) (i32.gt_s (i32.add (local.get $x) (local.get $y)) (local.get $best))))
                (then
                  (local.set $best (i32.add (local.get $x) (local.get $y)))
                  (local.set $best_x (local.get $x))
                  (local.set $best_y (local.get $y))))
              (local.set $diagonal (i32.sub (local.get $diagonal) (i32.const 2)))
              (br $next_seen)))
          ;; a split at either corner would not shrink the box
          (if (i32.and (i32.gt_s (local.get $best) (i32.add (local.get $off1) (local.get $off2)))
                       (i32.lt_s (local.get $best) (i32.add (local.get $lim1) (local.get $lim2))))
            (then (return (local.get $best_x) (local.get $best_y))))))
      (br $next_cost))
    (unreachable))

  ;; exact linear-space Myers on work_a[off1, lim1) against work_b[off2, lim2)
  (func $compare_box (param $d i32) (param $off1 i32) (param $lim1 i32) (param $off2 i32) (param $lim2 i32)
    (local $limit i32) (local $matched i32) (local $split1 i32) (local $split2 i32)
    (loop $strip_common_ends
      (local.set $limit (i32.sub (local.get $lim1) (local.get $off1)))
      (if (i32.lt_s (i32.sub (local.get $lim2) (local.get $off2)) (local.get $limit))
        (then (local.set $limit (i32.sub (local.get $lim2) (local.get $off2)))))
      (if (i32.gt_s (local.get $limit) (i32.const 0))
        (then
          (local.set $matched (call $common_prefix
            (i32.add (i32.load offset=#work_a (local.get $d)) (i32.shl (local.get $off1) (i32.const 2)))
            (i32.add (i32.load offset=#work_b (local.get $d)) (i32.shl (local.get $off2) (i32.const 2)))
            (local.get $limit)))
          (local.set $off1 (i32.add (local.get $off1) (local.get $matched)))
          (local.set $off2 (i32.add (local.get $off2) (local.get $matched)))
          (local.set $limit (i32.sub (local.get $lim1) (local.get $off1)))
          (if (i32.lt_s (i32.sub (local.get $lim2) (local.get $off2)) (local.get $limit))
            (then (local.set $limit (i32.sub (local.get $lim2) (local.get $off2)))))
          (local.set $matched (call $common_suffix
            (i32.add (i32.load offset=#work_a (local.get $d)) (i32.shl (local.get $lim1) (i32.const 2)))
            (i32.add (i32.load offset=#work_b (local.get $d)) (i32.shl (local.get $lim2) (i32.const 2)))
            (local.get $limit)))
          (local.set $lim1 (i32.sub (local.get $lim1) (local.get $matched)))
          (local.set $lim2 (i32.sub (local.get $lim2) (local.get $matched)))))
      (if (i32.eq (local.get $off1) (local.get $lim1))
        (then
          (call $mark_changed (i32.load offset=#map_b (local.get $d)) (i32.load offset=#match_changed_b (local.get $d))
            (local.get $off2) (local.get $lim2))
          (return)))
      (if (i32.eq (local.get $off2) (local.get $lim2))
        (then
          (call $mark_changed (i32.load offset=#map_a (local.get $d)) (i32.load offset=#match_changed_a (local.get $d))
            (local.get $off1) (local.get $lim1))
          (return)))
      (call $split (local.get $d) (local.get $off1) (local.get $lim1) (local.get $off2) (local.get $lim2))
      (local.set $split2)
      (local.set $split1)
      (call $compare_box (local.get $d) (local.get $off1) (local.get $split1) (local.get $off2) (local.get $split2))
      (local.set $off1 (local.get $split1))
      (local.set $off2 (local.get $split2))
      (br $strip_common_ends)))

  ;; ---------------------------------------------------------------- emit

  ;; turns the changed bytes into change records
  (func $emit (param $d i32) (result i32)
    (local $changed_a i32) (local $changed_b i32) (local $a_lines i32) (local $b_lines i32)
    (local $a_pos i32) (local $b_pos i32) (local $record_a i32) (local $record_b i32) (local $count i32) (local $at i32)
    (local.set $changed_a (i32.load offset=#changed_a (local.get $d)))
    (local.set $changed_b (i32.load offset=#changed_b (local.get $d)))
    (local.set $a_lines (i32.load offset=#a_count (local.get $d)))
    (local.set $b_lines (i32.load offset=#b_count (local.get $d)))
    (i32.store offset=#s_count (local.get $d) (i32.const 0))
    (loop $next_position
      ;; skip lines unchanged on both sides
      (block $record_starts
        (loop $skip_unchanged
          (br_if $record_starts (i32.ge_u (local.get $a_pos) (local.get $a_lines)))
          (br_if $record_starts (i32.ge_u (local.get $b_pos) (local.get $b_lines)))
          (br_if $record_starts (i32.load8_u (i32.add (local.get $changed_a) (local.get $a_pos))))
          (br_if $record_starts (i32.load8_u (i32.add (local.get $changed_b) (local.get $b_pos))))
          (local.set $a_pos (i32.add (local.get $a_pos) (i32.const 1)))
          (local.set $b_pos (i32.add (local.get $b_pos) (i32.const 1)))
          (br $skip_unchanged)))
      (if (i32.and (i32.ge_u (local.get $a_pos) (local.get $a_lines)) (i32.ge_u (local.get $b_pos) (local.get $b_lines)))
        (then (return (i32.const @OK))))
      (local.set $record_a (local.get $a_pos))
      (local.set $record_b (local.get $b_pos))
      (block $deletions_measured
        (loop $extend_deletions
          (br_if $deletions_measured (i32.ge_u (local.get $a_pos) (local.get $a_lines)))
          (br_if $deletions_measured (i32.eqz (i32.load8_u (i32.add (local.get $changed_a) (local.get $a_pos)))))
          (local.set $a_pos (i32.add (local.get $a_pos) (i32.const 1)))
          (br $extend_deletions)))
      (block $insertions_measured
        (loop $extend_insertions
          (br_if $insertions_measured (i32.ge_u (local.get $b_pos) (local.get $b_lines)))
          (br_if $insertions_measured (i32.eqz (i32.load8_u (i32.add (local.get $changed_b) (local.get $b_pos)))))
          (local.set $b_pos (i32.add (local.get $b_pos) (i32.const 1)))
          (br $extend_insertions)))
      ;; unchanged lines left on only one side means the marks are inconsistent
      (if (i32.and (i32.eq (local.get $a_pos) (local.get $record_a)) (i32.eq (local.get $b_pos) (local.get $record_b)))
        (then (return (i32.const @EINVAL))))
      (local.set $count (i32.load offset=#s_count (local.get $d)))
      (if (i32.ge_u (local.get $count) (i32.load offset=#s_capacity (local.get $d)))
        (then (return (i32.const @ENOSPC))))
      (local.set $at (i32.shl (local.get $count) (i32.const 2)))
      (i32.store (i32.add (i32.load offset=#s_a_start (local.get $d)) (local.get $at)) (local.get $record_a))
      (i32.store (i32.add (i32.load offset=#s_b_start (local.get $d)) (local.get $at)) (local.get $record_b))
      (i32.store (i32.add (i32.load offset=#s_a_count (local.get $d)) (local.get $at)) (i32.sub (local.get $a_pos) (local.get $record_a)))
      (i32.store (i32.add (i32.load offset=#s_b_count (local.get $d)) (local.get $at)) (i32.sub (local.get $b_pos) (local.get $record_b)))
      (i32.store offset=#s_count (local.get $d) (i32.add (local.get $count) (i32.const 1)))
      (br $next_position))
    (unreachable))

  ;; ---------------------------------------------------------------- diff

  (func $scan_side (param $d i32) (param $bytes i32) (param $length i32) (param $t i32) (result i32)
    (if (result i32) (i32.and (i32.load offset=#flags (local.get $d)) (i32.const @FLAG_SIMD))
      (then (call $scan_simd (local.get $bytes) (local.get $length) (local.get $t)))
      (else (call $scan_scalar (local.get $bytes) (local.get $length) (local.get $t)))))

  ;; Fills the script, and line starts and lengths of both tables. Lines inside the common byte
  ;; prefix and suffix are not hashed or interned. The script is minimal.
  (func (export "diff") (param $d i32) (result i32)
    (local $status i32) (local $prefix i32) (local $suffix i32) (local $a_lines i32) (local $b_lines i32)
    (local $kept_a i32) (local $kept_b i32)
    (local.set $status (call $scan_side (local.get $d) (i32.load offset=#a_ptr (local.get $d)) (i32.load offset=#a_len (local.get $d))
      (i32.add (local.get $d) (i32.const #a_start))))
    (if (local.get $status) (then (return (local.get $status))))
    (local.set $status (call $scan_side (local.get $d) (i32.load offset=#b_ptr (local.get $d)) (i32.load offset=#b_len (local.get $d))
      (i32.add (local.get $d) (i32.const #b_start))))
    (if (local.get $status) (then (return (local.get $status))))
    (local.set $a_lines (i32.load offset=#a_count (local.get $d)))
    (local.set $b_lines (i32.load offset=#b_count (local.get $d)))
    (call $trim_ends (local.get $d))
    (local.set $suffix)
    (local.set $prefix)
    (call $hash_range (i32.load offset=#a_ptr (local.get $d)) (i32.add (local.get $d) (i32.const #a_start))
      (local.get $prefix) (i32.sub (local.get $a_lines) (local.get $suffix)))
    (call $hash_range (i32.load offset=#b_ptr (local.get $d)) (i32.add (local.get $d) (i32.const #b_start))
      (local.get $prefix) (i32.sub (local.get $b_lines) (local.get $suffix)))
    (local.set $status (call $intern_reset (local.get $d)))
    (if (local.get $status) (then (return (local.get $status))))
    (local.set $status (call $intern_range (local.get $d) (i32.load offset=#a_ptr (local.get $d)) (i32.add (local.get $d) (i32.const #a_start))
      (i32.load offset=#count_a (local.get $d)) (local.get $prefix) (i32.sub (local.get $a_lines) (local.get $suffix))))
    (if (local.get $status) (then (return (local.get $status))))
    (local.set $status (call $intern_range (local.get $d) (i32.load offset=#b_ptr (local.get $d)) (i32.add (local.get $d) (i32.const #b_start))
      (i32.load offset=#count_b (local.get $d)) (local.get $prefix) (i32.sub (local.get $b_lines) (local.get $suffix))))
    (if (local.get $status) (then (return (local.get $status))))
    (if (i32.gt_u (i32.add (i32.add (local.get $a_lines) (local.get $b_lines)) (i32.const 3)) (i32.load offset=#kv_capacity (local.get $d)))
      (then (return (i32.const @ENOSPC))))
    ;; trimmed lines pair up with each other, so they are never changed
    (memory.fill (i32.load offset=#changed_a (local.get $d)) (i32.const 0) (local.get $prefix))
    (memory.fill (i32.add (i32.load offset=#changed_a (local.get $d)) (i32.sub (local.get $a_lines) (local.get $suffix)))
      (i32.const 0) (local.get $suffix))
    (memory.fill (i32.load offset=#changed_b (local.get $d)) (i32.const 0) (local.get $prefix))
    (memory.fill (i32.add (i32.load offset=#changed_b (local.get $d)) (i32.sub (local.get $b_lines) (local.get $suffix)))
      (i32.const 0) (local.get $suffix))
    (i32.store offset=#match_changed_a (local.get $d) (i32.add (i32.load offset=#changed_a (local.get $d)) (local.get $prefix)))
    (i32.store offset=#match_changed_b (local.get $d) (i32.add (i32.load offset=#changed_b (local.get $d)) (local.get $prefix)))
    (local.set $kept_a (call $discard
      (i32.add (i32.load offset=#a_id (local.get $d)) (i32.shl (local.get $prefix) (i32.const 2)))
      (i32.load offset=#count_b (local.get $d)) (i32.load offset=#work_a (local.get $d)) (i32.load offset=#map_a (local.get $d))
      (i32.load offset=#match_changed_a (local.get $d))
      (i32.sub (i32.sub (local.get $a_lines) (local.get $prefix)) (local.get $suffix))))
    (local.set $kept_b (call $discard
      (i32.add (i32.load offset=#b_id (local.get $d)) (i32.shl (local.get $prefix) (i32.const 2)))
      (i32.load offset=#count_a (local.get $d)) (i32.load offset=#work_b (local.get $d)) (i32.load offset=#map_b (local.get $d))
      (i32.load offset=#match_changed_b (local.get $d))
      (i32.sub (i32.sub (local.get $b_lines) (local.get $prefix)) (local.get $suffix))))
    ;; FAST: a search budget that grows with the square root of what is left to match
    (i32.store offset=#cost_limit (local.get $d) (i32.const 0))
    (if (i32.and (i32.load offset=#flags (local.get $d)) (i32.const @FLAG_FAST))
      (then
        (local.set $status (i32.shl (i32.const 1)
          (i32.shr_u (i32.sub (i32.const 32) (i32.clz (i32.or (i32.add (local.get $kept_a) (local.get $kept_b)) (i32.const 1)))) (i32.const 1))))
        (if (i32.lt_u (local.get $status) (i32.const @MIN_COST_LIMIT)) (then (local.set $status (i32.const @MIN_COST_LIMIT))))
        (i32.store offset=#cost_limit (local.get $d) (local.get $status))))
    ;; centre both kv arrays so diagonals -(kept_b + 1) .. kept_a + 1 are valid indexes
    (i32.store offset=#kv_f_centre (local.get $d) (i32.add (i32.load offset=#kv_f (local.get $d))
      (i32.shl (i32.add (local.get $kept_b) (i32.const 1)) (i32.const 2))))
    (i32.store offset=#kv_b_centre (local.get $d) (i32.add (i32.load offset=#kv_b (local.get $d))
      (i32.shl (i32.add (local.get $kept_b) (i32.const 1)) (i32.const 2))))
    (call $compare_box (local.get $d) (i32.const 0) (local.get $kept_a) (i32.const 0) (local.get $kept_b))
    (call $emit (local.get $d)))

  ;; ---------------------------------------------------------------- apply

  ;; copy whole lines [from, to) of one file; lines are contiguous so this is one byte range
  (func $append_lines (param $d i32) (param $bytes i32) (param $length i32) (param $t i32) (param $from i32) (param $to i32) (result i32)
    (local $start i32) (local $end i32) (local $out_len i32)
    (if (i32.eq (local.get $from) (local.get $to)) (then (return (i32.const @OK))))
    (local.set $end (local.get $length))
    (if (i32.lt_u (local.get $to) (i32.load offset=#t_count (local.get $t)))
      (then (local.set $end (i32.load (i32.add (i32.load offset=#t_start (local.get $t)) (i32.shl (local.get $to) (i32.const 2)))))))
    (local.set $start (i32.load (i32.add (i32.load offset=#t_start (local.get $t)) (i32.shl (local.get $from) (i32.const 2)))))
    (local.set $out_len (i32.load offset=#out_len (local.get $d)))
    (if (i32.gt_u (i32.sub (local.get $end) (local.get $start))
                  (i32.sub (i32.load offset=#out_capacity (local.get $d)) (local.get $out_len)))
      (then (return (i32.const @ENOSPC))))
    (memory.copy (i32.add (i32.load offset=#out_ptr (local.get $d)) (local.get $out_len))
      (i32.add (local.get $bytes) (local.get $start)) (i32.sub (local.get $end) (local.get $start)))
    (i32.store offset=#out_len (local.get $d) (i32.add (local.get $out_len) (i32.sub (local.get $end) (local.get $start))))
    (i32.const @OK))

  ;; Writes b into out from a, b's line table and the script, and checks the script is well formed.
  (func (export "apply") (param $d i32) (result i32)
    (local $a_pos i32) (local $b_pos i32) (local $record i32) (local $at i32) (local $a_start i32) (local $b_start i32)
    (local $status i32)
    (i32.store offset=#out_len (local.get $d) (i32.const 0))
    (block $records_done
      (loop $next_record
        (br_if $records_done (i32.ge_u (local.get $record) (i32.load offset=#s_count (local.get $d))))
        (local.set $at (i32.shl (local.get $record) (i32.const 2)))
        (local.set $a_start (i32.load (i32.add (i32.load offset=#s_a_start (local.get $d)) (local.get $at))))
        (local.set $b_start (i32.load (i32.add (i32.load offset=#s_b_start (local.get $d)) (local.get $at))))
        (if (i32.lt_u (local.get $a_start) (local.get $a_pos)) (then (return (i32.const @EBADSCRIPT))))
        ;; unchanged lines pair one to one, so b must advance by the same amount as a
        (if (i32.ne (local.get $b_start) (i32.add (local.get $b_pos) (i32.sub (local.get $a_start) (local.get $a_pos))))
          (then (return (i32.const @EBADSCRIPT))))
        (local.set $status (call $append_lines (local.get $d) (i32.load offset=#a_ptr (local.get $d)) (i32.load offset=#a_len (local.get $d))
          (i32.add (local.get $d) (i32.const #a_start)) (local.get $a_pos) (local.get $a_start)))
        (if (local.get $status) (then (return (local.get $status))))
        (local.set $a_pos (i32.add (local.get $a_start) (i32.load (i32.add (i32.load offset=#s_a_count (local.get $d)) (local.get $at)))))
        (if (i32.gt_u (local.get $a_pos) (i32.load offset=#a_count (local.get $d))) (then (return (i32.const @EBADSCRIPT))))
        (local.set $b_pos (i32.add (local.get $b_start) (i32.load (i32.add (i32.load offset=#s_b_count (local.get $d)) (local.get $at)))))
        (if (i32.gt_u (local.get $b_pos) (i32.load offset=#b_count (local.get $d))) (then (return (i32.const @EBADSCRIPT))))
        (local.set $status (call $append_lines (local.get $d) (i32.load offset=#b_ptr (local.get $d)) (i32.load offset=#b_len (local.get $d))
          (i32.add (local.get $d) (i32.const #b_start)) (local.get $b_start) (local.get $b_pos)))
        (if (local.get $status) (then (return (local.get $status))))
        (local.set $record (i32.add (local.get $record) (i32.const 1)))
        (br $next_record)))
    (if (i32.ne (i32.add (local.get $b_pos) (i32.sub (i32.load offset=#a_count (local.get $d)) (local.get $a_pos)))
                (i32.load offset=#b_count (local.get $d)))
      (then (return (i32.const @EBADSCRIPT))))
    (call $append_lines (local.get $d) (i32.load offset=#a_ptr (local.get $d)) (i32.load offset=#a_len (local.get $d))
      (i32.add (local.get $d) (i32.const #a_start)) (local.get $a_pos) (i32.load offset=#a_count (local.get $d))))
)
