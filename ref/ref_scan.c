#include "ref_scan.h"

int ref_scan(const uint8_t *bytes, uint64_t length, seams_line_table *lines) {
    if (!lines) return SEAMS_EINVAL;
    lines->count = 0;
    if (length > SEAMS_MAX_BYTES) return SEAMS_E2BIG;
    if (length && (!bytes || !lines->line_start || !lines->line_len)) return SEAMS_EINVAL;
    uint64_t start = 0, count = 0;
    for (uint64_t i = 0; i < length; ++i) {
        if (bytes[i] != '\n') continue;
        if (count == lines->capacity) return SEAMS_ENOSPC;
        lines->line_start[count] = (uint32_t)start;
        lines->line_len[count++] = (uint32_t)(i + 1 - start);
        start = i + 1;
    }
    if (start != length) {
        if (count == lines->capacity) return SEAMS_ENOSPC;
        lines->line_start[count] = (uint32_t)start;
        lines->line_len[count++] = (uint32_t)(length - start);
    }
    lines->count = count;
    return SEAMS_OK;
}
