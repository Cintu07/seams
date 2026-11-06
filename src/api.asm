bits 64
default rel
%include "layout.inc"

section .text
global seams_probe:function

%define status eax
seams_probe:
    mov status, SEAMS_OK
    ret
%undef status

section .rodata align=32
global seams_line_layout:data
seams_line_layout:
    dq seams_line_table.line_start
    dq seams_line_table.line_len
    dq seams_line_table.line_hash
    dq seams_line_table.line_id
    dq seams_line_table.count
    dq seams_line_table.capacity
    dq seams_line_table_size
    dq SEAMS_ALIGNMENT

section .note.GNU-stack noalloc noexec nowrite progbits
