bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_diff:function
extern seams_scan_scalar
extern seams_scan_avx2
extern seams_hash_lines
extern seams_intern_reset
extern seams_intern_lines
extern seams_discard
extern seams_compare_box
extern seams_emit

%macro stop_on_error 0
    test status, status
    jnz .return_status
%endmacro

; scan and hash one file into its line table
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
    mov rdi, [input + seams_diff_input.%1_bytes]
    mov rsi, [input + seams_diff_input.%1_lines]
    call seams_hash_lines
    stop_on_error
%endmacro

%macro intern_side 2
    mov rdi, [input + seams_diff_input.%1_bytes]
    mov rsi, [input + seams_diff_input.%1_lines]
    mov rdx, [scratch + seams_diff_scratch.intern]
    mov ecx, %2
    call seams_intern_lines
    stop_on_error
%endmacro

%define input rbx
%define scratch r12
%define script r13
%define status eax
seams_diff:
    save_registers rbx, r12, r13
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
    mov rdi, [scratch + seams_diff_scratch.intern]
    call seams_intern_reset
    stop_on_error
    intern_side a, SEAMS_SIDE_A
    intern_side b, SEAMS_SIDE_B
    mov rdi, input
    mov rsi, scratch
    mov rdx, script
    call seams_diff_match
.return_status:
    restore_registers rbx, r12, r13
    ret
%undef input
%undef scratch
%undef script
%undef status

%define input rbx
%define scratch r12
%define script r13
%define kept_a r14
%define kept_b r15
%define match rsp
%define a_table rcx
%define b_table rdx
%define column rax
%define status eax
seams_diff_match:
    save_registers rbx, r12, r13, r14, r15
    sub rsp, seams_match_size
    mov input, rdi
    mov scratch, rsi
    mov script, rdx
    mov a_table, [input + seams_diff_input.a_lines]
    mov b_table, [input + seams_diff_input.b_lines]
    mov column, [a_table + seams_line_table.count]
    add column, [b_table + seams_line_table.count]
    add column, 3
    cmp column, [scratch + seams_diff_scratch.kv_capacity]
    ja .scratch_too_small
    mov rdi, [input + seams_diff_input.a_lines]
    mov rsi, [scratch + seams_diff_scratch.intern]
    mov rsi, [rsi + seams_intern.id_count_b]
    mov rdx, [scratch + seams_diff_scratch.work_a]
    mov rcx, [scratch + seams_diff_scratch.map_a]
    mov r8, [scratch + seams_diff_scratch.changed_a]
    call seams_discard
    mov kept_a, rax
    mov rdi, [input + seams_diff_input.b_lines]
    mov rsi, [scratch + seams_diff_scratch.intern]
    mov rsi, [rsi + seams_intern.id_count_a]
    mov rdx, [scratch + seams_diff_scratch.work_b]
    mov rcx, [scratch + seams_diff_scratch.map_b]
    mov r8, [scratch + seams_diff_scratch.changed_b]
    call seams_discard
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
    add rsp, seams_match_size
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef match
%undef a_table
%undef b_table
%undef column
%undef status

; copies scratch pointers into the match record on the caller's stack and centres
; both kv arrays so diagonals -(kept_b + 1) .. kept_a + 1 are valid indexes
%define match rdi
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
    mov [match + seams_match.changed_a], field
    mov field, [scratch + seams_diff_scratch.changed_b]
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

section .note.GNU-stack noalloc noexec nowrite progbits
