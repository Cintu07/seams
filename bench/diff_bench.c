#define _GNU_SOURCE
#include "seams.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

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

static int compare_double(const void *a, const void *b) {
    const double x = *(const double *)a, y = *(const double *)b;
    return (x > y) - (x < y);
}

typedef struct {
    seams_line_table a, b;
    seams_intern intern;
    seams_diff_scratch scratch;
    seams_script script;
} engine;

static void table(seams_line_table *t, uint64_t n) {
    *t = (seams_line_table){aligned(n, 4), aligned(n, 4), aligned(n, 8), aligned(n, 4), 0, n};
}

static void setup(engine *e, uint64_t na, uint64_t nb) {
    table(&e->a, na);
    table(&e->b, nb);
    uint64_t slots = 16;
    while (slots < 2 * (na + nb)) slots *= 2;
    e->intern = (seams_intern){aligned(slots, 8), aligned(na + nb, 8), aligned(na + nb, 8), aligned(na + nb, 4),
                               aligned(na + nb, 4), aligned(na + nb, 4), slots, na + nb, 0, 0};
    e->scratch = (seams_diff_scratch){&e->intern, aligned(na, 4), aligned(nb, 4), aligned(na, 4), aligned(nb, 4),
                                      aligned(na, 1), aligned(nb, 1), aligned(na + nb + 3, 8), aligned(na + nb + 3, 8), na + nb + 3};
    const uint64_t r = (na < nb ? na : nb) + 1;
    e->script = (seams_script){aligned(r, 4), aligned(r, 4), aligned(r, 4), aligned(r, 4), 0, r};
}

static double median(double *t, int n) {
    qsort(t, (size_t)n, sizeof(double), compare_double);
    return t[n / 2];
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: diff_bench old new [runs]\n"); return 1; }
    const int runs = argc > 3 ? atoi(argv[3]) : 9;
    uint64_t a_len, b_len;
    uint8_t *a = read_file(argv[1], &a_len), *b = read_file(argv[2], &b_len);
    const uint64_t na = seams_count_lines(a, a_len), nb = seams_count_lines(b, b_len);
    engine e;
    setup(&e, na, nb);
    double total[64], prepare[64], scan[64], hash[64], intern[64];
    const int avx2 = __builtin_cpu_supports("avx2") && __builtin_cpu_supports("bmi");
    for (int mode = 0; mode <= avx2; ++mode) {
        uint64_t edits = 0;
        for (int r = 0; r < runs; ++r) {
            seams_diff_input in = {a, a_len, b, b_len, &e.a, &e.b, mode ? SEAMS_FLAG_AVX2 : 0};
            double t0 = now_ms();
            if (seams_diff(&in, &e.scratch, &e.script) != SEAMS_OK) { puts("diff failed"); return 1; }
            total[r] = now_ms() - t0;
            t0 = now_ms();
            (mode ? seams_scan_avx2 : seams_scan_scalar)(a, a_len, &e.a);
            (mode ? seams_scan_avx2 : seams_scan_scalar)(b, b_len, &e.b);
            const double t1 = now_ms();
            seams_hash_lines(a, &e.a);
            seams_hash_lines(b, &e.b);
            const double t2 = now_ms();
            seams_intern_reset(&e.intern);
            seams_intern_lines(a, &e.a, &e.intern, 0);
            seams_intern_lines(b, &e.b, &e.intern, 1);
            const double t3 = now_ms();
            scan[r] = t1 - t0;
            hash[r] = t2 - t1;
            intern[r] = t3 - t2;
            prepare[r] = t3 - t0;
        }
        for (uint64_t i = 0; i < e.script.count; ++i) edits += e.script.a_count[i] + (uint64_t)e.script.b_count[i];
        const double t = median(total, runs), p = median(prepare, runs);
        printf("seams %s median_ms=%.3f prepare_ms=%.3f match_ms=%.3f MB/s=%.0f lines/s=%.2fM records=%" PRIu64 " edits=%" PRIu64 "\n",
               mode ? "avx2-scan" : "scalar", t, p, t - p, (a_len + b_len) / 1e3 / t, (na + nb) / 1e3 / t, e.script.count, edits);
        printf("      stages scan_ms=%.3f hash_ms=%.3f intern_ms=%.3f distinct=%" PRIu64 "\n",
               median(scan, runs), median(hash, runs), median(intern, runs), e.intern.id_total);
    }
    return 0;
}
