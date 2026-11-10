#define _GNU_SOURCE
/* seams: diff, patch and three-way merge, computed by the assembly engine.
     seams [options] old new        unified diff
       -U n       context lines (default 3)
       -L label   name for old, then new, in the --- / +++ header (may be given twice)
       --stat     print only the insertion/deletion counts
       --time     print the time spent in seams_diff to stderr
       --minimal  the smallest possible diff, however long it takes (default: bounded time)
       --color    colour output (default: when stdout is a terminal), --no-color to turn off
     seams patch old new            write a self-contained patch for old -> new to stdout
     seams apply old patch          write new to stdout
     seams merge base ours theirs   three-way merge to stdout, conflicts marked
   Exit status: 0 same / clean, 1 different / conflicts, 2 trouble (like diff and git merge-file). */
#include "seams.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <fcntl.h>
#include <sys/stat.h>
#ifdef _WIN32
#include <windows.h>
#include <io.h>
#define isatty _isatty
#define STDOUT_FILENO 1
#else
#include <sys/mman.h>
#include <unistd.h>
#endif
/* linux can fault a mapped file in up front; macos has no such flag and pages it in on demand */
#ifdef MAP_POPULATE
#define SEAMS_POPULATE MAP_POPULATE
#else
#define SEAMS_POPULATE 0
#endif

/* avx2 and bmi1 on the cpu, and the os saving the 256-bit registers (cpuid and xgetbv directly, so it
   needs no compiler runtime) */
#include <cpuid.h>
static int has_avx2(void) {
    unsigned a, b, c, d;
    if (!__get_cpuid(1, &a, &b, &c, &d) || !(c & (1u << 27)) || !(c & (1u << 28))) return 0;   /* osxsave, avx */
    unsigned lo, hi;
    __asm__ volatile("xgetbv" : "=a"(lo), "=d"(hi) : "c"(0));
    if ((lo & 6) != 6) return 0;                                                            /* xmm and ymm state */
    if (!__get_cpuid_count(7, 0, &a, &b, &c, &d)) return 0;
    return (b & (1u << 5)) && (b & (1u << 3));                                              /* avx2, bmi1 */
}

/* anonymous pages arrive zeroed and page aligned, and only pages the engine touches cost anything */
static void *aligned(uint64_t elements, size_t size) {
    const size_t bytes = (size_t)(elements ? elements : 1) * size;
#ifdef _WIN32
    void *p = VirtualAlloc(0, bytes, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);   /* zeroed, 64 KiB aligned */
    if (!p) { fputs("seams: out of memory\n", stderr); exit(2); }
#else
    void *p = mmap(0, bytes, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (p == MAP_FAILED) { fputs("seams: out of memory\n", stderr); exit(2); }
#endif
    return p;
}

/* same count as seams_count_lines, using glibc's vectorised memchr */
static uint64_t count_lines(const uint8_t *p, uint64_t len) {
    if (len == 0) return 0;
    uint64_t lines = 0;
    const uint8_t *end = p + len;
    while ((p = memchr(p, '\n', (size_t)(end - p))) != 0) {
        ++lines;
        if (++p == end) return lines;
    }
    return lines + 1;
}

/* maps regular files; reads anything else (pipes, /dev/null) to EOF */
static uint8_t *read_all(const char *path, uint64_t *length) {
#ifndef _WIN32
    struct stat st;
    if (strcmp(path, "-") != 0 && stat(path, &st) == 0 && S_ISREG(st.st_mode) && st.st_size > 0) {
        if ((uint64_t)st.st_size > SEAMS_MAX_BYTES) { fprintf(stderr, "seams: %s is larger than 4 GiB\n", path); exit(2); }
        const int fd = open(path, O_RDONLY);
        if (fd < 0) { perror(path); exit(2); }
        void *p = mmap(0, (size_t)st.st_size, PROT_READ, MAP_PRIVATE | SEAMS_POPULATE, fd, 0);
        close(fd);
        if (p == MAP_FAILED) { perror(path); exit(2); }
        *length = (uint64_t)st.st_size;
        return p;
    }
#endif
    FILE *f = strcmp(path, "-") == 0 ? stdin : fopen(path, "rb");
    if (!f) { perror(path); exit(2); }
    size_t cap = 1 << 16, len = 0;
    uint8_t *p = malloc(cap);
    for (;;) {
        if (len == cap) p = realloc(p, cap *= 2);
        const size_t got = fread(p + len, 1, cap - len, f);
        if (got == 0) break;
        len += got;
    }
    if (ferror(f)) { perror(path); exit(2); }
    if (f != stdin) fclose(f);
    if (len > SEAMS_MAX_BYTES) { fprintf(stderr, "seams: %s is larger than 4 GiB\n", path); exit(2); }
    *length = len;
    return p;
}

static double now_ms(void) {
#ifdef _WIN32
    LARGE_INTEGER f, c;
    QueryPerformanceFrequency(&f); QueryPerformanceCounter(&c);
    return (double)c.QuadPart * 1e3 / (double)f.QuadPart;
#endif
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

typedef struct {
    const uint8_t *bytes;
    const seams_line_table *t;
} side;

static int colour;
#define RED "\033[31m"
#define GREEN "\033[32m"
#define CYAN "\033[36m"
#define BOLD "\033[1m"
#define RESET "\033[0m"

static void put_line(char mark, const side *s, uint64_t line) {
    const uint8_t *p = s->bytes + s->t->line_start[line];
    const uint32_t len = s->t->line_len[line];
    const int has_lf = len > 0 && p[len - 1] == '\n';
    if (colour && mark != ' ') fputs(mark == '-' ? RED : GREEN, stdout);
    putchar(mark);
    fwrite(p, 1, len - has_lf, stdout);
    if (colour && mark != ' ') fputs(RESET, stdout);
    putchar('\n');
    if (!has_lf) puts("\\ No newline at end of file");
}

/* unified format: an empty range is written as the line before it */
static void range(uint64_t start, uint64_t count) {
    printf("%" PRIu64, count ? start + 1 : start);
    if (count != 1) printf(",%" PRIu64, count);
}

static void print_unified(const side *a, const side *b, const seams_script *s, uint64_t context) {
    const uint64_t na = a->t->count, nb = b->t->count;
    uint64_t r = 0;
    while (r < s->count) {
        /* records closer than 2 * context share one hunk */
        uint64_t last = r;
        while (last + 1 < s->count &&
               s->a_start[last + 1] - (s->a_start[last] + (uint64_t)s->a_count[last]) <= 2 * context)
            ++last;
        const uint64_t lead = s->a_start[r] < context ? s->a_start[r] : context;
        const uint64_t a0 = s->a_start[r] - lead, b0 = s->b_start[r] - lead;
        const uint64_t a_end_change = s->a_start[last] + (uint64_t)s->a_count[last];
        const uint64_t b_end_change = s->b_start[last] + (uint64_t)s->b_count[last];
        uint64_t trail = na - a_end_change;
        if (nb - b_end_change < trail) trail = nb - b_end_change;
        if (trail > context) trail = context;
        const uint64_t a1 = a_end_change + trail, b1 = b_end_change + trail;
        if (colour) fputs(CYAN, stdout);
        fputs("@@ -", stdout);
        range(a0, a1 - a0);
        fputs(" +", stdout);
        range(b0, b1 - b0);
        fputs(" @@", stdout);
        if (colour) fputs(RESET, stdout);
        putchar('\n');
        uint64_t ai = a0;
        for (uint64_t k = r; k <= last; ++k) {
            while (ai < s->a_start[k]) put_line(' ', a, ai++);
            for (uint64_t i = 0; i < s->a_count[k]; ++i) put_line('-', a, ai++);
            for (uint64_t i = 0; i < s->b_count[k]; ++i) put_line('+', b, s->b_start[k] + i);
        }
        while (ai < a1) put_line(' ', a, ai++);
        r = last + 1;
    }
}

typedef struct {
    seams_line_table a, b;
    seams_script script;
    double ms;
} diff_result;

static uint64_t engine_flags(int minimal) {
    const int avx2 = has_avx2();
    return (avx2 ? SEAMS_FLAG_AVX2 : 0) | (minimal ? 0 : SEAMS_FLAG_FAST);
}

static void run_diff(const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len, uint64_t flags, diff_result *r) {
    const uint64_t na = count_lines(a, a_len), nb = count_lines(b, b_len), ids = na + nb;
    r->a = (seams_line_table){aligned(na, 4), aligned(na, 4), aligned(na, 8), aligned(na, 4), 0, na};
    r->b = (seams_line_table){aligned(nb, 4), aligned(nb, 4), aligned(nb, 8), aligned(nb, 4), 0, nb};
    uint64_t slots = 16;
    while (slots < 2 * ids) slots *= 2;
    seams_intern intern = {aligned(slots, 8), aligned(ids, 8), aligned(ids, 8), aligned(ids, 4),
                           aligned(ids, 4), aligned(ids, 4), slots, ids, 0, 0};
    seams_diff_scratch scratch = {&intern, aligned(na, 4), aligned(nb, 4), aligned(na, 4), aligned(nb, 4),
                                  aligned(na, 1), aligned(nb, 1), aligned(ids + 3, 8), aligned(ids + 3, 8), ids + 3};
    const uint64_t records = (na < nb ? na : nb) + 1;
    r->script = (seams_script){aligned(records, 4), aligned(records, 4), aligned(records, 4), aligned(records, 4), 0, records};
    seams_diff_input in = {a, a_len, b, b_len, &r->a, &r->b, flags};
    const double t0 = now_ms();
    const int status = seams_diff(&in, &scratch, &r->script);
    r->ms = now_ms() - t0;
    if (status != SEAMS_OK) { fprintf(stderr, "seams: diff failed (%d)\n", status); exit(2); }
}

static void write_all(const uint8_t *p, uint64_t n) {
    if (fwrite(p, 1, n, stdout) != n || fflush(stdout) != 0) { perror("seams: write"); exit(2); }
}

static int command_patch(const char *old_path, const char *new_path) {
    uint64_t a_len, b_len;
    const uint8_t *a = read_all(old_path, &a_len), *b = read_all(new_path, &b_len);
    diff_result d;
    run_diff(a, a_len, b, b_len, engine_flags(0), &d);
    seams_patch_input in = {a, a_len, &d.a, b, b_len, &d.b, &d.script, 0, 0, 0, 0, 0};
    in.out_capacity = seams_patch_size(&in);
    in.out = aligned(in.out_capacity, 1);
    if (seams_write_patch(&in) != SEAMS_OK) { fputs("seams: could not write the patch\n", stderr); return 2; }
    write_all(in.out, in.out_len);
    return d.script.count ? 1 : 0;
}

static int command_apply(const char *old_path, const char *patch_path) {
    uint64_t a_len, patch_len;
    const uint8_t *a = read_all(old_path, &a_len), *patch = read_all(patch_path, &patch_len);
    if (patch_len < SEAMS_PATCH_HEADER_BYTES) { fprintf(stderr, "seams: %s is not a seams patch\n", patch_path); return 2; }
    uint64_t b_len;
    memcpy(&b_len, patch + 24, sizeof b_len);
    const uint64_t na = count_lines(a, a_len);
    seams_line_table ta = {aligned(na, 4), aligned(na, 4), aligned(na, 8), aligned(na, 4), 0, na};
    const int avx2 = has_avx2();
    if ((avx2 ? seams_scan_avx2(a, a_len, &ta) : seams_scan_scalar(a, a_len, &ta)) != SEAMS_OK) { fputs("seams: scan failed\n", stderr); return 2; }
    seams_patch_input in = {a, a_len, &ta, 0, 0, 0, 0, patch, patch_len, aligned(b_len, 1), b_len, 0};
    const int status = seams_apply_patch(&in);
    if (status == SEAMS_EWRONGBASE) { fprintf(stderr, "seams: %s was made from a different %s\n", patch_path, old_path); return 2; }
    if (status != SEAMS_OK) { fprintf(stderr, "seams: %s is damaged (%d)\n", patch_path, status); return 2; }
    write_all(in.out, in.out_len);
    return 0;
}

static int command_merge(const char *base_path, const char *ours_path, const char *theirs_path) {
    uint64_t o_len, x_len, y_len;
    const uint8_t *o = read_all(base_path, &o_len), *x = read_all(ours_path, &x_len), *y = read_all(theirs_path, &y_len);
    diff_result to_ours, to_theirs;
    run_diff(o, o_len, x, x_len, engine_flags(0), &to_ours);
    run_diff(o, o_len, y, y_len, engine_flags(0), &to_theirs);
    /* every conflict adds about 50 bytes of markers, and there can be one per changed region */
    const uint64_t cap = 2 * (o_len + x_len + y_len) + 64 * (to_ours.script.count + to_theirs.script.count + 1);
    seams_merge_input in = {o, o_len, &to_ours.a, x, x_len, &to_ours.b, y, y_len, &to_theirs.b,
                            &to_ours.script, &to_theirs.script, aligned(cap, 1), cap, 0, 0};
    if (seams_merge(&in) != SEAMS_OK) { fputs("seams: merge failed\n", stderr); return 2; }
    write_all(in.out, in.out_len);
    if (in.conflicts) fprintf(stderr, "seams: %" PRIu64 " conflict%s\n", in.conflicts, in.conflicts == 1 ? "" : "s");
    return in.conflicts ? 1 : 0;
}

static void usage(void) {
    fputs("usage: seams [-U n] [-L label] [--stat] [--time] [--minimal] [--color|--no-color] old new\n"
          "       seams patch old new\n"
          "       seams apply old patch\n"
          "       seams merge base ours theirs\n", stderr);
    exit(2);
}

int main(int argc, char **argv) {
#ifdef _WIN32
    /* bytes in, bytes out: no \n to \r\n translation, or apply would not rebuild files exactly */
    _setmode(_fileno(stdout), _O_BINARY);
    _setmode(_fileno(stdin), _O_BINARY);
    {   /* let the console show the colours */
        DWORD mode;
        HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
        if (GetConsoleMode(out, &mode)) SetConsoleMode(out, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
    }
#endif
    if (argc == 4 && strcmp(argv[1], "patch") == 0) return command_patch(argv[2], argv[3]);
    if (argc == 4 && strcmp(argv[1], "apply") == 0) return command_apply(argv[2], argv[3]);
    if (argc == 5 && strcmp(argv[1], "merge") == 0) return command_merge(argv[2], argv[3], argv[4]);
    uint64_t context = 3;
    const char *label[2] = {0, 0}, *path[2] = {0, 0};
    int labels = 0, paths = 0, stat = 0, timing = 0, minimal = 0;
    colour = isatty(STDOUT_FILENO);
    for (int i = 1; i < argc; ++i) {
        const char *x = argv[i];
        if (strcmp(x, "-U") == 0 && i + 1 < argc) context = strtoull(argv[++i], 0, 10);
        else if (strncmp(x, "-U", 2) == 0 && x[2]) context = strtoull(x + 2, 0, 10);
        else if (strcmp(x, "-L") == 0 && i + 1 < argc && labels < 2) label[labels++] = argv[++i];
        else if (strcmp(x, "--stat") == 0) stat = 1;
        else if (strcmp(x, "--time") == 0) timing = 1;
        else if (strcmp(x, "--minimal") == 0) minimal = 1;
        else if (strcmp(x, "--color") == 0) colour = 1;
        else if (strcmp(x, "--no-color") == 0) colour = 0;
        else if (x[0] == '-' && x[1]) usage();
        else if (paths < 2) path[paths++] = x;
        else usage();
    }
    if (paths != 2) usage();
    static char buf[1 << 20];
    setvbuf(stdout, buf, _IOFBF, sizeof buf);

    uint64_t a_len, b_len;
    uint8_t *a = read_all(path[0], &a_len), *b = read_all(path[1], &b_len);
    diff_result d;
    run_diff(a, a_len, b, b_len, engine_flags(minimal), &d);
    const seams_script script = d.script;
    const uint64_t na = d.a.count, nb = d.b.count;

    uint64_t deleted = 0, inserted = 0;
    for (uint64_t r = 0; r < script.count; ++r) { deleted += script.a_count[r]; inserted += script.b_count[r]; }
    if (stat) {
        printf("%" PRIu64 " lines -> %" PRIu64 " lines: %" PRIu64 " insertions(+), %" PRIu64 " deletions(-)\n",
               na, nb, inserted, deleted);
    } else if (script.count) {
        if (colour) fputs(BOLD, stdout);
        printf("--- %s\n+++ %s\n", label[0] ? label[0] : path[0], label[1] ? label[1] : path[1]);
        if (colour) fputs(RESET, stdout);
        const side sa = {a, &d.a}, sb = {b, &d.b};
        print_unified(&sa, &sb, &script, context);
    }
    fflush(stdout);
    if (timing)
        fprintf(stderr, "seams_diff: %.2f ms for %" PRIu64 " + %" PRIu64 " lines\n", d.ms, na, nb);
    return script.count ? 1 : 0;
}
