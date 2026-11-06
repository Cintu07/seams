bits 64
default rel
%include "layout.inc"

section .text
global seams_common_prefix:function hidden
global seams_common_suffix:function hidden

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

section .note.GNU-stack noalloc noexec nowrite progbits
