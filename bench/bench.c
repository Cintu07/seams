#define _GNU_SOURCE
#include "seams.h"
#include <assert.h>
#include <inttypes.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

enum { REPETITIONS = 9, SAMPLE_BYTES = 64 * 1024 * 1024 };
typedef int (*scan_function)(const uint8_t *, uint64_t, seams_line_table *);

static double now(void) {
    struct timespec time;
    assert(clock_gettime(CLOCK_MONOTONIC_RAW, &time) == 0);
    return (double)time.tv_sec + (double)time.tv_nsec / 1e9;
}

static int pin_cpu(void) {
    cpu_set_t allowed, chosen;
    assert(sched_getaffinity(0, sizeof(allowed), &allowed) == 0);
    int cpu = 0;
    while (cpu < CPU_SETSIZE && !CPU_ISSET(cpu, &allowed)) ++cpu;
    assert(cpu < CPU_SETSIZE);
    CPU_ZERO(&chosen);
    CPU_SET(cpu, &chosen);
    assert(sched_setaffinity(0, sizeof(chosen), &chosen) == 0);
    return cpu;
}

static int scan_memchr(const uint8_t *bytes, uint64_t length, seams_line_table *lines) {
    lines->count = 0;
    uint64_t start = 0, count = 0;
    while (start < length) {
        const uint8_t *newline = memchr(bytes + start, '\n', (size_t)(length - start));
        const uint64_t end = newline ? (uint64_t)(newline - bytes) + 1 : length;
        if (count == lines->capacity) return SEAMS_ENOSPC;
        lines->line_start[count] = (uint32_t)start;
        lines->line_len[count++] = (uint32_t)(end - start);
        start = end;
    }
    lines->count = count;
    return SEAMS_OK;
}

static int compare_double(const void *a, const void *b) {
    const double left = *(const double *)a, right = *(const double *)b;
    return (left > right) - (left < right);
}

static void check_metadata(const seams_line_table *lines, size_t bytes, size_t width) {
    assert(lines->count == (bytes + width - 1) / width);
    for (uint64_t i = 0; i < lines->count; ++i) {
        const uint64_t start = i * width;
        assert(lines->line_start[i] == start);
        assert(lines->line_len[i] == (bytes - start < width ? bytes - start : width));
    }
}

static void benchmark_case(size_t bytes, size_t width) {
    uint8_t *input = malloc(bytes);
    assert(input);
    memset(input, 'x', bytes);
    for (size_t i = width - 1; i < bytes; i += width) input[i] = '\n';
    const size_t count = (bytes + width - 1) / width;
    const size_t column_bytes = ((count * sizeof(uint32_t) + 31) / 32) * 32;
    seams_line_table lines = {
        .line_start = aligned_alloc(SEAMS_ALIGNMENT, column_bytes),
        .line_len = aligned_alloc(SEAMS_ALIGNMENT, column_bytes), .capacity = count
    };
    assert(lines.line_start && lines.line_len);
    const scan_function functions[] = {scan_memchr, seams_scan_scalar, seams_scan_avx2};
    const char *names[] = {"memchr", "scalar", "avx2"};
    const unsigned implementations = __builtin_cpu_supports("avx2") && __builtin_cpu_supports("bmi") ? 3 : 2;
    const unsigned iterations = SAMPLE_BYTES / bytes ? SAMPLE_BYTES / bytes : 1;
    double samples[3][REPETITIONS];
    for (unsigned i = 0; i < implementations; ++i) {
        assert(functions[i](input, bytes, &lines) == SEAMS_OK);
        check_metadata(&lines, bytes, width);
    }
    for (unsigned rep = 0; rep < REPETITIONS; ++rep) {
        for (unsigned slot = 0; slot < implementations; ++slot) {
            const unsigned method = (slot + rep) % implementations;
            int status = 0;
            const double start = now();
            for (unsigned i = 0; i < iterations; ++i) status |= functions[method](input, bytes, &lines);
            samples[method][rep] = (now() - start) / iterations;
            assert(status == SEAMS_OK);
            check_metadata(&lines, bytes, width);
        }
    }
    for (unsigned method = 0; method < implementations; ++method) {
        qsort(samples[method], REPETITIONS, sizeof(double), compare_double);
        const double median = samples[method][REPETITIONS / 2];
        printf("%9zu %9zu %-7s %10.4f %9.3f %11.3f %10.4f %10.4f\n", bytes, width, names[method],
               median * 1e3, bytes / median / 1e9, count / median / 1e6,
               samples[method][0] * 1e3, samples[method][REPETITIONS - 1] * 1e3);
    }
    free(lines.line_start);
    free(lines.line_len);
    free(input);
}

int main(void) {
    const int cpu = pin_cpu();
    printf("scan-only; WSL vCPU=%d; nine warm repetitions; 64 MiB scanned/sample; rotated method order\n", cpu);
    puts("    bytes     width method   median_ms      GB/s    Mlines/s     min_ms     max_ms");
    const size_t sizes[] = {512 * 1024, 16 * 1024 * 1024};
    const size_t widths[] = {1, 32, 80, 4096};
    for (size_t i = 0; i < sizeof(sizes) / sizeof(*sizes); ++i) {
        for (size_t j = 0; j < sizeof(widths) / sizeof(*widths); ++j) benchmark_case(sizes[i], widths[j]);
        benchmark_case(sizes[i], sizes[i] + 1);
    }
    puts("Every method writes starts and lengths. GB/s uses input bytes only; metadata writes are additional.");
    puts("Synthetic scan stage only. No end-to-end diff, git, imara, or Pierre speed claim.");
}
