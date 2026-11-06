#define _GNU_SOURCE
#include "seams.h"
#include "ref_diff.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    seams_line_table a_lines, b_lines;
    seams_intern intern;
    seams_diff_scratch scratch;
    seams_script script;
    void *blocks[32];
    int block_count;
} diff_run;

static uint64_t fuzz_seed;
static uint64_t fuzz_case;
static const char *build_name;

static void fail(const char *what, const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len) {
    fprintf(stderr, "FAIL [%s]: %s seed=0x%" PRIx64 " case=%" PRIu64 " a_len=%" PRIu64 " b_len=%" PRIu64 "\n",
            build_name, what, fuzz_seed, fuzz_case, a_len, b_len);
    FILE *f = fopen("build/failing_a.txt", "wb"); if (f) { fwrite(a, 1, a_len, f); fclose(f); }
    f = fopen("build/failing_b.txt", "wb"); if (f) { fwrite(b, 1, b_len, f); fclose(f); }
    exit(1);
}

static void *block(diff_run *run, uint64_t elements, size_t element_size) {
    size_t bytes = (size_t)(elements ? elements : 1) * element_size;
    bytes = (bytes + SEAMS_ALIGNMENT - 1) & ~(size_t)(SEAMS_ALIGNMENT - 1);
    void *p = aligned_alloc(SEAMS_ALIGNMENT, bytes);
    memset(p, 0xa5, bytes);
    run->blocks[run->block_count++] = p;
    return p;
}

static void line_table(diff_run *run, seams_line_table *t, uint64_t lines) {
    t->line_start = block(run, lines, 4);
    t->line_len = block(run, lines, 4);
    t->line_hash = block(run, lines, 8);
    t->line_id = block(run, lines, 4);
    t->count = 0;
    t->capacity = lines;
}

/* Sizes everything exactly from seams_count_lines, as a real caller would. */
static int run_diff(diff_run *run, const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len, uint64_t flags) {
    memset(run, 0, sizeof(*run));
    const uint64_t na = seams_count_lines(a, a_len), nb = seams_count_lines(b, b_len);
    line_table(run, &run->a_lines, na);
    line_table(run, &run->b_lines, nb);
    uint64_t slots = 16;
    while (slots < 2 * (na + nb)) slots *= 2;
    run->intern = (seams_intern){
        .slots = block(run, slots, 8), .id_hash = block(run, na + nb, 8),
        .id_bytes = block(run, na + nb, 8), .id_len = block(run, na + nb, 4),
        .id_count_a = block(run, na + nb, 4), .id_count_b = block(run, na + nb, 4),
        .slot_count = slots, .id_capacity = na + nb};
    run->scratch = (seams_diff_scratch){
        .intern = &run->intern,
        .work_a = block(run, na, 4), .work_b = block(run, nb, 4),
        .map_a = block(run, na, 4), .map_b = block(run, nb, 4),
        .changed_a = block(run, na, 1), .changed_b = block(run, nb, 1),
        .kv_forward = block(run, na + nb + 3, 8), .kv_backward = block(run, na + nb + 3, 8),
        .kv_capacity = na + nb + 3};
    const uint64_t records = (na < nb ? na : nb) + 1;
    run->script = (seams_script){
        .a_start = block(run, records, 4), .b_start = block(run, records, 4),
        .a_count = block(run, records, 4), .b_count = block(run, records, 4), .capacity = records};
    seams_diff_input in = {a, a_len, b, b_len, &run->a_lines, &run->b_lines, flags};
    return seams_diff(&in, &run->scratch, &run->script);
}

static void free_run(diff_run *run) {
    for (int i = 0; i < run->block_count; ++i) free(run->blocks[i]);
}

static int same_line(const diff_run *run, const uint8_t *a, uint32_t i, const uint8_t *b, uint32_t j) {
    const uint32_t la = run->a_lines.line_len[i], lb = run->b_lines.line_len[j];
    return la == lb && memcmp(a + run->a_lines.line_start[i], b + run->b_lines.line_start[j], la) == 0;
}

/* Records sorted, non-empty, not touching; every unchanged line really is equal. */
static void check_script_shape(const diff_run *run, const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len) {
    const seams_script *s = &run->script;
    uint64_t a_pos = 0, b_pos = 0;
    for (uint64_t r = 0; r <= s->count; ++r) {
        const uint64_t a_next = r < s->count ? s->a_start[r] : run->a_lines.count;
        const uint64_t b_next = r < s->count ? s->b_start[r] : run->b_lines.count;
        if (a_next - a_pos != b_next - b_pos) fail("unchanged runs differ in length", a, a_len, b, b_len);
        if (r > 0 && r < s->count && a_next == a_pos) fail("records touch", a, a_len, b, b_len);
        for (uint64_t k = 0; k < a_next - a_pos; ++k)
            if (!same_line(run, a, (uint32_t)(a_pos + k), b, (uint32_t)(b_pos + k)))
                fail("unchanged line differs", a, a_len, b, b_len);
        if (r == s->count) break;
        if (s->a_count[r] == 0 && s->b_count[r] == 0) fail("empty record", a, a_len, b, b_len);
        a_pos = a_next + s->a_count[r];
        b_pos = b_next + s->b_count[r];
    }
}

static uint64_t edit_size(const seams_script *s) {
    uint64_t total = 0;
    for (uint64_t r = 0; r < s->count; ++r) total += s->a_count[r] + (uint64_t)s->b_count[r];
    return total;
}

static int apply_run(const diff_run *run, const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len,
                     const seams_script *script, uint8_t *out, uint64_t capacity, uint64_t *out_len) {
    seams_apply_input in = {a, a_len, &run->a_lines, b, b_len, &run->b_lines, script, out, capacity, 0};
    const int status = seams_apply(&in);
    *out_len = in.out_len;
    return status;
}

/* The batch hash takes shortcuts near line ends; it must agree with the one-line hash. */
static int hashes_match(const seams_line_table *t, const uint8_t *bytes) {
    for (uint64_t i = 0; i < t->count; ++i)
        if (t->line_hash[i] != seams_hash_line(bytes + t->line_start[i], t->line_len[i])) return 0;
    return 1;
}

static void check_pair(const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len) {
    diff_run run;
    if (run_diff(&run, a, a_len, b, b_len, 0) != SEAMS_OK) fail("scalar diff status", a, a_len, b, b_len);
    if (!hashes_match(&run.a_lines, a) || !hashes_match(&run.b_lines, b)) fail("batch hash differs", a, a_len, b, b_len);
    check_script_shape(&run, a, a_len, b, b_len);
    const int64_t expected = ref_edit_distance(a, a_len, b, b_len);
    if ((int64_t)edit_size(&run.script) != expected) fail("not minimal", a, a_len, b, b_len);
    uint8_t *out = malloc(b_len + 1);
    uint64_t out_len = 0;
    if (apply_run(&run, a, a_len, b, b_len, &run.script, out, b_len, &out_len) != SEAMS_OK ||
        out_len != b_len || memcmp(out, b, b_len) != 0)
        fail("round trip", a, a_len, b, b_len);
    if (b_len > 0 && apply_run(&run, a, a_len, b, b_len, &run.script, out, b_len - 1, &out_len) != SEAMS_ENOSPC)
        fail("apply ignored capacity", a, a_len, b, b_len);
    if (__builtin_cpu_supports("avx2") && __builtin_cpu_supports("bmi")) {
        diff_run fast;
        if (run_diff(&fast, a, a_len, b, b_len, SEAMS_FLAG_AVX2) != SEAMS_OK || fast.script.count != run.script.count)
            fail("avx2 diff differs", a, a_len, b, b_len);
        const size_t bytes = run.script.count * sizeof(uint32_t);
        if (memcmp(fast.script.a_start, run.script.a_start, bytes) || memcmp(fast.script.b_start, run.script.b_start, bytes) ||
            memcmp(fast.script.a_count, run.script.a_count, bytes) || memcmp(fast.script.b_count, run.script.b_count, bytes))
            fail("avx2 script differs", a, a_len, b, b_len);
        free_run(&fast);
    }
    free(out);
    free_run(&run);
    ++fuzz_case;
}

static void check_strings(const char *a, const char *b) {
    check_pair((const uint8_t *)a, strlen(a), (const uint8_t *)b, strlen(b));
}

static uint8_t *repeat_line(const char *line, uint64_t times, uint64_t *length) {
    const size_t n = strlen(line);
    uint8_t *p = malloc(n * times + 1);
    for (uint64_t i = 0; i < times; ++i) memcpy(p + i * n, line, n);
    *length = n * times;
    return p;
}

static void check_edge_cases(void) {
    check_strings("", "");
    check_strings("", "a\nb\n");
    check_strings("a\nb\n", "");
    check_strings("same\nlines\n", "same\nlines\n");
    check_strings("a\nb\nc\n", "x\ny\nz\n");
    check_strings("a\nb", "a\nb\n");
    check_strings("a\nb\n", "a\nb");
    check_strings("a\nb", "a\nc");
    check_strings("\n\n\n", "\n\n");
    check_strings("\n\n\n", "x\n\n\n\n");
    check_strings("a\r\nb\r\n", "a\r\nb\n");
    check_strings("line one\n", "line onf\n");
    check_strings("abcabba", "cbabac");
    check_strings("a\nb\nc\na\nb\nb\na\n", "c\nb\na\nb\na\nc\n");
    const uint8_t nul_a[] = {'a', 0, 'b', '\n', 0, '\n', 'c'};
    const uint8_t nul_b[] = {'a', 0, 'c', '\n', 0, '\n', 'c'};
    check_pair(nul_a, sizeof nul_a, nul_b, sizeof nul_b);
    uint64_t long_len;
    uint8_t *long_a = repeat_line("x", 1100000, &long_len);
    long_a[long_len - 1] = '\n';
    uint8_t *long_b = malloc(long_len + 3);
    memcpy(long_b, "y\n", 2);
    memcpy(long_b + 2, long_a, long_len);
    check_pair(long_a, long_len, long_b, long_len + 2);
    long_b[long_len + 1] = 'z';
    check_pair(long_a, long_len, long_b, long_len + 2);
    free(long_a);
    free(long_b);
    uint64_t rep_len;
    uint8_t *rep_a = repeat_line("same line\n", 100000, &rep_len);
    uint8_t *rep_b = malloc(rep_len);
    memcpy(rep_b, rep_a, rep_len);
    memcpy(rep_b + rep_len / 2 - (rep_len / 2) % 10, "CHANGED!!\n", 10);
    check_pair(rep_a, rep_len, rep_b, rep_len);
    free(rep_a);
    free(rep_b);
    for (unsigned n = 0; n < 100; ++n) {
        char a[128] = {0}, b[128] = {0};
        for (unsigned i = 0; i < n; ++i) { a[i] = (char)('a' + i % 7); b[i] = a[i]; }
        if (n > 0) b[n - 1] = 'Z';
        if (n > 3) a[n / 2] = '\n';
        check_strings(a, b);
    }
}

static uint64_t next_random(void) {
    fuzz_seed ^= fuzz_seed << 13;
    fuzz_seed ^= fuzz_seed >> 7;
    fuzz_seed ^= fuzz_seed << 17;
    return fuzz_seed;
}

static uint64_t append_random_line(uint8_t *out, unsigned alphabet) {
    static const char *const words[] = {"a", "b", "c", "}", "", "  x = 1;", "return", "\r", "if (y)", "zz"};
    const char *w = words[next_random() % alphabet];
    const size_t n = strlen(w);
    memcpy(out, w, n);
    out[n] = '\n';
    return n + 1;
}

static void check_fuzz(uint64_t pairs) {
    enum { MAX = 4096 };
    static uint8_t a[MAX], b[MAX];
    for (uint64_t i = 0; i < pairs; ++i) {
        const unsigned alphabet = 2 + (unsigned)(next_random() % 9);
        uint64_t a_len = 0, b_len = 0;
        const unsigned lines = (unsigned)(next_random() % 60);
        for (unsigned l = 0; l < lines; ++l) a_len += append_random_line(a + a_len, alphabet);
        for (uint64_t p = 0, l = 0; p < a_len; ++l) {
            uint64_t end = p;
            while (a[end] != '\n') ++end;
            const unsigned action = (unsigned)(next_random() % 10);
            if (action == 0) b_len += append_random_line(b + b_len, alphabet);
            if (action != 1) { memcpy(b + b_len, a + p, end + 1 - p); b_len += end + 1 - p; }
            if (action == 2) b_len += append_random_line(b + b_len, alphabet);
            p = end + 1;
        }
        if (next_random() % 4 == 0 && a_len) --a_len;
        if (next_random() % 4 == 0 && b_len) --b_len;
        if (next_random() % 16 == 0) for (uint64_t k = 0; k < b_len; ++k) if (next_random() % 8 == 0) b[k] = (uint8_t)next_random();
        check_pair(a, a_len, b, b_len);
    }
}

static void check_bad_scripts(void) {
    const char *a = "a\nb\nc\n", *b = "a\nX\nc\n";
    diff_run run;
    if (run_diff(&run, (const uint8_t *)a, 6, (const uint8_t *)b, 6, 0) != SEAMS_OK || run.script.count != 1)
        fail("setup for bad scripts", (const uint8_t *)a, 6, (const uint8_t *)b, 6);
    uint8_t out[16];
    uint64_t out_len;
    seams_script bad = run.script;
    uint32_t a_start = 2, b_start = 1, a_count = 1, b_count = 1;
    bad.a_start = &a_start; bad.b_start = &b_start; bad.a_count = &a_count; bad.b_count = &b_count;
    if (apply_run(&run, (const uint8_t *)a, 6, (const uint8_t *)b, 6, &bad, out, 16, &out_len) != SEAMS_EBADSCRIPT)
        fail("misaligned record accepted", (const uint8_t *)a, 6, (const uint8_t *)b, 6);
    a_start = 1; b_start = 1; a_count = 5;
    if (apply_run(&run, (const uint8_t *)a, 6, (const uint8_t *)b, 6, &bad, out, 16, &out_len) != SEAMS_EBADSCRIPT)
        fail("record past end accepted", (const uint8_t *)a, 6, (const uint8_t *)b, 6);
    free_run(&run);
}

int main(int argc, char **argv) {
    build_name = argc > 1 ? argv[1] : "normal hash";
    const char *env = getenv("SEAMS_FUZZ_PAIRS");
    const uint64_t pairs = env ? strtoull(env, NULL, 10) : 200000;
    const char *seed_env = getenv("SEAMS_FUZZ_SEED");
    fuzz_seed = seed_env ? strtoull(seed_env, NULL, 0) : 0x5ea0d1ffULL;
    const uint64_t start_seed = fuzz_seed;
    check_edge_cases();
    check_bad_scripts();
    const uint64_t edge = fuzz_case;
    check_fuzz(pairs);
    printf("PASS [%s]: %" PRIu64 " edge pairs, %" PRIu64 " fuzz pairs (seed 0x%" PRIx64 "): round trip, minimal vs ref, script shape, scalar==avx2\n",
           build_name, edge, fuzz_case - edge, start_seed);
    return 0;
}
