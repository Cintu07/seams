bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_hash_line:function
global seams_hash_lines:function
global seams_count_lines:function

%define cursor rdi
%define remaining rsi
%define hash rax
%define word rdx
%define multiplier r8
%define tail_byte r9
%define tail_shift rcx
seams_hash_line:
    mov hash, remaining
%ifdef SEAMS_BAD_HASH
    ; test build: almost every line collides, so intern must compare bytes
    and hash, 1
    ret
%endif
    mov multiplier, SEAMS_HASH_MULTIPLIER
.next_word:
    cmp remaining, SEAMS_U64_BYTES
    jb .words_hashed
    mov word, [cursor]
    xor hash, word
    imul hash, multiplier
    rol hash, 31
    add cursor, SEAMS_U64_BYTES
    sub remaining, SEAMS_U64_BYTES
    jmp .next_word
.words_hashed:
    xor word, word
    xor tail_shift, tail_shift
.next_tail_byte:
    test remaining, remaining
    jz .tail_gathered
    movzx tail_byte, byte [cursor]
    shl tail_byte, cl
    or word, tail_byte
    inc cursor
    dec remaining
    add tail_shift, 8
    jmp .next_tail_byte
.tail_gathered:
    xor hash, word
    imul hash, multiplier
    mov word, hash
    shr word, 32
    xor hash, word
    ret
%undef cursor
%undef remaining
%undef hash
%undef word
%undef multiplier
%undef tail_byte
%undef tail_shift

%define bytes r12
%define starts r13
%define lengths r14
%define hashes r15
%define line rbx
%define line_count rbp
%define table rsi
%define status eax
seams_hash_lines:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, 8
    mov status, SEAMS_EINVAL
    test table, table
    jz .return_status
    mov bytes, rdi
    mov line_count, [table + seams_line_table.count]
    mov starts, [table + seams_line_table.line_start]
    mov lengths, [table + seams_line_table.line_len]
    mov hashes, [table + seams_line_table.line_hash]
    xor line, line
    mov status, SEAMS_OK
    test line_count, line_count
    jz .return_status
    mov status, SEAMS_EINVAL
    test hashes, hashes
    jz .return_status
    test hashes, SEAMS_ALIGNMENT - 1
    jnz .return_status
.next_line:
    cmp line, line_count
    jae .all_lines_hashed
    mov edi, [starts + line * SEAMS_U32_BYTES]
    add rdi, bytes
    mov esi, [lengths + line * SEAMS_U32_BYTES]
    call seams_hash_line
    mov [hashes + line * SEAMS_U64_BYTES], rax
    inc line
    jmp .next_line
.all_lines_hashed:
    mov status, SEAMS_OK
.return_status:
    add rsp, 8
    restore_registers rbx, rbp, r12, r13, r14, r15
    ret
%undef bytes
%undef starts
%undef lengths
%undef hashes
%undef line
%undef line_count
%undef table
%undef status

%define cursor rdi
%define length rsi
%define end rdx
%define line_count rax
seams_count_lines:
    xor line_count, line_count
    test length, length
    jz .counted
    lea end, [cursor + length]
.next_byte:
    cmp byte [cursor], SEAMS_LF
    jne .ordinary_byte
    inc line_count
.ordinary_byte:
    inc cursor
    cmp cursor, end
    jb .next_byte
    cmp byte [end - 1], SEAMS_LF
    je .counted
    ; the last line has no LF but is still a line
    inc line_count
.counted:
    ret
%undef cursor
%undef length
%undef end
%undef line_count

section .note.GNU-stack noalloc noexec nowrite progbits
