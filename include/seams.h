#ifndef SEAMS_H
#define SEAMS_H

#include <stdint.h>

enum {
    SEAMS_OK = 0,
    SEAMS_EINVAL = -1,
    SEAMS_E2BIG = -2,
    SEAMS_ENOSPC = -3,
    SEAMS_EBADSCRIPT = -4,
    SEAMS_ALIGNMENT = 32,
    SEAMS_FLAG_AVX2 = 1
};

#define SEAMS_MAX_BYTES UINT32_MAX
#define SEAMS_MAX_LINES (UINT32_MAX - 1u)

typedef struct seams_line_table {
    uint32_t *line_start;
    uint32_t *line_len;
    uint64_t *line_hash;
    uint32_t *line_id;
    uint64_t count;
    uint64_t capacity;
} seams_line_table;

/* Shared by both files. slot_count is a power of two, at least 2 * id_capacity.
   id_capacity must be at least the total number of lines in both files.
   Only a small prefix of slots is used at first; it doubles as ids are added. */
typedef struct seams_intern {
    uint64_t *slots;
    uint64_t *id_hash;
    const uint8_t **id_bytes;
    uint32_t *id_len;
    uint32_t *id_count_a;
    uint32_t *id_count_b;
    uint64_t slot_count;
    uint64_t id_capacity;
    uint64_t id_total;
    uint64_t active_mask;
} seams_intern;

/* Edit script: only changed regions. Lines between records are unchanged and
   pair up one to one. Records are sorted, never touch, and are never empty. */
typedef struct seams_script {
    uint32_t *a_start;
    uint32_t *b_start;
    uint32_t *a_count;
    uint32_t *b_count;
    uint64_t count;
    uint64_t capacity;
} seams_script;

typedef struct seams_diff_input {
    const uint8_t *a_bytes;
    uint64_t a_len;
    const uint8_t *b_bytes;
    uint64_t b_len;
    seams_line_table *a_lines;
    seams_line_table *b_lines;
    uint64_t flags;
} seams_diff_input;

/* Per file: work/map hold u32 per line, changed holds u8 per line.
   kv_forward and kv_backward each hold kv_capacity int64 >= a lines + b lines + 3. */
typedef struct seams_diff_scratch {
    seams_intern *intern;
    uint32_t *work_a;
    uint32_t *work_b;
    uint32_t *map_a;
    uint32_t *map_b;
    uint8_t *changed_a;
    uint8_t *changed_b;
    int64_t *kv_forward;
    int64_t *kv_backward;
    uint64_t kv_capacity;
} seams_diff_scratch;

typedef struct seams_apply_input {
    const uint8_t *a_bytes;
    uint64_t a_len;
    const seams_line_table *a_lines;
    const uint8_t *b_bytes;
    uint64_t b_len;
    const seams_line_table *b_lines;
    const seams_script *script;
    uint8_t *out;
    uint64_t out_capacity;
    uint64_t out_len;
} seams_apply_input;

int seams_probe(void);

/* Active output columns must be separate, 32-byte-aligned, capacity-element arrays.
   Input and output storage must not overlap. Hash/ID columns are unused by scanning.
   On error count is zero and any array entries already written are unspecified.
   NULL input/columns are allowed for zero bytes; the table itself is required. */
int seams_scan_scalar(const uint8_t *bytes, uint64_t length, seams_line_table *lines);

/* Caller must first verify AVX2, BMI1, and operating-system AVX state support. */
int seams_scan_avx2(const uint8_t *bytes, uint64_t length, seams_line_table *lines);

/* Exact number of lines scanning will produce, so callers can allocate once. */
uint64_t seams_count_lines(const uint8_t *bytes, uint64_t length);

uint64_t seams_hash_line(const uint8_t *bytes, uint64_t length);
int seams_hash_lines(const uint8_t *bytes, seams_line_table *lines);
int seams_intern_reset(seams_intern *intern);
int seams_intern_lines(const uint8_t *bytes, seams_line_table *lines, seams_intern *intern, int side);

/* Fills the script, and line_start/line_len of a_lines and b_lines. Lines inside the
   common byte prefix and suffix of the two files are left out of hashing and
   interning, so their line_hash and line_id entries are not written. Minimal: the
   sum of a_count + b_count over all records is the smallest possible. */
int seams_diff(const seams_diff_input *in, seams_diff_scratch *scratch, seams_script *out);

/* Writes b into out using a, b's line table and the script. Validates the script. */
int seams_apply(seams_apply_input *in);

#endif
