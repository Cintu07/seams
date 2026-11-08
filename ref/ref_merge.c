/* Three-way merge, written plainly. The spec src/merge.asm is checked against: same chunks,
   same output bytes, same conflict count. Lines are byte ranges; scripts are base -> side. */
#include "ref_merge.h"
#include <string.h>

typedef struct { uint8_t *out; uint64_t cap, len; int full; } sink;

static void put(sink *s, const uint8_t *p, uint64_t n) {
    if (s->len + n > s->cap) { s->full = 1; return; }
    memcpy(s->out + s->len, p, n);
    s->len += n;
}

static uint64_t offset(const ref_side *f, uint64_t line) {
    return line < f->count ? f->start[line] : f->len;
}

static void put_lines(sink *s, const ref_side *f, uint64_t from, uint64_t to) {
    put(s, f->bytes + offset(f, from), offset(f, to) - offset(f, from));
}

static void put_marker(sink *s, const char *m) {
    if (s->len && s->out[s->len - 1] != '\n') put(s, (const uint8_t *)"\n", 1);
    put(s, (const uint8_t *)m, strlen(m));
}

int64_t ref_merge(const ref_side *base, const ref_side *ours, const ref_side *theirs,
                  const ref_script *to_ours, const ref_script *to_theirs,
                  uint8_t *out, uint64_t capacity, uint64_t *out_len) {
    sink s = {out, capacity, 0, 0};
    uint64_t i = 0, j = 0, pos = 0, conflicts = 0;
    int64_t ours_delta = 0, theirs_delta = 0;
    for (;;) {
        uint64_t start = UINT64_MAX;
        if (i < to_ours->count) start = to_ours->a_start[i];
        if (j < to_theirs->count && to_theirs->a_start[j] < start) start = to_theirs->a_start[j];
        if (start == UINT64_MAX) break;
        put_lines(&s, base, pos, start);
        uint64_t end = start;
        int64_t ours_growth = 0, theirs_growth = 0;
        int ours_changed = 0, theirs_changed = 0;
        for (;;) {
            if (i < to_ours->count && to_ours->a_start[i] <= end) {
                const uint64_t e = (uint64_t)to_ours->a_start[i] + to_ours->a_count[i];
                if (e > end) end = e;
                ours_growth += (int64_t)to_ours->b_count[i] - (int64_t)to_ours->a_count[i];
                ours_changed = 1;
                ++i;
                continue;
            }
            if (j < to_theirs->count && to_theirs->a_start[j] <= end) {
                const uint64_t e = (uint64_t)to_theirs->a_start[j] + to_theirs->a_count[j];
                if (e > end) end = e;
                theirs_growth += (int64_t)to_theirs->b_count[j] - (int64_t)to_theirs->a_count[j];
                theirs_changed = 1;
                ++j;
                continue;
            }
            break;
        }
        const uint64_t o0 = (uint64_t)((int64_t)start + ours_delta), o1 = (uint64_t)((int64_t)end + ours_delta + ours_growth);
        const uint64_t t0 = (uint64_t)((int64_t)start + theirs_delta), t1 = (uint64_t)((int64_t)end + theirs_delta + theirs_growth);
        if (!theirs_changed) put_lines(&s, ours, o0, o1);
        else if (!ours_changed) put_lines(&s, theirs, t0, t1);
        else {
            const uint64_t ol = offset(ours, o1) - offset(ours, o0), tl = offset(theirs, t1) - offset(theirs, t0);
            if (ol == tl && memcmp(ours->bytes + offset(ours, o0), theirs->bytes + offset(theirs, t0), ol) == 0)
                put_lines(&s, ours, o0, o1);
            else {
                put_marker(&s, "<<<<<<< ours\n");
                put_lines(&s, ours, o0, o1);
                put_marker(&s, "||||||| base\n");
                put_lines(&s, base, start, end);
                put_marker(&s, "=======\n");
                put_lines(&s, theirs, t0, t1);
                put_marker(&s, ">>>>>>> theirs\n");
                ++conflicts;
            }
        }
        ours_delta += ours_growth;
        theirs_delta += theirs_growth;
        pos = end;
    }
    put_lines(&s, base, pos, base->count);
    *out_len = s.len;
    return s.full ? -1 : (int64_t)conflicts;
}
