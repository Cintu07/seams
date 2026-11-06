bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_diff:function
extern seams_scan_scalar
extern seams_scan_avx2
extern seams_hash_line_range
extern seams_intern_reset
extern seams_intern_line_range
extern seams_trim_ends
extern seams_discard
extern seams_compare_box
extern seams_emit

%macro stop_on_error 0
    test status, status
    jnz .return_status
%endmacro

; scan one file into its line table
%macro prepare_side 1
    mov rdi, [input + seams_diff_input.%1_bytes]
    mov rsi, [input + seams_diff_input.%1_len]
    mov rdx, [input + seams_diff_input.%1_lines]
    test qword [input + seams_diff_input.flags], SEAMS_FLAG_AVX2
    jz %%use_scalar_scan
    call seams_scan_avx2
    jmp %%scanned
%%use_scalar_scan:
    call seams_scan_scalar
%%scanned:
    stop_on_error
%endmacro

; hash the lines between the common prefix and suffix
%macro hash_side 1
    mov rdi, [input + seams_diff_input.%1_bytes]
    mov rsi, [input + seams_diff_input.%1_lines]
    mov rdx, prefix_lines
    mov rcx, [rsi + seams_line_table.count]
    sub rcx, suffix_lines
    call seams_hash_line_range
    stop_on_error
%endmacro

%macro intern_side 2
    mov rdi, [input + seams_diff_input.%1_bytes]
    mov rsi, [input + seams_diff_input.%1_lines]
    mov rdx, [scratch + seams_diff_scratch.intern]
    mov ecx, %2
    mov r8, prefix_lines
    mov r9, [rsi + seams_line_table.count]
    sub r9, suffix_lines
    call seams_intern_line_range
    stop_on_error
%endmacro

%define input rbx
%define scratch r12
%define script r13
%define prefix_lines r14
%define suffix_lines r15
%define status eax
seams_diff:
    save_registers rbx, r12, r13, r14, r15
    mov status, SEAMS_EINVAL
    test rdi, rdi
    jz .return_status
    test rsi, rsi
    jz .return_status
    test rdx, rdx
    jz .return_status
    mov input, rdi
    mov scratch, rsi
    mov script, rdx
    cmp qword [input + seams_diff_input.a_lines], 0
    je .return_status
    cmp qword [input + seams_diff_input.b_lines], 0
    je .return_status
    prepare_side a
    prepare_side b
    mov rdi, input
    call seams_trim_ends
    mov prefix_lines, rax
    mov suffix_lines, rdx
    hash_side a
    hash_side b
    mov rdi, [scratch + seams_diff_scratch.intern]
    call seams_intern_reset
    stop_on_error
    intern_side a, SEAMS_SIDE_A
    intern_side b, SEAMS_SIDE_B
    mov rdi, input
    mov rsi, scratch
    mov rdx, script
    mov rcx, prefix_lines
    mov r8, suffix_lines
    call seams_diff_match
.return_status:
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef input
%undef scratch
%undef script
%undef prefix_lines
%undef suffix_lines
%undef status

; trimmed lines pair up with each other, so they are never changed
%macro keep_trimmed_lines 1
    mov rdi, [scratch + seams_diff_scratch.changed_%1]
    xor eax, eax
    mov rcx, prefix_lines
    rep stosb
    mov rcx, [input + seams_diff_input.%1_lines]
    mov rdi, [rcx + seams_line_table.count]
    mov rcx, suffix_lines
    sub rdi, rcx
    add rdi, [scratch + seams_diff_scratch.changed_%1]
    rep stosb
%endmacro

; sort the middle lines of one file into kept and discarded
%macro discard_side 2
    mov rdx, [input + seams_diff_input.%1_lines]
    mov r9, [rdx + seams_line_table.count]
    sub r9, prefix_lines
    sub r9, suffix_lines
    mov rdi, [rdx + seams_line_table.line_id]
    lea rdi, [rdi + prefix_lines * SEAMS_U32_BYTES]
    mov rsi, [scratch + seams_diff_scratch.intern]
    mov rsi, [rsi + seams_intern.id_count_%2]
    mov rdx, [scratch + seams_diff_scratch.work_%1]
    mov rcx, [scratch + seams_diff_scratch.map_%1]
    mov r8, [scratch + seams_diff_scratch.changed_%1]
    add r8, prefix_lines
    call seams_discard
%endmacro

%define input rbx
%define scratch r12
%define script r13
%define kept_a r14
%define kept_b r15
%define prefix_lines rbp
%define suffix_lines [rsp + seams_match_size]
%define match rsp
%define a_table rcx
%define b_table rdx
%define column rax
%define status eax
seams_diff_match:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, seams_match_size + SEAMS_U64_BYTES
    mov input, rdi
    mov scratch, rsi
    mov script, rdx
    mov prefix_lines, rcx
    mov suffix_lines, r8
    mov a_table, [input + seams_diff_input.a_lines]
    mov b_table, [input + seams_diff_input.b_lines]
    mov column, [a_table + seams_line_table.count]
    add column, [b_table + seams_line_table.count]
    add column, 3
    cmp column, [scratch + seams_diff_scratch.kv_capacity]
    ja .scratch_too_small
    keep_trimmed_lines a
    keep_trimmed_lines b
    discard_side a, b
    mov kept_a, rax
    discard_side b, a
    mov kept_b, rax
    call seams_fill_match
    mov rdi, match
    xor esi, esi
    mov rdx, kept_a
    xor ecx, ecx
    mov r8, kept_b
    call seams_compare_box
    mov rdi, [scratch + seams_diff_scratch.changed_a]
    mov a_table, [input + seams_diff_input.a_lines]
    mov rsi, [a_table + seams_line_table.count]
    mov b_table, [input + seams_diff_input.b_lines]
    mov rcx, [b_table + seams_line_table.count]
    mov rdx, [scratch + seams_diff_scratch.changed_b]
    mov r8, script
    call seams_emit
    jmp .return_status
.scratch_too_small:
    mov status, SEAMS_ENOSPC
.return_status:
    add rsp, seams_match_size + SEAMS_U64_BYTES
    restore_registers rbx, rbp, r12, r13, r14, r15
    ret
%undef prefix_lines
%undef suffix_lines
%undef match
%undef a_table
%undef b_table
%undef column
%undef status

; copies scratch pointers into the match record on the caller's stack and centres
; both kv arrays so diagonals -(kept_b + 1) .. kept_a + 1 are valid indexes
%define match rdi
%define prefix_lines rbp
%define field rax
%define centre rcx
seams_fill_match:
    lea match, [rsp + SEAMS_U64_BYTES]
    mov field, [scratch + seams_diff_scratch.work_a]
    mov [match + seams_match.work_a], field
    mov field, [scratch + seams_diff_scratch.work_b]
    mov [match + seams_match.work_b], field
    mov field, [scratch + seams_diff_scratch.map_a]
    mov [match + seams_match.map_a], field
    mov field, [scratch + seams_diff_scratch.map_b]
    mov [match + seams_match.map_b], field
    mov field, [scratch + seams_diff_scratch.changed_a]
    add field, prefix_lines
    mov [match + seams_match.changed_a], field
    mov field, [scratch + seams_diff_scratch.changed_b]
    add field, prefix_lines
    mov [match + seams_match.changed_b], field
    lea centre, [kept_b + 1]
    mov field, [scratch + seams_diff_scratch.kv_forward]
    lea field, [field + centre * SEAMS_U64_BYTES]
    mov [match + seams_match.kv_forward], field
    mov field, [scratch + seams_diff_scratch.kv_backward]
    lea field, [field + centre * SEAMS_U64_BYTES]
    mov [match + seams_match.kv_backward], field
    ret
%undef input
%undef scratch
%undef script
%undef kept_a
%undef kept_b
%undef match
%undef field
%undef centre
%undef prefix_lines

section .note.GNU-stack noalloc noexec nowrite progbits
