#ifndef SEAMS_SCAN_CASES_H
#define SEAMS_SCAN_CASES_H
static const struct {
    const char *name;
    const uint8_t *bytes;
    size_t length;
} scan_cases[] = {
    {"empty", (const uint8_t *)"", 0},
    {"one byte", (const uint8_t *)"x", 1},
    {"one LF", (const uint8_t *)"\n", 1},
    {"empty lines", (const uint8_t *)"\n\n\n", 3},
    {"missing final LF", (const uint8_t *)"one\ntwo", 7},
    {"final LF", (const uint8_t *)"one\ntwo\n", 8},
    {"CRLF", (const uint8_t *)"one\r\ntwo\r\n", 10},
    {"bare CR", (const uint8_t *)"one\rtwo", 7},
    {"embedded NUL", (const uint8_t *)"a\0b\nc\0", 6},
    {"last byte differs", (const uint8_t *)"sameA\nsameB", 11}
};
#endif
