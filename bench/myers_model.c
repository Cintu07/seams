// A C model of the bounded myers search, to try split strategies before writing them in assembly.
// It takes the interned ids from the real engine, drops lines whose id never occurs in the other
// file (as seams_discard does), and runs the divide-and-conquer search with:
//   plain:   cut at the furthest forward point when the budget runs out (what seams does today)
//   both:    cut at the better of the forward and backward fronts
//   snake:   both, plus an early split at a run of 20 matching lines once the cost passes 256
//            (xdiff's heuristic, which imara-diff also uses)
// and reports time, diagonal steps and the edit count for each.
//   ./build/myers_model old new [runs]
#define _GNU_SOURCE
#include "seams.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// 32-byte aligned and zeroed, as the engine's avx2 stages expect
static void *zalloc(uint64_t n, size_t size) {
    size_t bytes = ((size_t)(n ? n : 1) * size + 31) & ~(size_t)31;
    void *p = aligned_alloc(32, bytes);
    if (!p) exit(1);
    memset(p, 0, bytes);
    return p;
}
static uint8_t *read_file(const char *path, uint64_t *length) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); exit(1); }
    fseek(f, 0, SEEK_END); *length = (uint64_t)ftell(f); fseek(f, 0, SEEK_SET);
    uint8_t *p = malloc(*length + 1);
    if (fread(p, 1, *length, f) != *length) exit(1);
    fclose(f);
    return p;
}
static double now_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC_RAW, &t); return t.tv_sec * 1e3 + t.tv_nsec / 1e6; }

enum { EXACT, PLAIN, BOTH, SNAKE };
#define SNAKE_CNT 20
#define HEUR_MIN 256
#define K_HEUR 4

typedef struct {
    const uint32_t *a, *b;
    uint8_t *ca, *cb;
    int32_t *kf, *kb;   // centred so index -(nb+1) .. na+1 is valid
    int32_t max_cost;
    int mode;
    int keep_min;   // 0: never pass need_min down (what seams' asm can do without a new parameter)
    uint64_t steps;
} model;

typedef struct { int32_t x, y; int min_lo, min_hi; } split_t;

static split_t split(model *m, int32_t off1, int32_t lim1, int32_t off2, int32_t lim2, int need_min) {
    const uint32_t *a = m->a, *b = m->b;
    int32_t *kf = m->kf, *kb = m->kb;
    const int32_t dmin = off1 - lim2, dmax = lim1 - off2, fmid = off1 - off2, bmid = lim1 - lim2;
    const int odd = (fmid - bmid) & 1;
    int32_t fmin = fmid, fmax = fmid, bmin = bmid, bmax = bmid;
    kf[fmid] = off1; kb[bmid] = lim1;
    for (int32_t ec = 1;; ++ec) {
        int got_snake = 0;
        // forward round
        if (fmin > dmin) kf[--fmin - 1] = -1; else ++fmin;
        if (fmax < dmax) kf[++fmax + 1] = -1; else --fmax;
        for (int32_t d = fmax; d >= fmin; d -= 2) {
            int32_t i1 = kf[d - 1] >= kf[d + 1] ? kf[d - 1] + 1 : kf[d + 1];
            const int32_t prev = i1;
            int32_t i2 = i1 - d;
            while (i1 < lim1 && i2 < lim2 && a[i1] == b[i2]) { ++i1; ++i2; }
            m->steps += 1 + (uint64_t)(i1 - prev);
            if (i1 - prev > SNAKE_CNT) got_snake = 1;
            kf[d] = i1;
            if (odd && bmin <= d && d <= bmax && kb[d] <= i1) return (split_t){i1, i2, 1, 1};
        }
        // backward round
        if (bmin > dmin) kb[--bmin - 1] = 0x7fffffff; else ++bmin;
        if (bmax < dmax) kb[++bmax + 1] = 0x7fffffff; else --bmax;
        for (int32_t d = bmax; d >= bmin; d -= 2) {
            int32_t i1 = kb[d - 1] < kb[d + 1] ? kb[d - 1] : kb[d + 1] - 1;
            const int32_t prev = i1;
            int32_t i2 = i1 - d;
            while (i1 > off1 && i2 > off2 && a[i1 - 1] == b[i2 - 1]) { --i1; --i2; }
            m->steps += 1 + (uint64_t)(prev - i1);
            if (prev - i1 > SNAKE_CNT) got_snake = 1;
            kb[d] = i1;
            if (!odd && fmin <= d && d <= fmax && i1 <= kf[d]) return (split_t){i1, i2, 1, 1};
        }
        if (need_min) continue;
        if (m->mode == SNAKE && got_snake && ec > HEUR_MIN) {
            // a forward point far along whose last SNAKE_CNT steps were all matches
            int32_t best = 0, bx = 0, by = 0;
            for (int32_t d = fmax; d >= fmin; d -= 2) {
                const int32_t dd = d - fmid > 0 ? d - fmid : fmid - d;
                const int32_t i1 = kf[d], i2 = i1 - d, v = (i1 - off1) + (i2 - off2) - dd;
                if (v > K_HEUR * ec && v > best && off1 + SNAKE_CNT <= i1 && i1 < lim1 && off2 + SNAKE_CNT <= i2 && i2 < lim2) {
                    int k = 1;
                    for (; a[i1 - k] == b[i2 - k]; ++k) if (k == SNAKE_CNT) { best = v; bx = i1; by = i2; break; }
                }
            }
            if (best > 0) return (split_t){bx, by, 1, 0};
            best = 0;
            for (int32_t d = bmax; d >= bmin; d -= 2) {
                const int32_t dd = d - bmid > 0 ? d - bmid : bmid - d;
                const int32_t i1 = kb[d], i2 = i1 - d, v = (lim1 - i1) + (lim2 - i2) - dd;
                if (v > K_HEUR * ec && v > best && off1 < i1 && i1 <= lim1 - SNAKE_CNT && off2 < i2 && i2 <= lim2 - SNAKE_CNT) {
                    int k = 0;
                    for (; a[i1 + k] == b[i2 + k]; ++k) if (k == SNAKE_CNT - 1) { best = v; bx = i1; by = i2; break; }
                }
            }
            if (best > 0) return (split_t){bx, by, 0, 1};
        }
        if (ec >= m->max_cost) {
            int32_t fbest = -1, fx = 0;
            for (int32_t d = fmax; d >= fmin; d -= 2) {
                int32_t i1 = kf[d] < lim1 ? kf[d] : lim1, i2 = i1 - d;
                if (lim2 < i2) { i1 = lim2 + d; i2 = lim2; }
                if (fbest < i1 + i2) { fbest = i1 + i2; fx = i1; }
            }
            if (m->mode == PLAIN) {
                // seams today: forward only, and only a point strictly inside the box
                if (fbest > off1 + off2 && fbest < lim1 + lim2) return (split_t){fx, fbest - fx, 1, 0};
                continue;
            }
            int32_t bbest = 0x7fffffff, bx = 0;
            for (int32_t d = bmax; d >= bmin; d -= 2) {
                int32_t i1 = kb[d] > off1 ? kb[d] : off1, i2 = i1 - d;
                if (i2 < off2) { i1 = off2 + d; i2 = off2; }
                if (i1 + i2 < bbest) { bbest = i1 + i2; bx = i1; }
            }
            if ((lim1 + lim2) - bbest < fbest - (off1 + off2)) return (split_t){fx, fbest - fx, 1, 0};
            return (split_t){bx, bbest - bx, 0, 1};
        }
    }
}

static void compare(model *m, int32_t off1, int32_t lim1, int32_t off2, int32_t lim2, int need_min) {
    for (;;) {
        while (off1 < lim1 && off2 < lim2 && m->a[off1] == m->b[off2]) { ++off1; ++off2; }
        while (off1 < lim1 && off2 < lim2 && m->a[lim1 - 1] == m->b[lim2 - 1]) { --lim1; --lim2; }
        if (off1 == lim1) { for (int32_t i = off2; i < lim2; ++i) m->cb[i] = 1; return; }
        if (off2 == lim2) { for (int32_t i = off1; i < lim1; ++i) m->ca[i] = 1; return; }
        const split_t s = split(m, off1, lim1, off2, lim2, need_min);
        compare(m, off1, s.x, off2, s.y, m->keep_min ? s.min_lo : need_min);
        off1 = s.x; off2 = s.y; need_min = m->keep_min ? s.min_hi : need_min;
    }
}

int main(int argc, char **argv) {
    if (argc < 3) { fprintf(stderr, "usage: myers_model old new [runs]\n"); return 2; }
    const int runs = argc > 3 ? atoi(argv[3]) : 5;
    const int min_cost = argc > 4 ? atoi(argv[4]) : 256;
    const int keep_min = argc > 5 ? atoi(argv[5]) : 1;
    uint64_t a_len, b_len;
    uint8_t *ab = read_file(argv[1], &a_len), *bb = read_file(argv[2], &b_len);
    const uint64_t na = seams_count_lines(ab, a_len) + 1, nb = seams_count_lines(bb, b_len) + 1;
    seams_line_table ta = {zalloc(na, 4), zalloc(na, 4), zalloc(na, 8), zalloc(na, 4), 0, na};
    seams_line_table tb = {zalloc(nb, 4), zalloc(nb, 4), zalloc(nb, 8), zalloc(nb, 4), 0, nb};
    uint64_t slots = 16;
    while (slots < 2 * (na + nb)) slots *= 2;
    seams_intern in = {zalloc(slots, 8), zalloc(na + nb, 8), zalloc(na + nb, 8), zalloc(na + nb, 4), zalloc(na + nb, 4), zalloc(na + nb, 4), slots, na + nb, 0, 0};
    seams_scan_avx2(ab, a_len, &ta); seams_scan_avx2(bb, b_len, &tb);
    seams_hash_lines(ab, &ta); seams_hash_lines(bb, &tb);
    seams_intern_reset(&in);
    seams_intern_lines(ab, &ta, &in, 0); seams_intern_lines(bb, &tb, &in, 1);
    // drop lines that can't match, as seams_discard does
    uint32_t *a = zalloc(ta.count, 4), *b = zalloc(tb.count, 4);
    int32_t ka = 0, kb2 = 0;
    for (uint64_t i = 0; i < ta.count; ++i) if (in.id_count_b[ta.line_id[i]]) a[ka++] = ta.line_id[i];
    for (uint64_t i = 0; i < tb.count; ++i) if (in.id_count_a[tb.line_id[i]]) b[kb2++] = tb.line_id[i];
    const uint64_t dropped = (ta.count - ka) + (tb.count - kb2);
    int32_t *kvf = zalloc(ka + kb2 + 5, 4), *kvb = zalloc(ka + kb2 + 5, 4);
    uint8_t *ca = zalloc(ka, 1), *cb = zalloc(kb2, 1);
    int32_t max_cost = 1;
    { uint64_t n = (uint64_t)ka + kb2 + 3; int bits = 64 - __builtin_clzll(n | 1); max_cost = 1 << ((bits + 1) / 2); if (max_cost < min_cost) max_cost = min_cost; }
    const char *names[] = {"exact", "plain (seams today)", "best of both fronts", "both + snake heuristic"};
    printf("budget %d\n", max_cost);
    for (int mode = EXACT; mode <= SNAKE; ++mode) {
        double best = 1e30; uint64_t steps = 0, edits = 0;
        for (int r = 0; r < runs; ++r) {
            memset(ca, 0, ka); memset(cb, 0, kb2);
            model m = {a, b, ca, cb, kvf + kb2 + 2, kvb + kb2 + 2, max_cost, mode, keep_min, 0};
            const double t0 = now_ms();
            compare(&m, 0, ka, 0, kb2, mode == EXACT);
            const double t = now_ms() - t0;
            if (t < best) best = t;
            steps = m.steps;
        }
        for (int32_t i = 0; i < ka; ++i) edits += ca[i];
        for (int32_t i = 0; i < kb2; ++i) edits += cb[i];
        printf("%-26s %8.2f ms  steps %10llu  edits %llu\n", names[mode], best, (unsigned long long)steps, (unsigned long long)(edits + dropped));
    }
    return 0;
}
