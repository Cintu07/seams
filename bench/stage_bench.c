// Where the time goes in one diff: scan, hash, intern, and everything after (discard, myers, emit),
// each timed on its own, median of runs. On an edit dense enough that trimming the ends does
// nothing, the stages add up to what seams_diff spends.
//   ./build/stage_bench old new [runs]
#define _GNU_SOURCE
#include "seams.h"
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
static int cmp(const void *a, const void *b) { const double x = *(const double *)a, y = *(const double *)b; return (x > y) - (x < y); }
static double median(double *t, int n) { qsort(t, (size_t)n, sizeof(double), cmp); return t[n / 2]; }
static void table(seams_line_table *t, uint64_t n) { *t = (seams_line_table){aligned(n, 4), aligned(n, 4), aligned(n, 8), aligned(n, 4), 0, n}; }

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: stage_bench old new [runs]\n"); return 2; }
    const int runs = argc > 3 ? atoi(argv[3]) : 9;
    uint64_t a_len, b_len;
    uint8_t *a = read_file(argv[1], &a_len), *b = read_file(argv[2], &b_len);
    const uint64_t na = seams_count_lines(a, a_len) + 1, nb = seams_count_lines(b, b_len) + 1;
    seams_line_table ta, tb;
    table(&ta, na); table(&tb, nb);
    uint64_t slots = 16;
    while (slots < 2 * (na + nb)) slots *= 2;
    seams_intern intern = {aligned(slots, 8), aligned(na + nb, 8), aligned(na + nb, 8), aligned(na + nb, 4),
                           aligned(na + nb, 4), aligned(na + nb, 4), slots, na + nb, 0, 0};
    seams_diff_scratch scratch = {&intern, aligned(na, 4), aligned(nb, 4), aligned(na, 4), aligned(nb, 4),
                                  aligned(na, 1), aligned(nb, 1), aligned(na + nb + 3, 8), aligned(na + nb + 3, 8), na + nb + 3};
    const uint64_t r = (na < nb ? na : nb) + 1;
    seams_script script = {aligned(r, 4), aligned(r, 4), aligned(r, 4), aligned(r, 4), 0, r};
    double *t_scan = malloc(sizeof(double) * runs), *t_hash = malloc(sizeof(double) * runs), *t_intern = malloc(sizeof(double) * runs), *t_all = malloc(sizeof(double) * runs);
    for (int k = 0; k < runs; ++k) {
        double t0 = now_ms();
        seams_scan_avx2(a, a_len, &ta); seams_scan_avx2(b, b_len, &tb);
        double t1 = now_ms();
        seams_hash_lines(a, &ta); seams_hash_lines(b, &tb);
        double t2 = now_ms();
        seams_intern_reset(&intern);
        seams_intern_lines(a, &ta, &intern, 0); seams_intern_lines(b, &tb, &intern, 1);   // side a, side b
        double t3 = now_ms();
        seams_diff_input in = {a, a_len, b, b_len, &ta, &tb, SEAMS_FLAG_AVX2 | SEAMS_FLAG_FAST};
        double t4 = now_ms();
        seams_diff(&in, &scratch, &script);
        double t5 = now_ms();
        t_scan[k] = t1 - t0; t_hash[k] = t2 - t1; t_intern[k] = t3 - t2; t_all[k] = t5 - t4;
    }
    const double s = median(t_scan, runs), h = median(t_hash, runs), i = median(t_intern, runs), all = median(t_all, runs);
    printf("lines %llu+%llu ids %llu | scan %.2f  hash %.2f  intern %.2f  | seams_diff (after scan) %.2f  so discard+myers+emit ~%.2f ms, records %llu\n",
           (unsigned long long)ta.count, (unsigned long long)tb.count, (unsigned long long)intern.id_total, s, h, i, all, all - h - i, (unsigned long long)script.count);
    return 0;
}
