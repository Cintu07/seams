#define _GNU_SOURCE
/* Times seams_diff over every pair of a corpus directory (<n>.old, <n>.new, count) in one process.
   Before timing, checks every pair: apply round trip, and edit count equal to ref/ref_diff.c. */
#include "seams.h"
#include "ref_diff.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

typedef struct { uint8_t *a, *b; uint64_t a_len, b_len, na, nb; } pair;

typedef struct {
    seams_line_table a, b;
    seams_intern intern;
    seams_diff_scratch scratch;
    seams_script script;
} engine;

static void *aligned(uint64_t elements, size_t size) {
    size_t bytes = ((size_t)(elements ? elements : 1) * size + 31) & ~(size_t)31;
    void *p = aligned_alloc(32, bytes);
    memset(p, 0, bytes);
    return p;
}

static uint8_t *read_file(const char *path, uint64_t *length) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END);
    *length = (uint64_t)ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *p = malloc(*length + 1);
    if (fread(p, 1, *length, f) != *length) exit(1);
    fclose(f);
    return p;
}

static double now_ms(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC_RAW, &t);
    return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

static int compare_double(const void *x, const void *y) {
    const double a = *(const double *)x, b = *(const double *)y;
    return (a > b) - (a < b);
}

/* One engine sized for the largest pair serves every pair. */
static void setup(engine *e, uint64_t na, uint64_t nb) {
    e->a = (seams_line_table){aligned(na, 4), aligned(na, 4), aligned(na, 8), aligned(na, 4), 0, na};
    e->b = (seams_line_table){aligned(nb, 4), aligned(nb, 4), aligned(nb, 8), aligned(nb, 4), 0, nb};
    const uint64_t ids = na + nb;
    uint64_t slots = 16;
    while (slots < 2 * ids) slots *= 2;
    e->intern = (seams_intern){aligned(slots, 8), aligned(ids, 8), aligned(ids, 8), aligned(ids, 4),
                               aligned(ids, 4), aligned(ids, 4), slots, ids, 0, 0};
    e->scratch = (seams_diff_scratch){&e->intern, aligned(na, 4), aligned(nb, 4), aligned(na, 4), aligned(nb, 4),
                                      aligned(na, 1), aligned(nb, 1), aligned(ids + 3, 8), aligned(ids + 3, 8), ids + 3};
    const uint64_t r = (na < nb ? na : nb) + 1;
    e->script = (seams_script){aligned(r, 4), aligned(r, 4), aligned(r, 4), aligned(r, 4), 0, r};
}

static int run_pair(engine *e, const pair *p, uint64_t flags) {
    e->a.capacity = p->na;
    e->b.capacity = p->nb;
    e->intern.id_capacity = p->na + p->nb;
    e->scratch.kv_capacity = p->na + p->nb + 3;
    e->script.capacity = (p->na < p->nb ? p->na : p->nb) + 1;
    seams_diff_input in = {p->a, p->a_len, p->b, p->b_len, &e->a, &e->b, flags};
    return seams_diff(&in, &e->scratch, &e->script);
}

static uint64_t edit_size(const seams_script *s) {
    uint64_t total = 0;
    for (uint64_t r = 0; r < s->count; ++r) total += s->a_count[r] + (uint64_t)s->b_count[r];
    return total;
}

static void check_pair(engine *e, const pair *p, uint64_t index, uint8_t *out) {
    if (run_pair(e, p, 0) != SEAMS_OK) { fprintf(stderr, "pair %" PRIu64 ": diff failed\n", index); exit(1); }
    seams_apply_input ap = {p->a, p->a_len, &e->a, p->b, p->b_len, &e->b, &e->script, out, p->b_len, 0};
    if (seams_apply(&ap) != SEAMS_OK || ap.out_len != p->b_len || memcmp(out, p->b, p->b_len) != 0) {
        fprintf(stderr, "pair %" PRIu64 ": round trip failed\n", index);
        exit(1);
    }
    if ((int64_t)edit_size(&e->script) != ref_edit_distance(p->a, p->a_len, p->b, p->b_len)) {
        fprintf(stderr, "pair %" PRIu64 ": not minimal\n", index);
        exit(1);
    }
}

/* seams_diff scans every line, then hashes, interns and matches only the lines between
   the common prefix and suffix, so the scan is the one stage timed on its own. */
static double time_scan(engine *e, const pair *pairs, uint64_t count, uint64_t flags) {
    int (*scan)(const uint8_t *, uint64_t, seams_line_table *) = flags ? seams_scan_avx2 : seams_scan_scalar;
    double total = 0;
    for (uint64_t i = 0; i < count; ++i) {
        const pair *p = &pairs[i];
        e->a.capacity = p->na;
        e->b.capacity = p->nb;
        const double t0 = now_ms();
        if (scan(p->a, p->a_len, &e->a) != SEAMS_OK || scan(p->b, p->b_len, &e->b) != SEAMS_OK) {
            fputs("scan failed\n", stderr);
            exit(1);
        }
        total += now_ms() - t0;
    }
    return total;
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: corpus_bench dir [runs]\n"); return 1; }
    const int runs = argc > 2 ? atoi(argv[2]) : 9;
    char path[4096];
    snprintf(path, sizeof path, "%s/count", argv[1]);
    uint64_t count_len;
    uint8_t *count_text = read_file(path, &count_len);
    const uint64_t count = strtoull((const char *)count_text, NULL, 10);
    pair *pairs = calloc(count, sizeof(pair));
    uint64_t max_na = 1, max_nb = 1, max_b = 1, bytes = 0, lines = 0;
    for (uint64_t i = 0; i < count; ++i) {
        pair *p = &pairs[i];
        snprintf(path, sizeof path, "%s/%" PRIu64 ".old", argv[1], i);
        p->a = read_file(path, &p->a_len);
        snprintf(path, sizeof path, "%s/%" PRIu64 ".new", argv[1], i);
        p->b = read_file(path, &p->b_len);
        p->na = seams_count_lines(p->a, p->a_len);
        p->nb = seams_count_lines(p->b, p->b_len);
        if (p->na > max_na) max_na = p->na;
        if (p->nb > max_nb) max_nb = p->nb;
        if (p->b_len > max_b) max_b = p->b_len;
        bytes += p->a_len + p->b_len;
        lines += p->na + p->nb;
    }
    engine e;
    setup(&e, max_na, max_nb);
    uint8_t *out = malloc(max_b);
    for (uint64_t i = 0; i < count; ++i) check_pair(&e, &pairs[i], i, out);
    printf("checked %" PRIu64 " pairs: round trip and minimal vs ref\n", count);
    const int avx2 = __builtin_cpu_supports("avx2") && __builtin_cpu_supports("bmi");
    double *total = calloc((size_t)runs, sizeof(double));
    for (int mode = 0; mode <= avx2; ++mode) {
        const uint64_t flags = mode ? SEAMS_FLAG_AVX2 : 0;
        uint64_t edits = 0;
        for (int r = 0; r < runs; ++r) {
            edits = 0;
            const double t0 = now_ms();
            for (uint64_t i = 0; i < count; ++i) {
                run_pair(&e, &pairs[i], flags);
                edits += edit_size(&e.script);
            }
            total[r] = now_ms() - t0;
        }
        qsort(total, (size_t)runs, sizeof(double), compare_double);
        const double t = total[runs / 2];
        const double scan_ms = time_scan(&e, pairs, count, flags);
        printf("seams %s pairs=%" PRIu64 " MB=%.1f lines=%" PRIu64 " median_ms=%.2f diffs/s=%.0f MB/s=%.0f lines/s=%.1fM edits=%" PRIu64 "\n",
               mode ? "avx2-scan" : "scalar", count, bytes / 1e6, lines, t, count / t * 1e3, bytes / 1e3 / t,
               lines / 1e3 / t, edits);
        printf("      scan_ms=%.2f (one pass) after_scan_ms=%.2f\n", scan_ms, t - scan_ms);
    }
    return 0;
}
