bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_patch_size:function
global seams_write_patch:function
global seams_apply_patch:function
extern seams_hash_line

; %1 (64-bit, %2 its 32-bit name) = byte offset where line %4 of the file with table %3 starts;
; the line past the last one starts at the file's end, %5
%macro line_offset 5
    mov %1, %5
    cmp %4, [%3 + seams_line_table.count]
    jae %%past_last_line
    mov %1, [%3 + seams_line_table.line_start]
    mov %2, [%1 + %4 * SEAMS_U32_BYTES]
%%past_last_line:
%endmacro

; append rdx bytes from rsi to the output; ENOSPC when they do not fit
%define input rdi
%define source rsi
%define count rdx
%define room rax
%define status eax
seams_patch_append:
    mov room, [input + seams_patch_input.out_capacity]
    sub room, [input + seams_patch_input.out_len]
    cmp count, room
    ja .out_of_space
    push rdi
    mov rcx, count
    mov rax, [input + seams_patch_input.out]
    add rax, [input + seams_patch_input.out_len]
    add [input + seams_patch_input.out_len], count
    mov rdi, rax
    rep movsb
    pop rdi
    mov status, SEAMS_OK
    ret
.out_of_space:
    mov status, SEAMS_ENOSPC
    ret
%undef input
%undef source
%undef count
%undef room
%undef status

; the bytes of b's lines [b_start, b_start + b_count) of one record, as rax = start, rdx = length
%define input rdi
%define record rsi
%define script r8
%define table r9
%define line r10
%define first rax
%define past rdx
seams_record_inserted_bytes:
    mov script, [input + seams_patch_input.script]
    mov table, [input + seams_patch_input.b_lines]
    mov line, [script + seams_script.b_start]
    mov r10d, [line + record * SEAMS_U32_BYTES]
    line_offset first, eax, table, line, [input + seams_patch_input.b_len]
    mov past, [script + seams_script.b_count]
    mov edx, [past + record * SEAMS_U32_BYTES]
    add line, past
    line_offset past, edx, table, line, [input + seams_patch_input.b_len]
    sub past, first
    ret
%undef input
%undef record
%undef script
%undef table
%undef line
%undef first
%undef past

%define input rbx
%define record r12
%define total r13
seams_patch_size:
    save_registers rbx, r12, r13
    mov input, rdi
    mov rax, [input + seams_patch_input.script]
    mov total, [rax + seams_script.count]
    shl total, 4
    add total, SEAMS_PATCH_HEADER_BYTES
    xor record, record
.next_record:
    mov rax, [input + seams_patch_input.script]
    cmp record, [rax + seams_script.count]
    jae .all_counted
    mov rdi, input
    mov rsi, record
    call seams_record_inserted_bytes
    add total, rdx
    inc record
    jmp .next_record
.all_counted:
    mov rax, total
    restore_registers rbx, r12, r13
    ret
%undef input
%undef record
%undef total

%define input rbx
%define record r12
%define script r13
%define cursor r14
%define header r15
%define status eax
seams_write_patch:
    save_registers rbx, r12, r13, r14, r15
    mov status, SEAMS_EINVAL
    test rdi, rdi
    jz .return_status
    mov input, rdi
    mov script, [input + seams_patch_input.script]
    test script, script
    jz .return_status
    mov qword [input + seams_patch_input.out_len], 0
    call seams_patch_size
    cmp rax, [input + seams_patch_input.out_capacity]
    ja .out_of_space
    mov header, [input + seams_patch_input.out]
    mov dword [header + seams_patch_header.magic], SEAMS_PATCH_MAGIC
    mov dword [header + seams_patch_header.version], SEAMS_PATCH_VERSION
    mov rax, [input + seams_patch_input.a_len]
    mov [header + seams_patch_header.a_len], rax
    mov rax, [input + seams_patch_input.b_len]
    mov [header + seams_patch_header.b_len], rax
    mov rax, [script + seams_script.count]
    mov [header + seams_patch_header.record_count], rax
    mov rdi, [input + seams_patch_input.a_bytes]
    mov rsi, [input + seams_patch_input.a_len]
    call seams_hash_line
    mov [header + seams_patch_header.a_hash], rax
    ; records first, then the inserted bytes after all of them
    lea cursor, [header + SEAMS_PATCH_HEADER_BYTES]
    mov rax, [script + seams_script.count]
    shl rax, 4
    add rax, SEAMS_PATCH_HEADER_BYTES
    mov [input + seams_patch_input.out_len], rax
    xor record, record
.next_record:
    cmp record, [script + seams_script.count]
    jae .patch_written
    mov rax, [script + seams_script.a_start]
    mov eax, [rax + record * SEAMS_U32_BYTES]
    mov [cursor + seams_patch_record.a_start], eax
    mov rax, [script + seams_script.a_count]
    mov eax, [rax + record * SEAMS_U32_BYTES]
    mov [cursor + seams_patch_record.a_count], eax
    mov rax, [script + seams_script.b_count]
    mov eax, [rax + record * SEAMS_U32_BYTES]
    mov [cursor + seams_patch_record.b_count], eax
    mov rdi, input
    mov rsi, record
    call seams_record_inserted_bytes
    mov [cursor + seams_patch_record.byte_count], edx
    mov rsi, [input + seams_patch_input.b_bytes]
    add rsi, rax
    mov rdi, input
    call seams_patch_append
    add cursor, SEAMS_PATCH_RECORD_BYTES
    inc record
    jmp .next_record
.patch_written:
    mov status, SEAMS_OK
    jmp .return_status
.out_of_space:
    mov status, SEAMS_ENOSPC
.return_status:
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef input
%undef record
%undef script
%undef cursor
%undef header
%undef status

; copy a's lines [from, to) to the output
%macro append_a_lines 2
    mov rcx, [input + seams_patch_input.a_lines]
    line_offset rsi, esi, rcx, %1, [input + seams_patch_input.a_len]
    line_offset rdx, edx, rcx, %2, [input + seams_patch_input.a_len]
    sub rdx, rsi
    add rsi, [input + seams_patch_input.a_bytes]
    mov rdi, input
    call seams_patch_append
    test status, status
    jnz .return_status
%endmacro

%define input rbx
%define record r12
%define records_left r13
%define a_pos r14
%define inserted r15
%define field rbp
%define status eax
seams_apply_patch:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, 8
    mov status, SEAMS_EINVAL
    test rdi, rdi
    jz .return_status
    mov input, rdi
    cmp qword [input + seams_patch_input.a_lines], 0
    je .return_status
    mov qword [input + seams_patch_input.out_len], 0
    mov status, SEAMS_EBADSCRIPT
    cmp qword [input + seams_patch_input.patch_len], SEAMS_PATCH_HEADER_BYTES
    jb .return_status
    mov record, [input + seams_patch_input.patch]
    cmp dword [record + seams_patch_header.magic], SEAMS_PATCH_MAGIC
    jne .return_status
    cmp dword [record + seams_patch_header.version], SEAMS_PATCH_VERSION
    jne .return_status
    ; the records must fit in the patch before any of them is read
    mov records_left, [record + seams_patch_header.record_count]
    mov rax, SEAMS_MAX_LINES
    cmp records_left, rax
    ja .bad_patch
    mov inserted, records_left
    shl inserted, 4
    add inserted, SEAMS_PATCH_HEADER_BYTES
    cmp inserted, [input + seams_patch_input.patch_len]
    ja .bad_patch
    add inserted, record
    mov rsi, [input + seams_patch_input.a_len]
    cmp rsi, [record + seams_patch_header.a_len]
    mov status, SEAMS_EWRONGBASE
    jne .return_status
    mov rdi, [input + seams_patch_input.a_bytes]
    call seams_hash_line
    mov rcx, [input + seams_patch_input.patch]
    cmp rax, [rcx + seams_patch_header.a_hash]
    mov status, SEAMS_EWRONGBASE
    jne .return_status
    add record, SEAMS_PATCH_HEADER_BYTES
    xor a_pos, a_pos
.next_record:
    test records_left, records_left
    jz .copy_last_unchanged_run
    ; records come in order and stay inside a
    mov ebp, [record + seams_patch_record.a_start]
    cmp field, a_pos
    jb .bad_patch
    mov eax, [record + seams_patch_record.a_count]
    add rax, field
    mov rcx, [input + seams_patch_input.a_lines]
    cmp rax, [rcx + seams_line_table.count]
    ja .bad_patch
    append_a_lines a_pos, field
    mov ebp, [record + seams_patch_record.a_start]
    mov eax, [record + seams_patch_record.a_count]
    lea a_pos, [field + rax]
    ; the inserted bytes must lie inside the patch
    mov edx, [record + seams_patch_record.byte_count]
    mov rax, [input + seams_patch_input.patch]
    add rax, [input + seams_patch_input.patch_len]
    sub rax, inserted
    cmp rdx, rax
    ja .bad_patch
    mov rsi, inserted
    add inserted, rdx
    mov rdi, input
    call seams_patch_append
    test status, status
    jnz .return_status
    add record, SEAMS_PATCH_RECORD_BYTES
    dec records_left
    jmp .next_record
.copy_last_unchanged_run:
    mov rcx, [input + seams_patch_input.a_lines]
    mov field, [rcx + seams_line_table.count]
    append_a_lines a_pos, field
    ; every inserted byte used, and b exactly as long as the header says
    mov rax, [input + seams_patch_input.patch]
    add rax, [input + seams_patch_input.patch_len]
    cmp inserted, rax
    jne .bad_patch
    mov rax, [input + seams_patch_input.patch]
    mov rax, [rax + seams_patch_header.b_len]
    cmp rax, [input + seams_patch_input.out_len]
    jne .bad_patch
    mov status, SEAMS_OK
    jmp .return_status
.bad_patch:
    mov status, SEAMS_EBADSCRIPT
.return_status:
    add rsp, 8
    restore_registers rbx, rbp, r12, r13, r14, r15
    ret
%undef input
%undef record
%undef records_left
%undef a_pos
%undef inserted
%undef field
%undef status

section .note.GNU-stack noalloc noexec nowrite progbits
