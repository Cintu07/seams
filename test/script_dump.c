#define _GNU_SOURCE
/* Native side of the shared harness. Reads pairs (u32 count; then u32 a_len, a bytes, u32 b_len,
   b bytes per pair), runs seams_diff scalar and AVX2, checks both agree, and writes per pair:
   i32 status, u32 record count, then a_start, b_start, a_count, b_count per record (all u32 LE). */
#include "seams.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void *aligned(uint64_t elements, size_t size) {
    size_t bytes = ((size_t)(elements ? elements : 1) * size + 31) & ~(size_t)31;
    void *p = aligned_alloc(32, bytes);
    if (!p) { fputs("out of memory\n", stderr); exit(2); }
    memset(p, 0, bytes);
    return p;
}

static uint32_t read_u32(FILE *f) {
    uint32_t v;
    if (fread(&v, 4, 1, f) != 1) { fputs("truncated pairs file\n", stderr); exit(2); }
    return v;
}

static uint8_t *read_bytes(FILE *f, uint32_t n) {
    uint8_t *p = malloc(n + 1);
    if (n && fread(p, 1, n, f) != n) { fputs("truncated pairs file\n", stderr); exit(2); }
    return p;
}

typedef struct { int status; uint64_t count; uint32_t *records; } result;

/* SEAMS_FAST=1 runs every pair with the cost cutoff, to check native and wasm cut the same way */
static uint64_t fast_flag;

static result run(const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len, int avx2) {
    const uint64_t na = seams_count_lines(a, a_len), nb = seams_count_lines(b, b_len), ids = na + nb;
    seams_line_table ta = {aligned(na, 4), aligned(na, 4), aligned(na, 8), aligned(na, 4), 0, na};
    seams_line_table tb = {aligned(nb, 4), aligned(nb, 4), aligned(nb, 8), aligned(nb, 4), 0, nb};
    uint64_t slots = 16;
    while (slots < 2 * ids) slots *= 2;
    seams_intern intern = {aligned(slots, 8), aligned(ids, 8), aligned(ids, 8), aligned(ids, 4),
                           aligned(ids, 4), aligned(ids, 4), slots, ids, 0, 0};
    seams_diff_scratch scratch = {&intern, aligned(na, 4), aligned(nb, 4), aligned(na, 4), aligned(nb, 4),
                                  aligned(na, 1), aligned(nb, 1), aligned(ids + 3, 8), aligned(ids + 3, 8), ids + 3};
    const uint64_t cap = (na < nb ? na : nb) + 1;
    seams_script s = {aligned(cap, 4), aligned(cap, 4), aligned(cap, 4), aligned(cap, 4), 0, cap};
    seams_diff_input in = {a, a_len, b, b_len, &ta, &tb, (avx2 ? SEAMS_FLAG_AVX2 : 0) | fast_flag};
    result r = {seams_diff(&in, &scratch, &s), 0, 0};
    if (r.status == SEAMS_OK) {
        r.count = s.count;
        r.records = malloc(16 * (s.count + 1));
        for (uint64_t i = 0; i < s.count; ++i) {
            r.records[4 * i] = s.a_start[i];
            r.records[4 * i + 1] = s.b_start[i];
            r.records[4 * i + 2] = s.a_count[i];
            r.records[4 * i + 3] = s.b_count[i];
        }
    }
    void *all[] = {ta.line_start, ta.line_len, ta.line_hash, ta.line_id, tb.line_start, tb.line_len, tb.line_hash, tb.line_id,
                   intern.slots, intern.id_hash, (void *)intern.id_bytes, intern.id_len, intern.id_count_a, intern.id_count_b,
                   scratch.work_a, scratch.work_b, scratch.map_a, scratch.map_b, scratch.changed_a, scratch.changed_b,
                   scratch.kv_forward, scratch.kv_backward, s.a_start, s.b_start, s.a_count, s.b_count};
    for (size_t i = 0; i < sizeof all / sizeof *all; ++i) free(all[i]);
    return r;
}

int main(int argc, char **argv) {
    if (getenv("SEAMS_FAST")) fast_flag = SEAMS_FLAG_FAST;
    if (argc != 3) { fputs("usage: script_dump pairs.bin out.bin\n", stderr); return 2; }
    FILE *in = fopen(argv[1], "rb"), *out = fopen(argv[2], "wb");
    if (!in || !out) { perror("open"); return 2; }
    const int avx2 = __builtin_cpu_supports("avx2") && __builtin_cpu_supports("bmi");
    const uint32_t pairs = read_u32(in);
    for (uint32_t p = 0; p < pairs; ++p) {
        const uint32_t a_len = read_u32(in);
        uint8_t *a = read_bytes(in, a_len);
        const uint32_t b_len = read_u32(in);
        uint8_t *b = read_bytes(in, b_len);
        result scalar = run(a, a_len, b, b_len, 0);
        if (avx2) {
            result vector = run(a, a_len, b, b_len, 1);
            if (vector.status != scalar.status || vector.count != scalar.count ||
                (scalar.count && memcmp(vector.records, scalar.records, 16 * scalar.count) != 0)) {
                fprintf(stderr, "pair %u: native scalar and AVX2 differ\n", p);
                return 1;
            }
            free(vector.records);
        }
        const int32_t status = scalar.status;
        const uint32_t count = (uint32_t)scalar.count;
        fwrite(&status, 4, 1, out);
        fwrite(&count, 4, 1, out);
        if (count) fwrite(scalar.records, 16, count, out);
        free(scalar.records);
        free(a);
        free(b);
    }
    fclose(out);
    return 0;
}
