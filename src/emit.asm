bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_emit:function hidden

; append one record, or leave with ENOSPC
%macro store_record 0
    mov column, [script + seams_script.count]
    cmp column, [script + seams_script.capacity]
    jae .script_full
    mov record, column
    mov column, [script + seams_script.a_start]
    mov [column + record * SEAMS_U32_BYTES], record_a32
    mov column, [script + seams_script.b_start]
    mov [column + record * SEAMS_U32_BYTES], record_b32
    mov column, [script + seams_script.a_count]
    mov [column + record * SEAMS_U32_BYTES], a_pos32
    sub [column + record * SEAMS_U32_BYTES], record_a32
    mov column, [script + seams_script.b_count]
    mov [column + record * SEAMS_U32_BYTES], b_pos32
    sub [column + record * SEAMS_U32_BYTES], record_b32
    inc qword [script + seams_script.count]
%endmacro

%define changed_a rdi
%define a_lines rsi
%define changed_b rdx
%define b_lines rcx
%define script r8
%define a_pos r9
%define a_pos32 r9d
%define b_pos r10
%define b_pos32 r10d
%define record_a r11
%define record_a32 r11d
%define record_b rbx
%define record_b32 ebx
%define record rbp
%define column rax
%define status eax
seams_emit:
    save_registers rbx, rbp
    mov qword [script + seams_script.count], 0
    xor a_pos, a_pos
    xor b_pos, b_pos
.next_position:
    cmp a_pos, a_lines
    jb .a_has_line
    cmp b_pos, b_lines
    jae .all_records_emitted
    jmp .start_record
.a_has_line:
    cmp b_pos, b_lines
    jae .start_record
    cmp byte [changed_a + a_pos], 0
    jne .start_record
    cmp byte [changed_b + b_pos], 0
    jne .start_record
    inc a_pos
    inc b_pos
    jmp .next_position
.start_record:
    mov record_a, a_pos
    mov record_b, b_pos
.extend_deletions:
    cmp a_pos, a_lines
    jae .extend_insertions
    cmp byte [changed_a + a_pos], 0
    je .extend_insertions
    inc a_pos
    jmp .extend_deletions
.extend_insertions:
    cmp b_pos, b_lines
    jae .record_measured
    cmp byte [changed_b + b_pos], 0
    je .record_measured
    inc b_pos
    jmp .extend_insertions
.record_measured:
    ; unchanged lines left on only one side means the marks are inconsistent
    cmp a_pos, record_a
    jne .record_has_lines
    cmp b_pos, record_b
    je .marks_inconsistent
.record_has_lines:
    store_record
    jmp .next_position
.all_records_emitted:
    mov status, SEAMS_OK
    jmp .return_status
.script_full:
    mov status, SEAMS_ENOSPC
    jmp .return_status
.marks_inconsistent:
    mov status, SEAMS_EINVAL
.return_status:
    restore_registers rbx, rbp
    ret
%undef changed_a
%undef a_lines
%undef changed_b
%undef b_lines
%undef script
%undef a_pos
%undef a_pos32
%undef b_pos
%undef b_pos32
%undef record_a
%undef record_a32
%undef record_b
%undef record_b32
%undef record
%undef column
%undef status

section .note.GNU-stack noalloc noexec nowrite progbits
