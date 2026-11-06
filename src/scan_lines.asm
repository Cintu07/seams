bits 64
default rel
%include "layout.inc"
%include "regs.inc"
%include "simd.inc"

section .text
global seams_scan_scalar:function
global seams_scan_avx2:function

%macro append_scanned_line 2
    cmp line_count, capacity
    jae .capacity_exhausted
    mov [starts + line_count * SEAMS_U32_BYTES], line_start32
    mov line_length32, %2
    sub line_length32, line_start32
    mov [lengths + line_count * SEAMS_U32_BYTES], line_length32
    mov line_start, %1
    inc line_count
%endmacro

%macro scan_tail_bytes 0
%%next_byte:
    cmp cursor, length
    jae %%all_bytes_scanned
    cmp byte [bytes + cursor], SEAMS_LF
    jne %%ordinary_byte
    inc cursor
    append_scanned_line cursor, cursor32
    jmp %%next_byte
%%ordinary_byte:
    inc cursor
    jmp %%next_byte
%%all_bytes_scanned:
%endmacro

%define bytes rdi
%define length rsi
%define table rdx
%define cursor rcx
%define cursor32 ecx
%define starts r8
%define lengths r9
%define capacity r10
%define line_start r11
%define line_start32 r11d
%define line_count rax
%define status eax
%define line_length rbx
%define line_length32 ebx
%define length32 esi
seams_scan_scalar:
    save_registers line_length
    call scan_validate
    test status, status
    jnz .return_status
    xor cursor, cursor
    xor line_start, line_start
    scan_tail_bytes
    cmp line_start, length
    je .all_lines_scanned
    append_scanned_line length, length32
.all_lines_scanned:
    mov [table + seams_line_table.count], line_count
    mov status, SEAMS_OK
    jmp .return_status
.capacity_exhausted:
    mov status, SEAMS_ENOSPC
.return_status:
    restore_registers line_length
    ret
%undef bytes
%undef length
%undef table
%undef cursor
%undef cursor32
%undef starts
%undef lengths
%undef capacity
%undef line_start
%undef line_start32
%undef line_count
%undef status
%undef line_length
%undef line_length32
%undef length32

%define bytes rdi
%define length rsi
%define table rdx
%define cursor rcx
%define cursor32 ecx
%define starts r8
%define lengths r9
%define capacity r10
%define line_start r11
%define line_start32 r11d
%define line_count rax
%define status eax
%define line_length rbx
%define line_length32 ebx
%define length32 esi
%define mask r12d
%define mask_saved r12
%define match_offset r13
%define match_offset32 r13d
%define chunk ymm0
%define newline ymm1
%define newline_low xmm1
seams_scan_avx2:
    save_registers line_length, mask_saved, match_offset
    call scan_validate
    test status, status
    jnz .return_status
    xor cursor, cursor
    xor line_start, line_start
    broadcast_newline newline, newline_low, match_offset32
.next_vector:
    mov match_offset, length
    sub match_offset, cursor
    cmp match_offset, SEAMS_VECTOR_BYTES
    jb .tail_ready
    lea match_offset, [bytes + cursor]
    find_newline_mask chunk, match_offset, newline, mask
.remaining_matches:
    test mask, mask
    jz .vector_scanned
    tzcnt match_offset32, mask
    lea match_offset, [cursor + match_offset + 1]
    append_scanned_line match_offset, match_offset32
    blsr mask, mask
    jmp .remaining_matches
.vector_scanned:
    add cursor, SEAMS_VECTOR_BYTES
    jmp .next_vector
.tail_ready:
    scan_tail_bytes
    cmp line_start, length
    je .all_lines_scanned
    append_scanned_line length, length32
.all_lines_scanned:
    mov [table + seams_line_table.count], line_count
    mov status, SEAMS_OK
    jmp .return_status
.capacity_exhausted:
    mov status, SEAMS_ENOSPC
.return_status:
    vzeroupper
    restore_registers line_length, mask_saved, match_offset
    ret
%undef bytes
%undef length
%undef table
%undef cursor
%undef cursor32
%undef starts
%undef lengths
%undef capacity
%undef line_start
%undef line_start32
%undef line_count
%undef status
%undef line_length
%undef line_length32
%undef length32
%undef mask
%undef mask_saved
%undef match_offset
%undef match_offset32
%undef chunk
%undef newline
%undef newline_low

%define bytes rdi
%define length rsi
%define table rdx
%define starts r8
%define lengths r9
%define capacity r10
%define scratch rax
%define status eax
scan_validate:
    test table, table
    jz .invalid_input
    mov qword [table + seams_line_table.count], 0
    mov status, SEAMS_MAX_BYTES
    cmp length, scratch
    ja .input_too_large
    test length, length
    jz .valid_input
    test bytes, bytes
    jz .invalid_input
    mov starts, [table + seams_line_table.line_start]
    mov lengths, [table + seams_line_table.line_len]
    mov capacity, [table + seams_line_table.capacity]
    test starts, starts
    jz .invalid_input
    test lengths, lengths
    jz .invalid_input
    mov scratch, starts
    or scratch, lengths
    test scratch, SEAMS_ALIGNMENT - 1
    jnz .invalid_input
.valid_input:
    mov status, SEAMS_OK
    ret
.input_too_large:
    mov status, SEAMS_E2BIG
    ret
.invalid_input:
    mov status, SEAMS_EINVAL
    ret
%undef bytes
%undef length
%undef table
%undef starts
%undef lengths
%undef capacity
%undef scratch
%undef status

section .note.GNU-stack noalloc noexec nowrite progbits
