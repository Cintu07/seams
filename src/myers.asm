bits 64
default rel
%include "layout.inc"
%include "regs.inc"

section .text
global seams_discard:function hidden
global seams_compare_box:function hidden
extern seams_common_prefix
extern seams_common_suffix

; lines whose id never occurs in the other file cannot be in any common subsequence.
; ids and changed point at the first line to sort; map gets indexes relative to it.
%define ids rdi
%define other_counts rsi
%define work rdx
%define map rcx
%define changed r8
%define line r9
%define id r10
%define id32 r10d
%define line32 r9d
%define line_count r11
%define kept rax
seams_discard:
    mov line_count, r9
    xor kept, kept
    xor line, line
.next_line:
    cmp line, line_count
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
%undef ids
%undef other_counts
%undef work
%undef map
%undef changed
%undef line
%undef id
%undef id32
%undef line32
%undef line_count
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
%define snake_start r8
%define snake_length r9
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
    mov snake_start, x
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
    mov snake_length, x
    sub snake_length, snake_start
    cmp snake_length, SEAMS_SNAKE_COUNT
    jle .snake_noted
    mov qword [box + seams_box.snake], 1
.snake_noted:
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
    mov snake_start, x
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
    mov snake_length, snake_start
    sub snake_length, x
    cmp snake_length, SEAMS_SNAKE_COUNT
    jle .snake_noted
    mov qword [box + seams_box.snake], 1
.snake_noted:
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
%undef snake_start
%undef snake_length

; FAST, past SEAMS_HEUR_MIN_COST, after a round that followed a long run of matches (xdiff's
; heuristic, which imara-diff uses too): a point on a front far enough along, measured as the steps
; from its corner less its distance from the centre diagonal, and above SEAMS_K_HEUR times the
; cost, whose last SEAMS_SNAKE_COUNT steps were all matches, is a good place to split. the
; forward front is tried first, then the backward one; the first, highest scoring point wins.
%define match rdi
%define box rsi
%define kv r8
%define diagonal r9
%define x r10
%define y r11
%define threshold r12
%define ids_a r13
%define ids_b r14
%define end_b r15
%define centre rbx
%define score rbp
%define step rcx
%define id_a edx
%define end_a rax
%define best [rsp]
seams_good_snake:
    save_registers rbx, rbp, r12, r13, r14, r15
    sub rsp, 8
    imul threshold, rdx, SEAMS_K_HEUR
    mov ids_a, [match + seams_match.work_a]
    mov ids_b, [match + seams_match.work_b]
    mov qword best, 0
    mov kv, [match + seams_match.kv_forward]
    mov centre, [box + seams_box.off1]
    sub centre, [box + seams_box.off2]
    mov diagonal, [box + seams_box.fmax]
.next_forward:
    cmp diagonal, [box + seams_box.fmin]
    jl .forward_seen
    mov x, [kv + diagonal * SEAMS_U64_BYTES]
    mov y, x
    sub y, diagonal
    ; score = steps from (off1, off2) less the distance from the centre diagonal
    mov step, diagonal
    sub step, centre
    mov score, step
    neg score
    cmovs score, step
    neg score
    add score, x
    add score, y
    sub score, [box + seams_box.off1]
    sub score, [box + seams_box.off2]
    cmp score, threshold
    jle .forward_skip
    cmp score, best
    jle .forward_skip
    mov step, [box + seams_box.off1]
    add step, SEAMS_SNAKE_COUNT
    cmp x, step
    jl .forward_skip
    cmp x, [box + seams_box.lim1]
    jge .forward_skip
    mov step, [box + seams_box.off2]
    add step, SEAMS_SNAKE_COUNT
    cmp y, step
    jl .forward_skip
    cmp y, [box + seams_box.lim2]
    jge .forward_skip
    ; the SEAMS_SNAKE_COUNT ids before (x, y) all match
    lea end_a, [ids_a + x * SEAMS_U32_BYTES]
    lea end_b, [ids_b + y * SEAMS_U32_BYTES]
    mov step, -1
.forward_compare:
    mov id_a, [end_a + step * SEAMS_U32_BYTES]
    cmp id_a, [end_b + step * SEAMS_U32_BYTES]
    jne .forward_skip
    cmp step, -SEAMS_SNAKE_COUNT
    je .forward_better
    dec step
    jmp .forward_compare
.forward_better:
    mov best, score
    mov [box + seams_box.split1], x
    mov [box + seams_box.split2], y
.forward_skip:
    sub diagonal, 2
    jmp .next_forward
.forward_seen:
    cmp qword best, 0
    jg .found
    mov kv, [match + seams_match.kv_backward]
    mov centre, [box + seams_box.lim1]
    sub centre, [box + seams_box.lim2]
    mov diagonal, [box + seams_box.bmax]
.next_backward:
    cmp diagonal, [box + seams_box.bmin]
    jl .backward_seen
    mov x, [kv + diagonal * SEAMS_U64_BYTES]
    mov y, x
    sub y, diagonal
    ; score = steps from (lim1, lim2) less the distance from the centre diagonal
    mov step, diagonal
    sub step, centre
    mov score, step
    neg score
    cmovs score, step
    neg score
    add score, [box + seams_box.lim1]
    add score, [box + seams_box.lim2]
    sub score, x
    sub score, y
    cmp score, threshold
    jle .backward_skip
    cmp score, best
    jle .backward_skip
    cmp x, [box + seams_box.off1]
    jle .backward_skip
    mov step, [box + seams_box.lim1]
    sub step, SEAMS_SNAKE_COUNT
    cmp x, step
    jg .backward_skip
    cmp y, [box + seams_box.off2]
    jle .backward_skip
    mov step, [box + seams_box.lim2]
    sub step, SEAMS_SNAKE_COUNT
    cmp y, step
    jg .backward_skip
    ; the SEAMS_SNAKE_COUNT ids from (x, y) on all match
    lea end_a, [ids_a + x * SEAMS_U32_BYTES]
    lea end_b, [ids_b + y * SEAMS_U32_BYTES]
    xor step, step
.backward_compare:
    mov id_a, [end_a + step * SEAMS_U32_BYTES]
    cmp id_a, [end_b + step * SEAMS_U32_BYTES]
    jne .backward_skip
    cmp step, SEAMS_SNAKE_COUNT - 1
    je .backward_better
    inc step
    jmp .backward_compare
.backward_better:
    mov best, score
    mov [box + seams_box.split1], x
    mov [box + seams_box.split2], y
.backward_skip:
    sub diagonal, 2
    jmp .next_backward
.backward_seen:
    cmp qword best, 0
    jg .found
    xor eax, eax
    jmp .return_found
.found:
    mov eax, 1
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
%undef threshold
%undef ids_a
%undef ids_b
%undef end_b
%undef centre
%undef score
%undef step
%undef id_a
%undef end_a
%undef best

; out of budget: split at the furthest point the forward search reached. any point inside
; the box gives a correct script; the furthest one keeps it close to minimal
%define match rdi
%define box rsi
%define kv r8
%define diagonal r9
%define x r10
%define y r11
%define best rax
%define reach rdx
%define best_x rcx
seams_cut_short:
    mov kv, [match + seams_match.kv_forward]
    mov best, [box + seams_box.off1]
    add best, [box + seams_box.off2]
    xor best_x, best_x
    mov diagonal, [box + seams_box.fmax]
.next_diagonal:
    cmp diagonal, [box + seams_box.fmin]
    jl .all_diagonals_seen
    mov x, [kv + diagonal * SEAMS_U64_BYTES]
    mov y, x
    sub y, diagonal
    cmp x, [box + seams_box.lim1]
    jg .not_inside
    cmp y, [box + seams_box.lim2]
    jg .not_inside
    cmp y, [box + seams_box.off2]
    jl .not_inside
    lea reach, [x + y]
    cmp reach, best
    jle .not_inside
    mov best, reach
    mov [box + seams_box.split1], x
    mov [box + seams_box.split2], y
.not_inside:
    sub diagonal, 2
    jmp .next_diagonal
.all_diagonals_seen:
    ; a split at either corner would not shrink the box
    mov best_x, best
    xor eax, eax
    mov reach, [box + seams_box.off1]
    add reach, [box + seams_box.off2]
    cmp best_x, reach
    jle .no_split
    mov reach, [box + seams_box.lim1]
    add reach, [box + seams_box.lim2]
    cmp best_x, reach
    jge .no_split
    mov eax, 1
.no_split:
    ret
%undef match
%undef box
%undef kv
%undef diagonal
%undef x
%undef y
%undef best
%undef reach
%undef best_x

%define match r12
%define box rbx
%define value rax
%define kv rcx
%define forward_centre r13
%define corner rdx
%define cost r14
seams_split:
    save_registers rbx, r12, r13, r14, r15
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
    xor cost, cost
.next_cost:
    mov qword [box + seams_box.snake], 0
    mov rdi, match
    mov rsi, box
    call seams_forward_round
    test eax, eax
    jnz .split_found
    mov rdi, match
    mov rsi, box
    call seams_backward_round
    test eax, eax
    jnz .split_found
    inc cost
    mov value, [match + seams_match.cost_limit]
    test value, value
    jz .next_cost
    cmp qword [box + seams_box.snake], 0
    je .budget_check
    cmp cost, SEAMS_HEUR_MIN_COST
    jbe .budget_check
    mov rdi, match
    mov rsi, box
    mov rdx, cost
    call seams_good_snake
    test eax, eax
    jnz .split_found
.budget_check:
    mov value, [match + seams_match.cost_limit]
    cmp cost, value
    jb .next_cost
    mov rdi, match
    mov rsi, box
    call seams_cut_short
    test eax, eax
    jz .next_cost
.split_found:
    restore_registers rbx, r12, r13, r14, r15
    ret
%undef match
%undef box
%undef value
%undef kv
%undef forward_centre
%undef corner
%undef cost

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
