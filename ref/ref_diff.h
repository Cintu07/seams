#ifndef REF_DIFF_H
#define REF_DIFF_H
#include <stdint.h>

/* Minimal number of deleted plus inserted lines. */
int64_t ref_edit_distance(const uint8_t *a, uint64_t a_len, const uint8_t *b, uint64_t b_len);

#endif
