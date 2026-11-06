%ifndef SEAMS_LAYOUT_INC
%define SEAMS_LAYOUT_INC

%define SEAMS_OK 0
%define SEAMS_EINVAL -1
%define SEAMS_E2BIG -2
%define SEAMS_ENOSPC -3
%define SEAMS_EBADSCRIPT -4
%define SEAMS_ALIGNMENT 32
%define SEAMS_MAX_BYTES 0xffffffff
%define SEAMS_MAX_LINES 0xfffffffe
%define SEAMS_LF 10
%define SEAMS_U32_BYTES 4
%define SEAMS_U64_BYTES 8
%define SEAMS_VECTOR_BYTES 32
%define SEAMS_EMPTY_SLOT 0xffffffff
%define SEAMS_SIDE_A 0
%define SEAMS_SIDE_B 1
%define SEAMS_FLAG_AVX2 1
%define SEAMS_HASH_MULTIPLIER 0x9e3779b97f4a7c15
%define SEAMS_KV_UNREACHED_LOW -1
%define SEAMS_KV_UNREACHED_HIGH 0x7fffffffffffffff

struc seams_line_table
    .line_start: resq 1
    .line_len: resq 1
    .line_hash: resq 1
    .line_id: resq 1
    .count: resq 1
    .capacity: resq 1
endstruc

; open addressing table: slot_hash/slot_id per slot, the rest per id
struc seams_intern
    .slot_hash: resq 1
    .slot_id: resq 1
    .id_bytes: resq 1
    .id_len: resq 1
    .id_count_a: resq 1
    .id_count_b: resq 1
    .slot_count: resq 1
    .id_capacity: resq 1
    .id_total: resq 1
endstruc

; only changed regions are stored; unchanged runs are the gaps between records
struc seams_script
    .a_start: resq 1
    .b_start: resq 1
    .a_count: resq 1
    .b_count: resq 1
    .count: resq 1
    .capacity: resq 1
endstruc

struc seams_diff_input
    .a_bytes: resq 1
    .a_len: resq 1
    .b_bytes: resq 1
    .b_len: resq 1
    .a_lines: resq 1
    .b_lines: resq 1
    .flags: resq 1
endstruc

struc seams_diff_scratch
    .intern: resq 1
    .work_a: resq 1
    .work_b: resq 1
    .map_a: resq 1
    .map_b: resq 1
    .changed_a: resq 1
    .changed_b: resq 1
    .kv_forward: resq 1
    .kv_backward: resq 1
    .kv_capacity: resq 1
endstruc

struc seams_apply_input
    .a_bytes: resq 1
    .a_len: resq 1
    .a_lines: resq 1
    .b_bytes: resq 1
    .b_len: resq 1
    .b_lines: resq 1
    .script: resq 1
    .out: resq 1
    .out_capacity: resq 1
    .out_len: resq 1
endstruc

; internal: what the matching recursion reads, built by seams_diff on its stack
struc seams_match
    .work_a: resq 1
    .work_b: resq 1
    .map_a: resq 1
    .map_b: resq 1
    .changed_a: resq 1
    .changed_b: resq 1
    .kv_forward: resq 1
    .kv_backward: resq 1
endstruc

; internal: one middle-snake search box, all values signed 64-bit
struc seams_box
    .off1: resq 1
    .lim1: resq 1
    .off2: resq 1
    .lim2: resq 1
    .dmin: resq 1
    .dmax: resq 1
    .odd: resq 1
    .fmin: resq 1
    .fmax: resq 1
    .bmin: resq 1
    .bmax: resq 1
    .split1: resq 1
    .split2: resq 1
    .padding: resq 3
endstruc

%endif
