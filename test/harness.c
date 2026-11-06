#define _GNU_SOURCE
#include "seams.h"
#include "ref_scan.h"
#include <assert.h>
#include <inttypes.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include "cases/scan_cases.h"

enum { MAX_LINES = 16384, CANARY_WORDS = 8 };
typedef int (*scan_function)(const uint8_t *, uint64_t, seams_line_table *);
extern const uint64_t seams_line_layout[8];
extern int scan_abi_probe(scan_function, const uint8_t *, uint64_t, seams_line_table *);
static _Alignas(SEAMS_ALIGNMENT) uint32_t columns[4][MAX_LINES + CANARY_WORDS];
static uint32_t seed;
static uint64_t case_count;
static scan_function scan;

static uint32_t random_value(void) {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return seed;
}

static void check_layout(void) {
    const uint64_t expected[] = {
        offsetof(seams_line_table, line_start), offsetof(seams_line_table, line_len),
        offsetof(seams_line_table, line_hash), offsetof(seams_line_table, line_id),
        offsetof(seams_line_table, count), offsetof(seams_line_table, capacity),
        sizeof(seams_line_table), SEAMS_ALIGNMENT
    };
    for (size_t i = 0; i < sizeof(expected) / sizeof(*expected); ++i)
        assert(seams_line_layout[i] == expected[i]);
    assert(seams_probe() == SEAMS_OK);
}

static void check_case(const uint8_t *bytes, size_t length, uint64_t capacity) {
    assert(capacity <= MAX_LINES);
    for (unsigned i = 0; i < 4; ++i)
        memset(columns[i], 0xa5, (capacity + CANARY_WORDS) * sizeof(uint32_t));
    seams_line_table expected = {.line_start = columns[0], .line_len = columns[1], .capacity = capacity};
    seams_line_table actual = {.line_start = columns[2], .line_len = columns[3], .count = 99, .capacity = capacity};
    const int reference = ref_scan(bytes, length, &expected);
    const int status = scan(bytes, length, &actual);
    if (status != reference || actual.count != expected.count) goto mismatch;
    if (status == SEAMS_OK) {
        if (memcmp(expected.line_start, actual.line_start, actual.count * sizeof(uint32_t))) goto mismatch;
        if (memcmp(expected.line_len, actual.line_len, actual.count * sizeof(uint32_t))) goto mismatch;
    }
    for (unsigned column = 0; column < 4; ++column)
        for (uint64_t i = capacity; i < capacity + CANARY_WORDS; ++i)
            if (columns[column][i] != UINT32_C(0xa5a5a5a5)) goto mismatch;
    ++case_count;
    return;
mismatch:
    fprintf(stderr, "FAIL: seed=0x5ea05 state=%" PRIu32 " case=%" PRIu64 " bytes=%zu cap=%" PRIu64 "\n",
            seed, case_count, length, capacity);
    abort();
}

static void check_input_boundaries(void) {
    const size_t page = (size_t)sysconf(_SC_PAGESIZE);
    assert(page < MAX_LINES);
    uint8_t *mapping = mmap(NULL, page * 2, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    assert(mapping != MAP_FAILED && mprotect(mapping + page, page, PROT_NONE) == 0);
    for (unsigned pattern = 0; pattern < 4; ++pattern) {
        for (size_t length = 0; length <= page; ++length) {
            uint8_t *input = mapping + page - length;
            for (size_t i = 0; i < length; ++i)
                input[i] = pattern == 0 ? '\n' : pattern == 1 ? 0 :
                    pattern == 2 ? (i % 31 == 0 ? '\n' : '\r') : (uint8_t)(random_value() % 13);
            check_case(input, length, length + 1);
        }
    }
    assert(munmap(mapping, page * 2) == 0);
}

static void check_output_boundaries(void) {
    const size_t page = (size_t)sysconf(_SC_PAGESIZE);
    uint8_t *mapping = mmap(NULL, page * 4, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    assert(mapping != MAP_FAILED);
    assert(mprotect(mapping + page, page, PROT_NONE) == 0);
    assert(mprotect(mapping + page * 3, page, PROT_NONE) == 0);
    uint8_t *input = malloc(page / 4 + 1);
    assert(input);
    memset(input, '\n', page / 4 + 1);
    const size_t capacities[] = {0, 8, 16, page / 4};
    for (size_t i = 0; i < sizeof(capacities) / sizeof(*capacities); ++i) {
        const size_t capacity = capacities[i];
        seams_line_table table = {
            .line_start = (uint32_t *)(mapping + page - capacity * sizeof(uint32_t)),
            .line_len = (uint32_t *)(mapping + page * 3 - capacity * sizeof(uint32_t)),
            .capacity = capacity, .count = 99
        };
        assert(scan(input, capacity + 1, &table) == SEAMS_ENOSPC && table.count == 0);
    }
    free(input);
    assert(munmap(mapping, page * 4) == 0);
}

static void check_errors_and_abi(void) {
    seams_line_table table = {.line_start = columns[0], .line_len = columns[1], .capacity = MAX_LINES};
    assert(scan(NULL, 0, NULL) == SEAMS_EINVAL);
    assert(scan(NULL, (uint64_t)SEAMS_MAX_BYTES + 1, &table) == SEAMS_E2BIG && table.count == 0);
    table.count = 99;
    assert(scan(NULL, 1, &table) == SEAMS_EINVAL && table.count == 0);
    table.line_start++;
    assert(scan((const uint8_t *)"x", 1, &table) == SEAMS_EINVAL && table.count == 0);
    table.line_start = columns[0];
    table.line_len++;
    assert(scan((const uint8_t *)"x", 1, &table) == SEAMS_EINVAL && table.count == 0);
    table.line_len = columns[1];
    assert(scan_abi_probe(scan, (const uint8_t *)"a\nb", 3, &table) == SEAMS_OK);
    assert(table.count == 2 && table.line_start[1] == 2 && table.line_len[1] == 1);
    table = (seams_line_table){.count = 99};
    assert(scan(NULL, 0, &table) == SEAMS_OK && table.count == 0);
}

static void check_random_and_large(void) {
    uint8_t input[8192];
    for (unsigned i = 0; i < 2000; ++i) {
        const size_t length = random_value() % (sizeof(input) + 1);
        for (size_t j = 0; j < length; ++j) input[j] = (uint8_t)random_value();
        check_case(input, length, length + 1);
        check_case(input, length, random_value() % 16);
    }
    const size_t length = 1024 * 1024 + 33;
    uint8_t *long_line = malloc(length);
    assert(long_line);
    memset(long_line, 'x', length);
    long_line[length / 2] = 0;
    check_case(long_line, length, 1);
    long_line[length - 1] = '\n';
    check_case(long_line, length, 1);
    free(long_line);
}

static void check_implementation(scan_function function, const char *name) {
    scan = function;
    seed = UINT32_C(0x5ea05);
    case_count = 0;
    for (size_t i = 0; i < sizeof(scan_cases) / sizeof(*scan_cases); ++i) {
        check_case(scan_cases[i].bytes, scan_cases[i].length, scan_cases[i].length + 1);
        check_case(scan_cases[i].bytes, scan_cases[i].length, 0);
    }
    check_input_boundaries();
    check_random_and_large();
    check_output_boundaries();
    check_errors_and_abi();
    printf("PASS: %s, %" PRIu64 " reference cases, seed=0x5ea05; input/output guards and six saved registers\n", name, case_count);
}

int main(void) {
    check_layout();
    check_implementation(seams_scan_scalar, "scalar");
    if (__builtin_cpu_supports("avx2") && __builtin_cpu_supports("bmi"))
        check_implementation(seams_scan_avx2, "AVX2+BMI1");
    else puts("SKIP: AVX2+BMI1 unavailable; scalar checks passed");
}
