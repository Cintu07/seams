bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_common_prefix:function hidden
global seams_common_suffix:function hidden
global seams_trim_ends:function hidden

%define ids_a rdi
%define ids_b rsi
%define limit rdx
%define matched rax
%define id_a ecx
seams_common_prefix:
    xor matched, matched
.compare_next:
    cmp matched, limit
    jae .prefix_found
    mov id_a, [ids_a + matched * SEAMS_U32_BYTES]
    cmp id_a, [ids_b + matched * SEAMS_U32_BYTES]
    jne .prefix_found
    inc matched
    jmp .compare_next
.prefix_found:
    ret
%undef ids_a
%undef ids_b
%undef limit
%undef matched
%undef id_a

; ids_a and ids_b point one past the last id of each run
%define ids_a_end rdi
%define ids_b_end rsi
%define limit rdx
%define matched rax
%define id_a ecx
seams_common_suffix:
    xor matched, matched
.compare_previous:
    cmp matched, limit
    jae .suffix_found
    sub ids_a_end, SEAMS_U32_BYTES
    sub ids_b_end, SEAMS_U32_BYTES
    mov id_a, [ids_a_end]
    cmp id_a, [ids_b_end]
    jne .suffix_found
    inc matched
    jmp .compare_previous
.suffix_found:
    ret
%undef ids_a_end
%undef ids_b_end
%undef limit
%undef matched
%undef id_a

; Lines in the longest common byte prefix and suffix of two scanned files.
; They pair up one to one in a minimal script, so only the lines between them
; need hashing, interning and matching. rdi = seams_diff_input with a_lines
; already scanned. Returns rax = prefix lines, rdx = suffix lines (same count in
; both files); the two never overlap.
%define a_end r8
%define b_end r9
%define a_len r10
%define b_len r11
%define starts rsi
%define lengths rdi
%define limit rcx
%define matched rax
%define word rdx
%define low rbx
%define high r12
%define middle r13
%define line_count r14
%define prefix_lines r15
seams_trim_ends:
    save_registers rbx, r12, r13, r14, r15
    mov a_end, [rdi + seams_diff_input.a_bytes]
    mov b_end, [rdi + seams_diff_input.b_bytes]
    mov a_len, [rdi + seams_diff_input.a_len]
    mov b_len, [rdi + seams_diff_input.b_len]
    mov word, [rdi + seams_diff_input.a_lines]
    mov starts, [word + seams_line_table.line_start]
    mov line_count, [word + seams_line_table.count]
    mov lengths, [word + seams_line_table.line_len]
    mov limit, a_len
    cmp limit, b_len
    cmova limit, b_len
    xor matched, matched
.prefix_word:
    lea word, [matched + SEAMS_U64_BYTES]
    cmp word, limit
    ja .prefix_byte
    mov word, [a_end + matched]
    xor word, [b_end + matched]
    jnz .prefix_word_differs
    add matched, SEAMS_U64_BYTES
    jmp .prefix_word
.prefix_word_differs:
    ; lowest differing bit; the bytes below it are equal
    bsf word, word
    shr word, 3
    add matched, word
    jmp .prefix_found
.prefix_byte:
    cmp matched, limit
    jae .prefix_found
    movzx edx, byte [a_end + matched]
    cmp dl, [b_end + matched]
    jne .prefix_found
    inc matched
    jmp .prefix_byte
.prefix_found:
    ; lines that end at or before the first differing byte
    xor low, low
    mov high, line_count
.prefix_search:
    cmp low, high
    jae .prefix_searched
    lea middle, [low + high]
    shr middle, 1
    mov edx, [starts + middle * SEAMS_U32_BYTES]
    add edx, [lengths + middle * SEAMS_U32_BYTES]
    cmp word, matched
    ja .prefix_upper
    lea low, [middle + 1]
    jmp .prefix_search
.prefix_upper:
    mov high, middle
    jmp .prefix_search
.prefix_searched:
    ; a last line without LF matches only if the other file also ends there
    cmp low, line_count
    jne .prefix_lines_known
    test low, low
    jz .prefix_lines_known
    cmp a_len, b_len
    je .prefix_lines_known
    cmp byte [a_end + a_len - 1], SEAMS_LF
    je .prefix_lines_known
    dec low
.prefix_lines_known:
    mov prefix_lines, low
    ; the suffix may not reach back into the prefix lines
    xor edx, edx
    test low, low
    jz .prefix_bytes_known
    mov edx, [starts + low * SEAMS_U32_BYTES - SEAMS_U32_BYTES]
    add edx, [lengths + low * SEAMS_U32_BYTES - SEAMS_U32_BYTES]
.prefix_bytes_known:
    sub limit, word
    add a_end, a_len
    add b_end, b_len
    xor matched, matched
.suffix_word:
    lea word, [matched + SEAMS_U64_BYTES]
    cmp word, limit
    ja .suffix_byte
    mov middle, a_end
    sub middle, matched
    mov word, [middle - SEAMS_U64_BYTES]
    mov middle, b_end
    sub middle, matched
    xor word, [middle - SEAMS_U64_BYTES]
    jnz .suffix_word_differs
    add matched, SEAMS_U64_BYTES
    jmp .suffix_word
.suffix_word_differs:
    ; highest differing bit; the bytes above it are equal
    bsr word, word
    xor word, 63
    shr word, 3
    add matched, word
    jmp .suffix_found
.suffix_byte:
    cmp matched, limit
    jae .suffix_found
    mov middle, a_end
    sub middle, matched
    movzx edx, byte [middle - 1]
    mov middle, b_end
    sub middle, matched
    cmp dl, [middle - 1]
    jne .suffix_found
    inc matched
    jmp .suffix_byte
.suffix_found:
    ; first line of a that starts inside the equal tail
    mov limit, a_len
    sub limit, matched
    mov low, prefix_lines
    mov high, line_count
.suffix_search:
    cmp low, high
    jae .suffix_searched
    lea middle, [low + high]
    shr middle, 1
    mov edx, [starts + middle * SEAMS_U32_BYTES]
    cmp word, limit
    jae .suffix_upper
    lea low, [middle + 1]
    jmp .suffix_search
.suffix_upper:
    mov high, middle
    jmp .suffix_search
.suffix_searched:
    ; a line starting exactly where the tail starts must also start a line in b
    cmp low, line_count
    jae .suffix_lines_known
    mov edx, [starts + low * SEAMS_U32_BYTES]
    cmp word, limit
    jne .suffix_lines_known
    cmp matched, b_len
    je .suffix_lines_known
    mov middle, b_end
    sub middle, matched
    cmp byte [middle - 1], SEAMS_LF
    je .suffix_lines_known
    inc low
.suffix_lines_known:
    mov rdx, line_count
    sub rdx, low
    mov rax, prefix_lines
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef a_end
%undef b_end
%undef a_len
%undef b_len
%undef starts
%undef lengths
%undef limit
%undef matched
%undef word
%undef low
%undef high
%undef middle
%undef line_count
%undef prefix_lines

section .note.GNU-stack noalloc noexec nowrite progbits
