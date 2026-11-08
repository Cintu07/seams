bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_merge:function

%define SEAMS_NO_RECORD -1

; append rdx bytes from rsi to the merge output; ENOSPC when they do not fit
%define input rdi
%define source rsi
%define count rdx
%define room rax
%define status eax
seams_merge_append:
    mov room, [input + seams_merge_input.out_capacity]
    sub room, [input + seams_merge_input.out_len]
    cmp count, room
    ja .out_of_space
    push rdi
    mov rcx, count
    mov rax, [input + seams_merge_input.out]
    add rax, [input + seams_merge_input.out_len]
    add [input + seams_merge_input.out_len], count
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

; the bytes of lines [from, to) of one side: rax = address, rdx = length
%define side rsi
%define from rdx
%define to rcx
%define table r8
%define starts r9
%define first rax
%define past r10
seams_merge_line_bytes:
    mov table, [side + seams_merge_side.lines]
    mov starts, [table + seams_line_table.line_start]
    mov first, [side + seams_merge_side.len]
    cmp from, [table + seams_line_table.count]
    jae .first_known
    mov eax, [starts + from * SEAMS_U32_BYTES]
.first_known:
    mov past, [side + seams_merge_side.len]
    cmp to, [table + seams_line_table.count]
    jae .past_known
    mov r10d, [starts + to * SEAMS_U32_BYTES]
.past_known:
    mov rdx, past
    sub rdx, first
    add first, [side + seams_merge_side.bytes]
    ret
%undef side
%undef from
%undef to
%undef table
%undef starts
%undef first
%undef past

; append lines [rdx, rcx) of the side at rsi
seams_merge_append_lines:
    call seams_merge_line_bytes
    mov rsi, rax
    jmp seams_merge_append

; a conflict marker has to start a line, even after a last line with no newline
seams_merge_end_line:
    mov rax, [rdi + seams_merge_input.out_len]
    test rax, rax
    jz .line_ended
    mov rcx, [rdi + seams_merge_input.out]
    cmp byte [rcx + rax - 1], SEAMS_LF
    je .line_ended
    lea rsi, [newline]
    mov edx, 1
    jmp seams_merge_append
.line_ended:
    xor eax, eax
    ret

%macro stop_on_error 0
    test eax, eax
    jnz .return_status
%endmacro

; lines [%2, %3) of side %1 (base, ours or theirs)
%macro append_side 3
    mov rdi, input
    lea rsi, [input + seams_merge_input.%1]
    mov rdx, %2
    mov rcx, %3
    call seams_merge_append_lines
    stop_on_error
%endmacro

%macro append_marker 1
    mov rdi, input
    call seams_merge_end_line
    stop_on_error
    mov rdi, input
    lea rsi, [%1]
    mov edx, %1_len
    call seams_merge_append
    stop_on_error
%endmacro

; the a_start, a_count or b_count (%5) of record %4 of script %3, into %1 (%2 is its 32-bit name)
%macro record_field 5
    mov %1, [%3 + seams_script.%5]
    mov %2, [%1 + %4 * SEAMS_U32_BYTES]
%endmacro

; take the record at %1 of script %2 into the chunk if it starts inside it or where it ends
%macro absorb_record 3
    cmp %1, [%2 + seams_script.count]
    jae %%not_absorbed
    record_field r8, r8d, %2, %1, a_start
    cmp r8, chunk_end
    ja %%not_absorbed
    record_field r9, r9d, %2, %1, a_count
    add r8, r9
    mov r10, [input + seams_merge_input.base + seams_merge_side.lines]
    cmp r8, [r10 + seams_line_table.count]
    ja .bad_script
    cmp r8, chunk_end
    cmovb r8, chunk_end
    mov chunk_end, r8
    record_field r8, r8d, %2, %1, b_count
    sub r8, r9
    add [frame + seams_merge_frame.%3_growth], r8
    mov qword [frame + seams_merge_frame.%3_changed], 1
    inc %1
    jmp .grow_chunk
%%not_absorbed:
%endmacro

; ours (or theirs) lines [%1, %2) for this chunk: base lines [chunk_start, chunk_end) moved by the
; side's delta so far, and the end by what this chunk adds or removes there
%macro side_range 3
    mov %1, chunk_start
    add %1, [frame + seams_merge_frame.%3_delta]
    mov %2, chunk_end
    add %2, [frame + seams_merge_frame.%3_delta]
    add %2, [frame + seams_merge_frame.%3_growth]
    mov rax, [input + seams_merge_input.%3 + seams_merge_side.lines]
    cmp %2, [rax + seams_line_table.count]
    ja .bad_script
%endmacro

%define input rbx
%define ours_record r12
%define theirs_record r13
%define base_pos r14
%define chunk_end r15
%define chunk_start rbp
%define frame rsp
seams_merge:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, seams_merge_frame_size
    mov eax, SEAMS_EINVAL
    test rdi, rdi
    jz .return_status
    mov input, rdi
    cmp qword [input + seams_merge_input.to_ours], 0
    je .return_status
    cmp qword [input + seams_merge_input.to_theirs], 0
    je .return_status
    cmp qword [input + seams_merge_input.base + seams_merge_side.lines], 0
    je .return_status
    cmp qword [input + seams_merge_input.ours + seams_merge_side.lines], 0
    je .return_status
    cmp qword [input + seams_merge_input.theirs + seams_merge_side.lines], 0
    je .return_status
    xor eax, eax
    mov [input + seams_merge_input.out_len], rax
    mov [input + seams_merge_input.conflicts], rax
    mov [frame + seams_merge_frame.ours_delta], rax
    mov [frame + seams_merge_frame.theirs_delta], rax
    xor ours_record, ours_record
    xor theirs_record, theirs_record
    xor base_pos, base_pos
.next_chunk:
    ; a chunk starts at the first change either side still has
    mov chunk_start, SEAMS_NO_RECORD
    mov rcx, [input + seams_merge_input.to_ours]
    cmp ours_record, [rcx + seams_script.count]
    jae .ours_finished
    record_field chunk_start, ebp, rcx, ours_record, a_start
.ours_finished:
    mov rcx, [input + seams_merge_input.to_theirs]
    cmp theirs_record, [rcx + seams_script.count]
    jae .theirs_finished
    record_field rax, eax, rcx, theirs_record, a_start
    cmp rax, chunk_start
    cmovb chunk_start, rax
.theirs_finished:
    cmp chunk_start, SEAMS_NO_RECORD
    je .copy_last_unchanged_run
    cmp chunk_start, base_pos
    jb .bad_script
    append_side base, base_pos, chunk_start
    mov chunk_end, chunk_start
    xor eax, eax
    mov [frame + seams_merge_frame.ours_growth], rax
    mov [frame + seams_merge_frame.theirs_growth], rax
    mov [frame + seams_merge_frame.ours_changed], rax
    mov [frame + seams_merge_frame.theirs_changed], rax
.grow_chunk:
    ; changes that overlap or touch, on either side, belong to one chunk
    mov rcx, [input + seams_merge_input.to_ours]
    absorb_record ours_record, rcx, ours
    mov rcx, [input + seams_merge_input.to_theirs]
    absorb_record theirs_record, rcx, theirs
    cmp qword [frame + seams_merge_frame.theirs_changed], 0
    je .take_ours
    cmp qword [frame + seams_merge_frame.ours_changed], 0
    je .take_theirs
    ; both sides changed it: one copy if they made the same change, a conflict if not
    side_range rdx, rcx, ours
    lea rsi, [input + seams_merge_input.ours]
    call seams_merge_line_bytes
    mov [frame + seams_merge_frame.ours_text], rax
    mov [frame + seams_merge_frame.ours_text_len], rdx
    side_range rdx, rcx, theirs
    lea rsi, [input + seams_merge_input.theirs]
    call seams_merge_line_bytes
    mov rcx, [frame + seams_merge_frame.ours_text_len]
    cmp rcx, rdx
    jne .conflict
    mov rsi, [frame + seams_merge_frame.ours_text]
    mov rdi, rax
    repe cmpsb
    jne .conflict
.take_ours:
    side_range r8, r9, ours
    append_side ours, r8, r9
    jmp .chunk_done
.take_theirs:
    side_range r8, r9, theirs
    append_side theirs, r8, r9
    jmp .chunk_done
.conflict:
    append_marker ours_marker
    side_range r8, r9, ours
    append_side ours, r8, r9
    append_marker base_marker
    append_side base, chunk_start, chunk_end
    append_marker split_marker
    side_range r8, r9, theirs
    append_side theirs, r8, r9
    append_marker theirs_marker
    inc qword [input + seams_merge_input.conflicts]
.chunk_done:
    mov rax, [frame + seams_merge_frame.ours_growth]
    add [frame + seams_merge_frame.ours_delta], rax
    mov rax, [frame + seams_merge_frame.theirs_growth]
    add [frame + seams_merge_frame.theirs_delta], rax
    mov base_pos, chunk_end
    jmp .next_chunk
.copy_last_unchanged_run:
    mov rax, [input + seams_merge_input.base + seams_merge_side.lines]
    mov rax, [rax + seams_line_table.count]
    append_side base, base_pos, rax
    xor eax, eax
    jmp .return_status
.bad_script:
    mov eax, SEAMS_EBADSCRIPT
.return_status:
    add rsp, seams_merge_frame_size
    restore_registers rbx, rbp, r12, r13, r14, r15
    ret
%undef input
%undef ours_record
%undef theirs_record
%undef base_pos
%undef chunk_end
%undef chunk_start
%undef frame

section .rodata
newline: db SEAMS_LF
ours_marker: db "<<<<<<< ours", SEAMS_LF
ours_marker_len equ $ - ours_marker
base_marker: db "||||||| base", SEAMS_LF
base_marker_len equ $ - base_marker
split_marker: db "=======", SEAMS_LF
split_marker_len equ $ - split_marker
theirs_marker: db ">>>>>>> theirs", SEAMS_LF
theirs_marker_len equ $ - theirs_marker

section .note.GNU-stack noalloc noexec nowrite progbits
