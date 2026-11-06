bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_intern_reset:function
global seams_intern_lines:function
global seams_bytes_equal:function hidden

%define intern rdi
%define slot_ids rsi
%define slot rdx
%define slot_count rcx
%define status eax
seams_intern_reset:
    mov status, SEAMS_EINVAL
    test intern, intern
    jz .return_status
    mov slot_count, [intern + seams_intern.slot_count]
    mov slot_ids, [intern + seams_intern.slot_id]
    ; a power-of-two slot count with at least one free slot guarantees probing ends
    test slot_count, slot_count
    jz .return_status
    lea slot, [slot_count - 1]
    test slot_count, slot
    jnz .return_status
    cmp slot_count, [intern + seams_intern.id_capacity]
    jbe .return_status
    xor slot, slot
.clear_next_slot:
    mov dword [slot_ids + slot * SEAMS_U32_BYTES], SEAMS_EMPTY_SLOT
    inc slot
    cmp slot, slot_count
    jb .clear_next_slot
    mov qword [intern + seams_intern.id_total], 0
    mov status, SEAMS_OK
.return_status:
    ret
%undef intern
%undef slot_ids
%undef slot
%undef slot_count
%undef status

%define left rdi
%define right rsi
%define remaining rdx
%define left_byte cl
%define equal eax
seams_bytes_equal:
    mov equal, 1
.next_byte:
    test remaining, remaining
    jz .compared
    mov left_byte, [left]
    cmp left_byte, [right]
    jne .bytes_differ
    inc left
    inc right
    dec remaining
    jmp .next_byte
.bytes_differ:
    xor equal, equal
.compared:
    ret
%undef left
%undef right
%undef remaining
%undef left_byte
%undef equal

%define intern rbx
%define line_bytes r12
%define line_length r13
%define line_length32 r13d
%define line_hash r14
%define slot r15
%define id rax
%define id32 eax
%define column rcx
seams_intern_find_or_add:
    save_registers rbx, r12, r13, r14, r15
    mov intern, rdi
    mov line_bytes, rsi
    mov line_length, rdx
    mov line_hash, rcx
    mov slot, line_hash
.probe_slot:
    mov column, [intern + seams_intern.slot_count]
    dec column
    and slot, column
    mov column, [intern + seams_intern.slot_id]
    mov id32, [column + slot * SEAMS_U32_BYTES]
    cmp id32, SEAMS_EMPTY_SLOT
    je .add_new_id
    mov column, [intern + seams_intern.slot_hash]
    cmp [column + slot * SEAMS_U64_BYTES], line_hash
    jne .try_next_slot
    mov column, [intern + seams_intern.id_len]
    cmp [column + id * SEAMS_U32_BYTES], line_length32
    jne .try_next_slot
    mov column, [intern + seams_intern.id_bytes]
    mov rdi, [column + id * SEAMS_U64_BYTES]
    mov rsi, line_bytes
    mov rdx, line_length
    call seams_bytes_equal
    test eax, eax
    jnz .same_bytes_found
.try_next_slot:
    inc slot
    jmp .probe_slot
.same_bytes_found:
    mov column, [intern + seams_intern.slot_id]
    mov id32, [column + slot * SEAMS_U32_BYTES]
    jmp .return_id
.add_new_id:
    mov id, [intern + seams_intern.id_total]
    cmp id, [intern + seams_intern.id_capacity]
    jae .no_room_for_id
    inc qword [intern + seams_intern.id_total]
    mov column, [intern + seams_intern.slot_hash]
    mov [column + slot * SEAMS_U64_BYTES], line_hash
    mov column, [intern + seams_intern.slot_id]
    mov [column + slot * SEAMS_U32_BYTES], id32
    mov column, [intern + seams_intern.id_bytes]
    mov [column + id * SEAMS_U64_BYTES], line_bytes
    mov column, [intern + seams_intern.id_len]
    mov [column + id * SEAMS_U32_BYTES], line_length32
    mov column, [intern + seams_intern.id_count_a]
    mov dword [column + id * SEAMS_U32_BYTES], 0
    mov column, [intern + seams_intern.id_count_b]
    mov dword [column + id * SEAMS_U32_BYTES], 0
    jmp .return_id
.no_room_for_id:
    mov id, -1
.return_id:
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef intern
%undef line_bytes
%undef line_length
%undef line_length32
%undef line_hash
%undef slot
%undef id
%undef id32
%undef column

%define bytes r12
%define table r13
%define intern r14
%define side_counts r15
%define line rbx
%define column rcx
%define status eax
seams_intern_lines:
    save_registers rbx, r12, r13, r14, r15
    mov status, SEAMS_EINVAL
    test rsi, rsi
    jz .return_status
    test rdx, rdx
    jz .return_status
    mov bytes, rdi
    mov table, rsi
    mov intern, rdx
    mov side_counts, [intern + seams_intern.id_count_a]
    cmp ecx, SEAMS_SIDE_A
    je .side_chosen
    mov side_counts, [intern + seams_intern.id_count_b]
.side_chosen:
    xor line, line
.next_line:
    cmp line, [table + seams_line_table.count]
    jae .all_lines_interned
    mov rdi, intern
    mov column, [table + seams_line_table.line_start]
    mov esi, [column + line * SEAMS_U32_BYTES]
    add rsi, bytes
    mov column, [table + seams_line_table.line_len]
    mov edx, [column + line * SEAMS_U32_BYTES]
    mov column, [table + seams_line_table.line_hash]
    mov rcx, [column + line * SEAMS_U64_BYTES]
    call seams_intern_find_or_add
    cmp rax, -1
    je .out_of_ids
    mov column, [table + seams_line_table.line_id]
    mov [column + line * SEAMS_U32_BYTES], eax
    inc dword [side_counts + rax * SEAMS_U32_BYTES]
    inc line
    jmp .next_line
.out_of_ids:
    mov status, SEAMS_ENOSPC
    jmp .return_status
.all_lines_interned:
    mov status, SEAMS_OK
.return_status:
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef bytes
%undef table
%undef intern
%undef side_counts
%undef line
%undef column
%undef status

section .note.GNU-stack noalloc noexec nowrite progbits
