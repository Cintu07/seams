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
%define SEAMS_EMPTY_SLOT -1
%define SEAMS_FIRST_ACTIVE_SLOTS 16
%define SEAMS_MAX_IDS 0xfffffffe
%define SEAMS_SIDE_A 0
%define SEAMS_SIDE_B 1
%define SEAMS_FLAG_AVX2 1
%define SEAMS_FLAG_FAST 2
; with FAST, a middle-snake search gives up after max(this, 2^(bits(n)/2)) rounds
%define SEAMS_MIN_COST_LIMIT 4096
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

; open addressing: one u64 per slot (hash high half, id low half), the rest per id
; only the first active_mask+1 slots are in use; the table doubles at half load
struc seams_intern
    .slots: resq 1
    .id_hash: resq 1
    .id_bytes: resq 1
    .id_len: resq 1
    .id_count_a: resq 1
    .id_count_b: resq 1
    .slot_count: resq 1
    .id_capacity: resq 1
    .id_total: resq 1
    .active_mask: resq 1
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

%define SEAMS_EWRONGBASE -5
%define SEAMS_PATCH_MAGIC 0x4d414553           ; "SEAM" read as a little-endian u32
%define SEAMS_PATCH_VERSION 1
%define SEAMS_PATCH_HEADER_BYTES 40
%define SEAMS_PATCH_RECORD_BYTES 16

struc seams_patch_input
    .a_bytes: resq 1
    .a_len: resq 1
    .a_lines: resq 1
    .b_bytes: resq 1
    .b_len: resq 1
    .b_lines: resq 1
    .script: resq 1
    .patch: resq 1
    .patch_len: resq 1
    .out: resq 1
    .out_capacity: resq 1
    .out_len: resq 1
endstruc

struc seams_patch_header
    .magic: resd 1
    .version: resd 1
    .a_len: resq 1
    .a_hash: resq 1
    .b_len: resq 1
    .record_count: resq 1
endstruc

struc seams_patch_record
    .a_start: resd 1
    .a_count: resd 1
    .b_count: resd 1
    .byte_count: resd 1
endstruc

; a file as merge sees it: bytes, length, line table. base, ours and theirs are three of these
struc seams_merge_side
    .bytes: resq 1
    .len: resq 1
    .lines: resq 1
endstruc

struc seams_merge_input
    .base: resb seams_merge_side_size
    .ours: resb seams_merge_side_size
    .theirs: resb seams_merge_side_size
    .to_ours: resq 1
    .to_theirs: resq 1
    .out: resq 1
    .out_capacity: resq 1
    .out_len: resq 1
    .conflicts: resq 1
endstruc

; internal: seams_merge's running state, on its stack. the deltas are signed: how far
; ours (theirs) has moved relative to base so far, in lines
struc seams_merge_frame
    .ours_delta: resq 1
    .theirs_delta: resq 1
    .ours_growth: resq 1        ; this chunk's lines added minus removed, ours
    .theirs_growth: resq 1
    .ours_changed: resq 1
    .theirs_changed: resq 1
    .ours_text: resq 1          ; where ours' version of a chunk changed on both sides starts
    .ours_text_len: resq 1
    .padding: resq 1
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
    .cost_limit: resq 1         ; 0 means search until the paths meet (exact)
    .padding: resq 1
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
