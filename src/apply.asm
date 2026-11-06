bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_apply:function

; copy whole lines [from, to) of one file; lines are contiguous so this is one byte range
%define input r10
%define bytes r11
%define end rdx
%define end32 edx
%define table rcx
%define from r8
%define to r9
%define line_starts rax
%define start rsi
%define start32 esi
%define status eax
seams_append_lines:
    mov input, rdi
    mov bytes, rsi
    cmp from, to
    je .lines_appended
    mov line_starts, [table + seams_line_table.line_start]
    ; end arrives as the file length, which is where the last line ends
    cmp to, [table + seams_line_table.count]
    jae .end_known
    mov end32, [line_starts + to * SEAMS_U32_BYTES]
.end_known:
    mov start32, [line_starts + from * SEAMS_U32_BYTES]
%undef table
%undef line_starts
%define copy_count rcx
%define room rax
    mov copy_count, end
    sub copy_count, start
    mov room, [input + seams_apply_input.out_capacity]
    sub room, [input + seams_apply_input.out_len]
    cmp copy_count, room
    ja .out_of_space
    mov rdi, [input + seams_apply_input.out]
    add rdi, [input + seams_apply_input.out_len]
    add [input + seams_apply_input.out_len], copy_count
    add start, bytes
    rep movsb
.lines_appended:
    mov status, SEAMS_OK
    ret
.out_of_space:
    mov status, SEAMS_ENOSPC
    ret
%undef input
%undef bytes
%undef end
%undef end32
%undef from
%undef to
%undef start
%undef start32
%undef copy_count
%undef room
%undef status

%macro record_field 2
    mov rax, [script + %2]
    mov %1, [rax + record * SEAMS_U32_BYTES]
%endmacro

%macro append_from 3
    mov rdi, input
    mov rsi, [input + seams_apply_input.%1_bytes]
    mov rdx, [input + seams_apply_input.%1_len]
    mov rcx, [input + seams_apply_input.%1_lines]
    mov r8, %2
    mov r9, %3
    call seams_append_lines
    test status, status
    jnz .return_status
%endmacro

%define input rbx
%define a_pos r12
%define b_pos r13
%define record r14
%define script r15
%define field ebp
%define field64 rbp
%define a_table rdx
%define b_table rcx
%define status eax
seams_apply:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, 8
    mov status, SEAMS_EINVAL
    test rdi, rdi
    jz .return_status
    mov input, rdi
    mov script, [input + seams_apply_input.script]
    test script, script
    jz .return_status
    cmp qword [input + seams_apply_input.a_lines], 0
    je .return_status
    cmp qword [input + seams_apply_input.b_lines], 0
    je .return_status
    mov qword [input + seams_apply_input.out_len], 0
    xor a_pos, a_pos
    xor b_pos, b_pos
    xor record, record
.next_record:
    cmp record, [script + seams_script.count]
    jae .copy_last_unchanged_run
    record_field field, seams_script.a_start
    cmp field64, a_pos
    jb .bad_script
    ; unchanged lines pair one to one, so b must advance by the same amount as a
    sub field64, a_pos
    add field64, b_pos
    record_field eax, seams_script.b_start
    cmp rax, field64
    jne .bad_script
    record_field field, seams_script.a_start
    append_from a, a_pos, field64
    record_field field, seams_script.a_start
    record_field eax, seams_script.a_count
    lea a_pos, [field64 + rax]
    mov a_table, [input + seams_apply_input.a_lines]
    cmp a_pos, [a_table + seams_line_table.count]
    ja .bad_script
    record_field field, seams_script.b_start
    record_field eax, seams_script.b_count
    lea b_pos, [field64 + rax]
    mov b_table, [input + seams_apply_input.b_lines]
    cmp b_pos, [b_table + seams_line_table.count]
    ja .bad_script
    record_field field, seams_script.b_start
    append_from b, field64, b_pos
    inc record
    jmp .next_record
.copy_last_unchanged_run:
    mov a_table, [input + seams_apply_input.a_lines]
    mov field64, [a_table + seams_line_table.count]
    sub field64, a_pos
    add field64, b_pos
    mov b_table, [input + seams_apply_input.b_lines]
    cmp field64, [b_table + seams_line_table.count]
    jne .bad_script
    mov field64, [a_table + seams_line_table.count]
    append_from a, a_pos, field64
    mov status, SEAMS_OK
    jmp .return_status
.bad_script:
    mov status, SEAMS_EBADSCRIPT
.return_status:
    add rsp, 8
    restore_registers rbx, rbp, r12, r13, r14, r15
    ret
%undef input
%undef a_pos
%undef b_pos
%undef record
%undef script
%undef field
%undef field64
%undef a_table
%undef b_table
%undef status

section .note.GNU-stack noalloc noexec nowrite progbits
