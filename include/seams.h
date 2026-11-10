#ifndef SEAMS_H
#define SEAMS_H

#include <stdint.h>

/* the engine uses the System V calling convention everywhere. on Windows, gcc and clang call it
   through sysv_abi and save the registers Windows expects around each call; MSVC cannot. */
#if defined(_WIN32) && (defined(__GNUC__) || defined(__clang__))
#define SEAMS_ABI __attribute__((sysv_abi))
#else
#define SEAMS_ABI
#endif

enum {
    SEAMS_OK = 0,
    SEAMS_EINVAL = -1,
    SEAMS_E2BIG = -2,
    SEAMS_ENOSPC = -3,
    SEAMS_EBADSCRIPT = -4,
    SEAMS_ALIGNMENT = 32,
    SEAMS_FLAG_AVX2 = 1,
    /* Bounded time on files with little in common: a middle-snake search that runs past
       max(4096, 2^(bits(n)/2)) rounds splits at its furthest point instead. The script is
       still exact to apply, but may be longer than minimal. Without it diff is minimal. */
    SEAMS_FLAG_FAST = 2
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

SEAMS_ABI int seams_probe(void);

/* Active output columns must be separate, 32-byte-aligned, capacity-element arrays.
   Input and output storage must not overlap. Hash/ID columns are unused by scanning.
   On error count is zero and any array entries already written are unspecified.
   NULL input/columns are allowed for zero bytes; the table itself is required. */
SEAMS_ABI int seams_scan_scalar(const uint8_t *bytes, uint64_t length, seams_line_table *lines);

/* Caller must first verify AVX2, BMI1, and operating-system AVX state support. */
SEAMS_ABI int seams_scan_avx2(const uint8_t *bytes, uint64_t length, seams_line_table *lines);

/* Exact number of lines scanning will produce, so callers can allocate once. */
SEAMS_ABI uint64_t seams_count_lines(const uint8_t *bytes, uint64_t length);

SEAMS_ABI uint64_t seams_hash_line(const uint8_t *bytes, uint64_t length);
SEAMS_ABI int seams_hash_lines(const uint8_t *bytes, seams_line_table *lines);
SEAMS_ABI int seams_intern_reset(seams_intern *intern);
SEAMS_ABI int seams_intern_lines(const uint8_t *bytes, seams_line_table *lines, seams_intern *intern, int side);

/* Fills the script, and line_start/line_len of a_lines and b_lines. Lines inside the
   common byte prefix and suffix of the two files are left out of hashing and
   interning, so their line_hash and line_id entries are not written. Minimal: the
   sum of a_count + b_count over all records is the smallest possible, unless
   SEAMS_FLAG_FAST is set (see above). */
SEAMS_ABI int seams_diff(const seams_diff_input *in, seams_diff_scratch *scratch, seams_script *out);

/* Writes b into out using a, b's line table and the script. Validates the script. */
SEAMS_ABI int seams_apply(seams_apply_input *in);

/* A self-contained patch carries the inserted bytes, so a can be turned into b without b.
   Layout (little endian): u32 magic "SEAM", u32 version 1, u64 a_len, u64 hash of a,
   u64 b_len, u64 record count, then per record u32 a_start, a_count, b_count, inserted
   bytes, then all inserted bytes in order.
   seams_write_patch reads a, b, both line tables and the script, and writes the patch to out.
   seams_apply_patch reads a, a's line table (scanned) and patch, and writes b to out. A patch
   made from another a is refused with SEAMS_EWRONGBASE, a damaged one with SEAMS_EBADSCRIPT. */
typedef struct seams_patch_input {
    const uint8_t *a_bytes;
    uint64_t a_len;
    const seams_line_table *a_lines;
    const uint8_t *b_bytes;
    uint64_t b_len;
    const seams_line_table *b_lines;
    const seams_script *script;
    const uint8_t *patch;
    uint64_t patch_len;
    uint8_t *out;
    uint64_t out_capacity;
    uint64_t out_len;
} seams_patch_input;

enum { SEAMS_EWRONGBASE = -5, SEAMS_PATCH_HEADER_BYTES = 40, SEAMS_PATCH_RECORD_BYTES = 16 };

SEAMS_ABI uint64_t seams_patch_size(const seams_patch_input *in);
SEAMS_ABI int seams_write_patch(seams_patch_input *in);
SEAMS_ABI int seams_apply_patch(seams_patch_input *in);

/* Three-way merge of two edits of one base. to_ours and to_theirs are scripts from base to
   ours and from base to theirs. Changes that overlap or touch in base form one chunk: a chunk
   changed on one side takes that side, a chunk changed the same way on both takes it once, any
   other chunk is written as a conflict between <<<<<<< ours, ||||||| base, ======= and
   >>>>>>> theirs lines and counted in conflicts. */
typedef struct seams_merge_input {
    const uint8_t *base_bytes;
    uint64_t base_len;
    const seams_line_table *base_lines;
    const uint8_t *ours_bytes;
    uint64_t ours_len;
    const seams_line_table *ours_lines;
    const uint8_t *theirs_bytes;
    uint64_t theirs_len;
    const seams_line_table *theirs_lines;
    const seams_script *to_ours;
    const seams_script *to_theirs;
    uint8_t *out;
    uint64_t out_capacity;
    uint64_t out_len;
    uint64_t conflicts;
} seams_merge_input;

SEAMS_ABI int seams_merge(seams_merge_input *in);

#endif
