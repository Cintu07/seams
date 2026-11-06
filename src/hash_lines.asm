bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_hash_line:function
global seams_hash_lines:function
global seams_count_lines:function

seams_hash_line:
    ; no bytes past the line are known to exist, so short tails go byte by byte
    lea rdx, [rdi + rsi]
    jmp seams_hash_line_in_buffer

; same value as gathering the tail byte by byte; loads stay below buffer_end
%define cursor rdi
%define remaining rsi
%define buffer_end rdx
%define hash rax
%define word r8
%define multiplier r9
%define shift rcx
%define line_length r10
%define tail_byte r11
seams_hash_line_in_buffer:
    mov hash, remaining
%ifdef SEAMS_BAD_HASH
    ; test build: almost every line collides, so intern must compare bytes
    and hash, 1
    ret
%endif
    mov multiplier, SEAMS_HASH_MULTIPLIER
    mov line_length, remaining
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
    test remaining, remaining
    jz .tail_gathered
    lea shift, [remaining * 8 - 64]
    neg shift
    cmp line_length, SEAMS_U64_BYTES
    jb .short_line
    ; the last eight bytes of the line; drop the ones already hashed
    mov word, [cursor + remaining - SEAMS_U64_BYTES]
    shr word, cl
    jmp .tail_gathered
.short_line:
    lea tail_byte, [cursor + SEAMS_U64_BYTES]
    cmp tail_byte, buffer_end
    ja .gather_tail_bytes
    mov word, [cursor]
    shl word, cl
    shr word, cl
    jmp .tail_gathered
.gather_tail_bytes:
    xor shift, shift
.next_tail_byte:
    movzx tail_byte, byte [cursor]
    shl tail_byte, cl
    or word, tail_byte
    inc cursor
    add shift, 8
    dec remaining
    jnz .next_tail_byte
.tail_gathered:
    xor hash, word
    imul hash, multiplier
    mov word, hash
    shr word, 32
    xor hash, word
    ret
%undef cursor
%undef remaining
%undef buffer_end
%undef hash
%undef word
%undef multiplier
%undef shift
%undef line_length
%undef tail_byte

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
    ; the last line ends where the buffer ends, so loads below that point are safe
    mov eax, [starts + line_count * SEAMS_U32_BYTES - SEAMS_U32_BYTES]
    mov ecx, [lengths + line_count * SEAMS_U32_BYTES - SEAMS_U32_BYTES]
    add rax, rcx
    add rax, bytes
    mov [rsp], rax
.next_line:
    cmp line, line_count
    jae .all_lines_hashed
    mov edi, [starts + line * SEAMS_U32_BYTES]
    add rdi, bytes
    mov esi, [lengths + line * SEAMS_U32_BYTES]
    mov rdx, [rsp]
    call seams_hash_line_in_buffer
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
