bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_intern_reset:function
global seams_intern_lines:function
global seams_bytes_equal:function hidden

%define intern rdi
%define slots rsi
%define slot rdx
%define slot_count rcx
%define active_count r8
%define status eax
seams_intern_reset:
    mov status, SEAMS_EINVAL
    test intern, intern
    jz .return_status
    mov slot_count, [intern + seams_intern.slot_count]
    mov slots, [intern + seams_intern.slots]
    test slot_count, slot_count
    jz .return_status
    lea slot, [slot_count - 1]
    test slot_count, slot
    jnz .return_status
    ; at least two slots per id keeps load at or below one half, so probing ends
    mov slot, [intern + seams_intern.id_capacity]
    mov active_count, SEAMS_MAX_IDS
    cmp slot, active_count
    ja .return_status
    add slot, slot
    cmp slot_count, slot
    jb .return_status
    mov active_count, SEAMS_FIRST_ACTIVE_SLOTS
    cmp active_count, slot_count
    cmova active_count, slot_count
    lea slot, [active_count - 1]
    mov [intern + seams_intern.active_mask], slot
    mov qword [intern + seams_intern.id_total], 0
    xor slot, slot
.clear_next_slot:
    mov qword [slots + slot * SEAMS_U64_BYTES], SEAMS_EMPTY_SLOT
    inc slot
    cmp slot, active_count
    jb .clear_next_slot
    mov status, SEAMS_OK
.return_status:
    ret
%undef intern
%undef slots
%undef slot
%undef slot_count
%undef active_count
%undef status

; equal lengths are already checked; compares eight bytes at a time
%define left rdi
%define right rsi
%define remaining rdx
%define length rcx
%define left_word r8
%define left_byte r8b
%define equal eax
seams_bytes_equal:
    xor equal, equal
    mov length, remaining
.next_word:
    cmp remaining, SEAMS_U64_BYTES
    jb .words_compared
    mov left_word, [left]
    cmp left_word, [right]
    jne .compared
    add left, SEAMS_U64_BYTES
    add right, SEAMS_U64_BYTES
    sub remaining, SEAMS_U64_BYTES
    jmp .next_word
.words_compared:
    test remaining, remaining
    jz .same
    cmp length, SEAMS_U64_BYTES
    jb .next_byte
    ; long line: the last eight bytes overlap words already compared
    mov left_word, [left + remaining - SEAMS_U64_BYTES]
    cmp left_word, [right + remaining - SEAMS_U64_BYTES]
    jne .compared
    jmp .same
.next_byte:
    mov left_byte, [left]
    cmp left_byte, [right]
    jne .compared
    inc left
    inc right
    dec remaining
    jnz .next_byte
.same:
    mov equal, 1
.compared:
    ret
%undef left
%undef right
%undef remaining
%undef length
%undef left_word
%undef left_byte
%undef equal

%define intern rdi
%define slots rsi
%define mask rdx
%define id rcx
%define id_hashes r8
%define hash r9
%define slot r10
%define entry r11
seams_intern_grow:
    mov mask, [intern + seams_intern.active_mask]
    lea mask, [mask * 2 + 1]
    mov [intern + seams_intern.active_mask], mask
    mov slots, [intern + seams_intern.slots]
    xor slot, slot
.clear_next_slot:
    mov qword [slots + slot * SEAMS_U64_BYTES], SEAMS_EMPTY_SLOT
    inc slot
    cmp slot, mask
    jbe .clear_next_slot
    mov id_hashes, [intern + seams_intern.id_hash]
    xor id, id
.next_id:
    cmp id, [intern + seams_intern.id_total]
    jae .rebuilt
    mov hash, [id_hashes + id * SEAMS_U64_BYTES]
    mov slot, hash
.probe_slot:
    and slot, mask
    cmp qword [slots + slot * SEAMS_U64_BYTES], SEAMS_EMPTY_SLOT
    je .slot_found
    inc slot
    jmp .probe_slot
.slot_found:
    ; ids are already distinct, so no byte compares while rebuilding
    mov entry, hash
    shr entry, 32
    shl entry, 32
    or entry, id
    mov [slots + slot * SEAMS_U64_BYTES], entry
    inc id
    jmp .next_id
.rebuilt:
    ret
%undef intern
%undef slots
%undef mask
%undef id
%undef id_hashes
%undef hash
%undef slot
%undef entry

%define intern rbx
%define line_bytes r12
%define line_length r13
%define line_length32 r13d
%define line_hash r14
%define slot r15
%define entry rax
%define id rax
%define id32 eax
%define column rcx
%define tag rdx
seams_intern_find_or_add:
    save_registers rbx, r12, r13, r14, r15
    mov intern, rdi
    mov line_bytes, rsi
    mov line_length, rdx
    mov line_hash, rcx
    mov slot, line_hash
.probe_slot:
    and slot, [intern + seams_intern.active_mask]
    mov column, [intern + seams_intern.slots]
    mov entry, [column + slot * SEAMS_U64_BYTES]
    cmp entry, SEAMS_EMPTY_SLOT
    je .add_new_id
    mov tag, entry
    xor tag, line_hash
    shr tag, 32
    jnz .try_next_slot
    mov id32, id32
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
    mov column, [intern + seams_intern.slots]
    mov id32, [column + slot * SEAMS_U64_BYTES]
    jmp .return_id
.add_new_id:
    mov id, [intern + seams_intern.id_total]
    cmp id, [intern + seams_intern.id_capacity]
    jae .no_room_for_id
    ; keep load at or below one half: 2 * (ids after this one) <= active slots
    lea column, [id * 2 + 1]
    cmp column, [intern + seams_intern.active_mask]
    ja .grow_and_probe_again
    call seams_intern_store_id
    jmp .return_id
.grow_and_probe_again:
    mov rdi, intern
    call seams_intern_grow
    mov slot, line_hash
    jmp .probe_slot
.no_room_for_id:
    mov id, -1
.return_id:
    restore_registers rbx, r12, r13, r14, r15
    ret

; shares the caller's registers: intern, line_*, slot, and id in rax
seams_intern_store_id:
    inc qword [intern + seams_intern.id_total]
    mov tag, line_hash
    shr tag, 32
    shl tag, 32
    or tag, id
    mov column, [intern + seams_intern.slots]
    mov [column + slot * SEAMS_U64_BYTES], tag
    mov column, [intern + seams_intern.id_hash]
    mov [column + id * SEAMS_U64_BYTES], line_hash
    mov column, [intern + seams_intern.id_bytes]
    mov [column + id * SEAMS_U64_BYTES], line_bytes
    mov column, [intern + seams_intern.id_len]
    mov [column + id * SEAMS_U32_BYTES], line_length32
    mov column, [intern + seams_intern.id_count_a]
    mov dword [column + id * SEAMS_U32_BYTES], 0
    mov column, [intern + seams_intern.id_count_b]
    mov dword [column + id * SEAMS_U32_BYTES], 0
    ret
%undef intern
%undef line_bytes
%undef line_length
%undef line_length32
%undef line_hash
%undef slot
%undef entry
%undef id
%undef id32
%undef column
%undef tag

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
