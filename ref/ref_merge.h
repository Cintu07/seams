#ifndef REF_MERGE_H
#define REF_MERGE_H
#include <stdint.h>

typedef struct { const uint8_t *bytes; uint64_t len; uint64_t count; const uint32_t *start; } ref_side;
typedef struct { const uint32_t *a_start, *a_count, *b_count; uint64_t count; } ref_script;

/* Conflict count, or -1 when out is too small. */
int64_t ref_merge(const ref_side *base, const ref_side *ours, const ref_side *theirs,
                  const ref_script *to_ours, const ref_script *to_theirs,
                  uint8_t *out, uint64_t capacity, uint64_t *out_len);

#endif
