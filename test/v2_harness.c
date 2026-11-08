/* Checks the v2 pieces: self-contained patches and three-way merge.
   patches: random pairs round trip through write/apply; a patch is refused for another base,
   when cut short, and when its records are damaged.
   merge: random base with two random edits, merged by src/merge.asm and by ref/ref_merge.c,
   byte for byte; plus properties that do not trust either: an untouched side gives the other
   side back, the same edit on both sides is no conflict, distant edits merge cleanly. */
#define _GNU_SOURCE
#include "seams.h"
#include "ref_merge.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    const uint8_t *bytes;
    uint64_t len;
    seams_line_table lines;
} file;

typedef struct {
    seams_script script;
    void *blocks[32];
    int count;
} diff;

static uint64_t seed = 0x5ea0d2ffULL, cases;

static uint64_t next_random(void) {
    seed ^= seed << 13;
    seed ^= seed >> 7;
    seed ^= seed << 17;
    return seed;
}

static void fail(const char *what) {
    fprintf(stderr, "FAIL v2: %s (case %" PRIu64 ", seed 0x%" PRIx64 ")\n", what, cases, seed);
    exit(1);
}

static void *zeroed(uint64_t n, size_t size) {
    void *p = aligned_alloc(32, ((n ? n : 1) * size + 31) / 32 * 32);
    if (!p) fail("out of memory");
    memset(p, 0, (n ? n : 1) * size);
    return p;
}

static void load(file *f, const uint8_t *bytes, uint64_t len) {
    const uint64_t n = seams_count_lines(bytes, len);
    f->bytes = bytes;
    f->len = len;
    f->lines = (seams_line_table){zeroed(n, 4), zeroed(n, 4), zeroed(n, 8), zeroed(n, 4), 0, n};
    if (seams_scan_scalar(bytes, len, &f->lines) != SEAMS_OK) fail("scan");
}

static void unload(file *f) {
    free(f->lines.line_start);
    free(f->lines.line_len);
    free(f->lines.line_hash);
    free(f->lines.line_id);
}

/* seams_diff rescans into its own tables; the script is what is kept */
static void run_diff(diff *d, const file *a, const file *b) {
    memset(d, 0, sizeof *d);
    const uint64_t na = a->lines.count, nb = b->lines.count, ids = na + nb;
    uint64_t slots = 16;
    while (slots < 2 * ids) slots *= 2;
#define KEEP(p) (d->blocks[d->count++] = (p))
    seams_line_table ta = {KEEP(zeroed(na, 4)), KEEP(zeroed(na, 4)), KEEP(zeroed(na, 8)), KEEP(zeroed(na, 4)), 0, na};
    seams_line_table tb = {KEEP(zeroed(nb, 4)), KEEP(zeroed(nb, 4)), KEEP(zeroed(nb, 8)), KEEP(zeroed(nb, 4)), 0, nb};
    seams_intern intern = {KEEP(zeroed(slots, 8)), KEEP(zeroed(ids, 8)), KEEP(zeroed(ids, 8)), KEEP(zeroed(ids, 4)),
                           KEEP(zeroed(ids, 4)), KEEP(zeroed(ids, 4)), slots, ids, 0, 0};
    seams_diff_scratch scratch = {&intern, KEEP(zeroed(na, 4)), KEEP(zeroed(nb, 4)), KEEP(zeroed(na, 4)), KEEP(zeroed(nb, 4)),
                                  KEEP(zeroed(na, 1)), KEEP(zeroed(nb, 1)), KEEP(zeroed(ids + 3, 8)), KEEP(zeroed(ids + 3, 8)), ids + 3};
    const uint64_t cap = (na < nb ? na : nb) + 1;
    d->script = (seams_script){KEEP(zeroed(cap, 4)), KEEP(zeroed(cap, 4)), KEEP(zeroed(cap, 4)), KEEP(zeroed(cap, 4)), 0, cap};
#undef KEEP
    seams_diff_input in = {a->bytes, a->len, b->bytes, b->len, &ta, &tb, 0};
    if (seams_diff(&in, &scratch, &d->script) != SEAMS_OK) fail("diff");
}

static void free_diff(diff *d) {
    for (int i = 0; i < d->count; ++i) free(d->blocks[i]);
}

static uint64_t random_line(uint8_t *out, unsigned alphabet) {
    static const char *const words[] = {"a", "b", "c", "}", "", "  x = 1;", "return", "if (y)", "zz", "end"};
    const char *w = words[next_random() % alphabet];
    const size_t n = strlen(w);
    memcpy(out, w, n);
    out[n] = '\n';
    return n + 1;
}

/* b is a with a few lines inserted, deleted or replaced, around one area or all over */
static uint64_t random_edit(const uint8_t *a, uint64_t a_len, uint8_t *b, unsigned alphabet, unsigned rate) {
    uint64_t b_len = 0;
    for (uint64_t p = 0; p < a_len;) {
        uint64_t end = p;
        while (end < a_len && a[end] != '\n') ++end;
        const uint64_t line = (end < a_len ? end + 1 : end) - p;
        const unsigned action = (unsigned)(next_random() % rate);
        if (action == 0) b_len += random_line(b + b_len, alphabet);
        if (action != 1) { memcpy(b + b_len, a + p, line); b_len += line; }
        if (action == 2) b_len += random_line(b + b_len, alphabet);
        p += line;
    }
    return b_len;
}

/* ---------------------------------------------------------------- patches */

static void check_patch(const uint8_t *a_bytes, uint64_t a_len, const uint8_t *b_bytes, uint64_t b_len) {
    file a, b;
    load(&a, a_bytes, a_len);
    load(&b, b_bytes, b_len);
    diff d;
    run_diff(&d, &a, &b);
    seams_patch_input w = {a.bytes, a.len, &a.lines, b.bytes, b.len, &b.lines, &d.script, 0, 0, 0, 0, 0};
    const uint64_t size = seams_patch_size(&w);
    uint8_t *patch = zeroed(size, 1);
    w.out = patch;
    w.out_capacity = size;
    if (seams_write_patch(&w) != SEAMS_OK || w.out_len != size) fail("write patch");
    w.out_capacity = size - 1;
    if (seams_write_patch(&w) != SEAMS_ENOSPC) fail("write patch ignored capacity");
    uint8_t *out = zeroed(b_len + 1, 1);
    seams_patch_input r = {a.bytes, a.len, &a.lines, 0, 0, 0, 0, patch, size, out, b_len, 0};
    if (seams_apply_patch(&r) != SEAMS_OK || r.out_len != b_len || memcmp(out, b_bytes, b_len) != 0) fail("patch round trip");
    r.patch_len = size - 1;
    if (seams_apply_patch(&r) == SEAMS_OK) fail("cut patch accepted");
    r.patch_len = size;
    if (d.script.count) {
        uint32_t *bytes = (uint32_t *)(patch + SEAMS_PATCH_HEADER_BYTES + 12);
        *bytes += 1;
        if (seams_apply_patch(&r) == SEAMS_OK) fail("damaged patch accepted");
        *bytes -= 1;
    }
    /* the same patch against a different base */
    if (a_len) {
        uint8_t *other = zeroed(a_len, 1);
        memcpy(other, a_bytes, a_len);
        other[a_len / 2] ^= 0x20;
        file o;
        load(&o, other, a_len);
        seams_patch_input wrong = {o.bytes, o.len, &o.lines, 0, 0, 0, 0, patch, size, out, b_len, 0};
        if (seams_apply_patch(&wrong) != SEAMS_EWRONGBASE) fail("patch applied to another base");
        unload(&o);
        free(other);
    }
    free(out);
    free(patch);
    free_diff(&d);
    unload(&a);
    unload(&b);
    ++cases;
}

/* ---------------------------------------------------------------- merge */

static ref_side as_ref(const file *f) { return (ref_side){f->bytes, f->len, f->lines.count, f->lines.line_start}; }
static ref_script as_ref_script(const seams_script *s) { return (ref_script){s->a_start, s->a_count, s->b_count, s->count}; }

/* merges with both engines, checks they agree, returns the merged text */
static uint8_t *merge(const uint8_t *o, uint64_t o_len, const uint8_t *x, uint64_t x_len, const uint8_t *y, uint64_t y_len,
                      uint64_t *merged_len, uint64_t *conflicts) {
    file base, ours, theirs;
    load(&base, o, o_len);
    load(&ours, x, x_len);
    load(&theirs, y, y_len);
    diff to_ours, to_theirs;
    run_diff(&to_ours, &base, &ours);
    run_diff(&to_theirs, &base, &theirs);
    /* every conflict adds about 50 bytes of markers, and there can be one per changed line */
    const uint64_t cap = 2 * (o_len + x_len + y_len) + 64 * (to_ours.script.count + to_theirs.script.count + 1);
    uint8_t *out = zeroed(cap, 1), *expected = zeroed(cap, 1);
    seams_merge_input in = {o, o_len, &base.lines, x, x_len, &ours.lines, y, y_len, &theirs.lines,
                            &to_ours.script, &to_theirs.script, out, cap, 0, 0};
    const int status = seams_merge(&in);
    if (status != SEAMS_OK) {
        fprintf(stderr, "status %d\nbase:\n%.*s|\nours:\n%.*s|\ntheirs:\n%.*s|\n", status, (int)o_len, o, (int)x_len, x, (int)y_len, y);
        for (uint64_t r = 0; r < to_ours.script.count; ++r)
            fprintf(stderr, "ours %u %u %u %u\n", to_ours.script.a_start[r], to_ours.script.b_start[r], to_ours.script.a_count[r], to_ours.script.b_count[r]);
        for (uint64_t r = 0; r < to_theirs.script.count; ++r)
            fprintf(stderr, "theirs %u %u %u %u\n", to_theirs.script.a_start[r], to_theirs.script.b_start[r], to_theirs.script.a_count[r], to_theirs.script.b_count[r]);
        fail("merge status");
    }
    const ref_side rb = as_ref(&base), ro = as_ref(&ours), rt = as_ref(&theirs);
    const ref_script so = as_ref_script(&to_ours.script), st = as_ref_script(&to_theirs.script);
    uint64_t expected_len = 0;
    const int64_t expected_conflicts = ref_merge(&rb, &ro, &rt, &so, &st, expected, cap, &expected_len);
    if (expected_conflicts < 0) fail("reference merge out of room");
    if (in.out_len != expected_len || memcmp(out, expected, expected_len) != 0) fail("merge differs from reference");
    if (in.conflicts != (uint64_t)expected_conflicts) fail("conflict count differs from reference");
    in.out_capacity = in.out_len ? in.out_len - 1 : 0;
    if (in.out_len && seams_merge(&in) != SEAMS_ENOSPC) fail("merge ignored capacity");
    free(expected);
    free_diff(&to_ours);
    free_diff(&to_theirs);
    unload(&base);
    unload(&ours);
    unload(&theirs);
    *merged_len = expected_len;
    *conflicts = (uint64_t)expected_conflicts;
    ++cases;
    return out;
}

static void expect_merge(const char *o, const char *x, const char *y, const char *want, uint64_t want_conflicts) {
    uint64_t len, conflicts;
    uint8_t *got = merge((const uint8_t *)o, strlen(o), (const uint8_t *)x, strlen(x), (const uint8_t *)y, strlen(y), &len, &conflicts);
    if (len != strlen(want) || memcmp(got, want, len) != 0 || conflicts != want_conflicts) {
        fprintf(stderr, "merge of\n%s|\n%s|\n%s|\ngave (%" PRIu64 " conflicts)\n%.*s|\nwanted\n%s|\n", o, x, y, conflicts, (int)len, got, want);
        fail("merge case");
    }
    free(got);
}

static void check_merge_cases(void) {
    expect_merge("", "", "", "", 0);
    expect_merge("a\nb\nc\n", "a\nb\nc\n", "a\nb\nc\n", "a\nb\nc\n", 0);
    expect_merge("a\nb\nc\n", "a\nB\nc\n", "a\nb\nc\n", "a\nB\nc\n", 0);
    expect_merge("a\nb\nc\n", "a\nb\nc\n", "a\nb\nC\n", "a\nb\nC\n", 0);
    expect_merge("1\n2\n3\n4\n5\n6\n7\n", "ONE\n2\n3\n4\n5\n6\n7\n", "1\n2\n3\n4\n5\n6\nSEVEN\n", "ONE\n2\n3\n4\n5\n6\nSEVEN\n", 0);
    expect_merge("a\nb\nc\n", "a\nX\nc\n", "a\nX\nc\n", "a\nX\nc\n", 0);
    expect_merge("a\nb\nc\n", "a\nX\nc\n", "a\nY\nc\n",
                 "a\n<<<<<<< ours\nX\n||||||| base\nb\n=======\nY\n>>>>>>> theirs\nc\n", 1);
    expect_merge("a\nb\nc\n", "a\nb\nc\nours\n", "a\nb\nc\ntheirs\n",
                 "a\nb\nc\n<<<<<<< ours\nours\n||||||| base\n=======\ntheirs\n>>>>>>> theirs\n", 1);
    /* a last line with no newline still leaves every marker at the start of a line */
    expect_merge("a\nb", "a\nX", "a\nY", "a\n<<<<<<< ours\nX\n||||||| base\nb\n=======\nY\n>>>>>>> theirs\n", 1);
}

static void check_merge_fuzz(uint64_t rounds) {
    enum { MAX = 8192 };
    static uint8_t o[MAX], x[2 * MAX], y[2 * MAX];
    for (uint64_t k = 0; k < rounds; ++k) {
        const unsigned alphabet = 3 + (unsigned)(next_random() % 8);
        uint64_t o_len = 0;
        const unsigned lines = (unsigned)(next_random() % 120);
        for (unsigned l = 0; l < lines; ++l) o_len += random_line(o + o_len, alphabet);
        if (next_random() % 6 == 0 && o_len) --o_len;
        const unsigned rate = 4 + (unsigned)(next_random() % 30);
        const uint64_t x_len = random_edit(o, o_len, x, alphabet, rate);
        const uint64_t y_len = random_edit(o, o_len, y, alphabet, rate);
        uint64_t len, conflicts;
        free(merge(o, o_len, x, x_len, y, y_len, &len, &conflicts));
        /* an untouched side gives the other back, untouched */
        uint8_t *same = merge(o, o_len, x, x_len, o, o_len, &len, &conflicts);
        if (len != x_len || memcmp(same, x, len) || conflicts) fail("merge with untouched theirs");
        free(same);
        same = merge(o, o_len, o, o_len, y, y_len, &len, &conflicts);
        if (len != y_len || memcmp(same, y, len) || conflicts) fail("merge with untouched ours");
        free(same);
        same = merge(o, o_len, x, x_len, x, x_len, &len, &conflicts);
        if (len != x_len || memcmp(same, x, len) || conflicts) fail("same edit on both sides");
        free(same);
        check_patch(o, o_len, x, x_len);
    }
}

int main(void) {
    const char *env = getenv("SEAMS_FUZZ_PAIRS");
    const uint64_t rounds = env ? strtoull(env, NULL, 10) : 20000;
    const uint64_t start = seed;
    check_merge_cases();
    check_merge_fuzz(rounds);
    printf("PASS v2: %" PRIu64 " cases (seed 0x%" PRIx64 "): patch round trip, wrong base / cut / damaged patches refused, "
           "merge == reference, untouched side, same edit, conflicts at line starts\n", cases, start);
    return 0;
}
