bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_discard:function hidden
global seams_compare_box:function hidden
extern seams_common_prefix
extern seams_common_suffix

; lines whose id never occurs in the other file cannot be in any common subsequence
%define table rdi
%define other_counts rsi
%define work rdx
%define map rcx
%define changed r8
%define line r9
%define id r10
%define id32 r10d
%define line32 r9d
%define ids r11
%define kept rax
seams_discard:
    xor kept, kept
    xor line, line
    mov ids, [table + seams_line_table.line_id]
.next_line:
    cmp line, [table + seams_line_table.count]
    jae .all_lines_sorted
    mov id32, [ids + line * SEAMS_U32_BYTES]
    cmp dword [other_counts + id * SEAMS_U32_BYTES], 0
    jne .line_can_match
    mov byte [changed + line], 1
    jmp .line_sorted
.line_can_match:
    mov byte [changed + line], 0
    mov [work + kept * SEAMS_U32_BYTES], id32
    mov [map + kept * SEAMS_U32_BYTES], line32
    inc kept
.line_sorted:
    inc line
    jmp .next_line
.all_lines_sorted:
    ret
%undef table
%undef other_counts
%undef work
%undef map
%undef changed
%undef line
%undef id
%undef id32
%undef line32
%undef ids
%undef kept

%define map rdi
%define changed rsi
%define position rdx
%define limit rcx
%define line r8
%define line32 r8d
seams_mark_changed:
.next_position:
    cmp position, limit
    jge .all_marked
    mov line32, [map + position * SEAMS_U32_BYTES]
    mov byte [changed + line], 1
    inc position
    jmp .next_position
.all_marked:
    ret
%undef map
%undef changed
%undef position
%undef limit
%undef line
%undef line32

; widen the band of diagonals by one each side, or narrow it where the box ends
%macro grow_diagonal_range 4
    mov diagonal, [box + %2]
    cmp diagonal, [box + seams_box.dmin]
    jle %%low_edge_reached
    dec diagonal
    mov [box + %2], diagonal
    mov [%1 + diagonal * SEAMS_U64_BYTES - SEAMS_U64_BYTES], %4
    jmp %%low_side_ready
%%low_edge_reached:
    inc qword [box + %2]
%%low_side_ready:
    mov diagonal, [box + %3]
    cmp diagonal, [box + seams_box.dmax]
    jge %%high_edge_reached
    inc diagonal
    mov [box + %3], diagonal
    mov [%1 + diagonal * SEAMS_U64_BYTES + SEAMS_U64_BYTES], %4
    jmp %%high_side_ready
%%high_edge_reached:
    dec qword [box + %3]
%%high_side_ready:
%endmacro

%define match r12
%define box rbx
%define kv r13
%define diagonal r14
%define x r15
%define y rbp
%define ids_a rdi
%define ids_b rsi
%define id_a ecx
%define limit rdx
%define other rax
seams_forward_round:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, 8
    mov match, rdi
    mov box, rsi
    mov kv, [match + seams_match.kv_forward]
    mov other, SEAMS_KV_UNREACHED_LOW
    grow_diagonal_range kv, seams_box.fmin, seams_box.fmax, other
    mov diagonal, [box + seams_box.fmax]
.next_diagonal:
    cmp diagonal, [box + seams_box.fmin]
    jl .no_overlap_yet
    mov x, [kv + diagonal * SEAMS_U64_BYTES - SEAMS_U64_BYTES]
    cmp x, [kv + diagonal * SEAMS_U64_BYTES + SEAMS_U64_BYTES]
    jl .step_down
    inc x
    jmp .follow_snake
.step_down:
    mov x, [kv + diagonal * SEAMS_U64_BYTES + SEAMS_U64_BYTES]
.follow_snake:
    mov y, x
    sub y, diagonal
    mov limit, [box + seams_box.lim1]
    sub limit, x
    mov other, [box + seams_box.lim2]
    sub other, y
    cmp other, limit
    cmovl limit, other
    test limit, limit
    jle .snake_followed
    mov ids_a, [match + seams_match.work_a]
    mov ids_b, [match + seams_match.work_b]
    add limit, x
.extend_snake:
    mov id_a, [ids_a + x * SEAMS_U32_BYTES]
    cmp id_a, [ids_b + y * SEAMS_U32_BYTES]
    jne .snake_followed
    inc x
    inc y
    cmp x, limit
    jl .extend_snake
.snake_followed:
    mov [kv + diagonal * SEAMS_U64_BYTES], x
    cmp qword [box + seams_box.odd], 0
    je .try_next_diagonal
    cmp diagonal, [box + seams_box.bmin]
    jl .try_next_diagonal
    cmp diagonal, [box + seams_box.bmax]
    jg .try_next_diagonal
    mov other, [match + seams_match.kv_backward]
    cmp [other + diagonal * SEAMS_U64_BYTES], x
    jg .try_next_diagonal
    mov [box + seams_box.split1], x
    mov [box + seams_box.split2], y
    mov eax, 1
    jmp .return_found
.try_next_diagonal:
    sub diagonal, 2
    jmp .next_diagonal
.no_overlap_yet:
    xor eax, eax
.return_found:
    add rsp, 8
    restore_registers rbx, rbp, r12, r13, r14, r15
    ret

seams_backward_round:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, 8
    mov match, rdi
    mov box, rsi
    mov kv, [match + seams_match.kv_backward]
    mov other, SEAMS_KV_UNREACHED_HIGH
    grow_diagonal_range kv, seams_box.bmin, seams_box.bmax, other
    mov diagonal, [box + seams_box.bmax]
.next_diagonal:
    cmp diagonal, [box + seams_box.bmin]
    jl .no_overlap_yet
    mov x, [kv + diagonal * SEAMS_U64_BYTES - SEAMS_U64_BYTES]
    cmp x, [kv + diagonal * SEAMS_U64_BYTES + SEAMS_U64_BYTES]
    jl .follow_snake
    mov x, [kv + diagonal * SEAMS_U64_BYTES + SEAMS_U64_BYTES]
    dec x
.follow_snake:
    mov y, x
    sub y, diagonal
    mov limit, x
    sub limit, [box + seams_box.off1]
    mov other, y
    sub other, [box + seams_box.off2]
    cmp other, limit
    cmovl limit, other
    test limit, limit
    jle .snake_followed
    mov ids_a, [match + seams_match.work_a]
    mov ids_b, [match + seams_match.work_b]
    neg limit
    add limit, x
.extend_snake:
    mov id_a, [ids_a + x * SEAMS_U32_BYTES - SEAMS_U32_BYTES]
    cmp id_a, [ids_b + y * SEAMS_U32_BYTES - SEAMS_U32_BYTES]
    jne .snake_followed
    dec x
    dec y
    cmp x, limit
    jg .extend_snake
.snake_followed:
    mov [kv + diagonal * SEAMS_U64_BYTES], x
    cmp qword [box + seams_box.odd], 0
    jne .try_next_diagonal
    cmp diagonal, [box + seams_box.fmin]
    jl .try_next_diagonal
    cmp diagonal, [box + seams_box.fmax]
    jg .try_next_diagonal
    mov other, [match + seams_match.kv_forward]
    cmp x, [other + diagonal * SEAMS_U64_BYTES]
    jg .try_next_diagonal
    mov [box + seams_box.split1], x
    mov [box + seams_box.split2], y
    mov eax, 1
    jmp .return_found
.try_next_diagonal:
    sub diagonal, 2
    jmp .next_diagonal
.no_overlap_yet:
    xor eax, eax
.return_found:
    add rsp, 8
    restore_registers rbx, rbp, r12, r13, r14, r15
    ret
%undef match
%undef box
%undef kv
%undef diagonal
%undef x
%undef y
%undef limit
%undef other
%undef ids_a
%undef ids_b
%undef id_a

%define match r12
%define box rbx
%define value rax
%define kv rcx
%define forward_centre r13
%define corner rdx
seams_split:
    save_registers rbx, r12, r13
    mov match, rdi
    mov box, rsi
    mov value, [box + seams_box.off1]
    sub value, [box + seams_box.lim2]
    mov [box + seams_box.dmin], value
    mov value, [box + seams_box.lim1]
    sub value, [box + seams_box.off2]
    mov [box + seams_box.dmax], value
    mov value, [box + seams_box.off1]
    sub value, [box + seams_box.off2]
    mov [box + seams_box.fmin], value
    mov [box + seams_box.fmax], value
    mov kv, [match + seams_match.kv_forward]
    mov corner, [box + seams_box.off1]
    mov [kv + value * SEAMS_U64_BYTES], corner
    mov forward_centre, value
    mov value, [box + seams_box.lim1]
    sub value, [box + seams_box.lim2]
    mov [box + seams_box.bmin], value
    mov [box + seams_box.bmax], value
    mov kv, [match + seams_match.kv_backward]
    mov corner, [box + seams_box.lim1]
    mov [kv + value * SEAMS_U64_BYTES], corner
    ; the search meets after a forward step when the two diagonal centres differ by an odd count
    sub forward_centre, value
    and forward_centre, 1
    mov [box + seams_box.odd], forward_centre
.next_cost:
    mov rdi, match
    mov rsi, box
    call seams_forward_round
    test eax, eax
    jnz .split_found
    mov rdi, match
    mov rsi, box
    call seams_backward_round
    test eax, eax
    jz .next_cost
.split_found:
    restore_registers rbx, r12, r13
    ret
%undef match
%undef box
%undef value
%undef kv
%undef forward_centre
%undef corner

; limit = how many ids both runs can still have in common
%macro box_overlap_limit 0
    mov limit, lim1
    sub limit, off1
    mov other, lim2
    sub other, off2
    cmp other, limit
    cmovl limit, other
%endmacro

%define match rbx
%define off1 r12
%define lim1 r13
%define off2 r14
%define lim2 r15
%define box rsp
%define limit rdx
%define other rax
seams_compare_box:
    save_registers rbx, r12, r13, r14, r15
    sub rsp, seams_box_size
    mov match, rdi
    mov off1, rsi
    mov lim1, rdx
    mov off2, rcx
    mov lim2, r8
.strip_common_ends:
    box_overlap_limit
    test limit, limit
    jle .both_ends_stripped
    mov rdi, [match + seams_match.work_a]
    lea rdi, [rdi + off1 * SEAMS_U32_BYTES]
    mov rsi, [match + seams_match.work_b]
    lea rsi, [rsi + off2 * SEAMS_U32_BYTES]
    call seams_common_prefix
    add off1, rax
    add off2, rax
    box_overlap_limit
    mov rdi, [match + seams_match.work_a]
    lea rdi, [rdi + lim1 * SEAMS_U32_BYTES]
    mov rsi, [match + seams_match.work_b]
    lea rsi, [rsi + lim2 * SEAMS_U32_BYTES]
    call seams_common_suffix
    sub lim1, rax
    sub lim2, rax
.both_ends_stripped:
    cmp off1, lim1
    je .only_insertions_left
    cmp off2, lim2
    je .only_deletions_left
    mov [box + seams_box.off1], off1
    mov [box + seams_box.lim1], lim1
    mov [box + seams_box.off2], off2
    mov [box + seams_box.lim2], lim2
    mov rdi, match
    mov rsi, box
    call seams_split
    mov rdi, match
    mov rsi, off1
    mov rdx, [box + seams_box.split1]
    mov rcx, off2
    mov r8, [box + seams_box.split2]
    call seams_compare_box
    mov off1, [box + seams_box.split1]
    mov off2, [box + seams_box.split2]
    jmp .strip_common_ends
.only_insertions_left:
    mov rdi, [match + seams_match.map_b]
    mov rsi, [match + seams_match.changed_b]
    mov rdx, off2
    mov rcx, lim2
    call seams_mark_changed
    jmp .box_done
.only_deletions_left:
    mov rdi, [match + seams_match.map_a]
    mov rsi, [match + seams_match.changed_a]
    mov rdx, off1
    mov rcx, lim1
    call seams_mark_changed
.box_done:
    add rsp, seams_box_size
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef match
%undef off1
%undef lim1
%undef off2
%undef lim2
%undef box
%undef limit
%undef other

section .note.GNU-stack noalloc noexec nowrite progbits
