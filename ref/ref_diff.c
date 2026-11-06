/* Plain textbook Myers (1986, figure 2) on lines. Slow and obvious on purpose:
   it only answers "how many lines must be deleted plus inserted". */
#include "ref_diff.h"
#include <stdlib.h>
#include <string.h>

typedef struct { const uint8_t *bytes; uint64_t length; } ref_line;

static ref_line *split_lines(const uint8_t *bytes, uint64_t length, uint64_t *count) {
    ref_line *lines = malloc((length + 1) * sizeof(ref_line));
    uint64_t start = 0, n = 0;
    for (uint64_t i = 0; i < length; ++i) {
        if (bytes[i] == '\n') {
            lines[n++] = (ref_line){bytes + start, i + 1 - start};
            start = i + 1;
        }
    }
    if (start < length) lines[n++] = (ref_line){bytes + start, length - start};
    *count = n;
    return lines;
}

static int same_line(ref_line a, ref_line b) {
    return a.length == b.length && memcmp(a.bytes, b.bytes, a.length) == 0;
}

int64_t ref_edit_distance(const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len) {
    uint64_t n, m;
    ref_line *la = split_lines(a, a_len, &n);
    ref_line *lb = split_lines(b, b_len, &m);
    const int64_t max = (int64_t)(n + m);
    int64_t *v = malloc((2 * (size_t)max + 3) * sizeof(int64_t));
    int64_t *vk = v + max + 1;
    vk[1] = 0;
    int64_t result = -1;
    for (int64_t d = 0; d <= max && result < 0; ++d) {
        for (int64_t k = -d; k <= d; k += 2) {
            int64_t x = (k == -d || (k != d && vk[k - 1] < vk[k + 1])) ? vk[k + 1] : vk[k - 1] + 1;
            int64_t y = x - k;
            while (x < (int64_t)n && y < (int64_t)m && same_line(la[x], lb[y])) { ++x; ++y; }
            vk[k] = x;
            if (x >= (int64_t)n && y >= (int64_t)m) { result = d; break; }
        }
    }
    free(v);
    free(la);
    free(lb);
    return result;
}
