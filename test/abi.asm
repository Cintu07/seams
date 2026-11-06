bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global scan_abi_probe:function

%define function_arg rdi
%define bytes_arg rsi
%define length_arg rdx
%define table_arg rcx
%define function r11
%define bytes rdi
%define length rsi
%define table rdx
%define marker r10
%define saved_base rbx
%define saved_frame rbp
%define saved_one r12
%define saved_two r13
%define saved_three r14
%define saved_four r15
%define stack_pointer rsp
%define status eax
scan_abi_probe:
    save_registers saved_base, saved_frame, saved_one, saved_two, saved_three, saved_four
    sub stack_pointer, 8
    mov function, function_arg
    mov bytes, bytes_arg
    mov length, length_arg
    mov table, table_arg
    mov marker, 0x6a5a4a3a2a1a0a01
    mov saved_base, marker
    inc marker
    mov saved_frame, marker
    inc marker
    mov saved_one, marker
    inc marker
    mov saved_two, marker
    inc marker
    mov saved_three, marker
    inc marker
    mov saved_four, marker
    call function
    test status, status
    jnz .return_status
    mov marker, 0x6a5a4a3a2a1a0a01
    cmp saved_base, marker
    jne .preserved_register_changed
    inc marker
    cmp saved_frame, marker
    jne .preserved_register_changed
    inc marker
    cmp saved_one, marker
    jne .preserved_register_changed
    inc marker
    cmp saved_two, marker
    jne .preserved_register_changed
    inc marker
    cmp saved_three, marker
    jne .preserved_register_changed
    inc marker
    cmp saved_four, marker
    jne .preserved_register_changed
    jmp .return_status
.preserved_register_changed:
    mov status, SEAMS_EINVAL
.return_status:
    add stack_pointer, 8
    restore_registers saved_base, saved_frame, saved_one, saved_two, saved_three, saved_four
    ret

section .note.GNU-stack noalloc noexec nowrite progbits
