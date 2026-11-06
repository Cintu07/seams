%ifndef SEAMS_SIMD_INC
%define SEAMS_SIMD_INC

%macro broadcast_newline 3
    mov %3, SEAMS_LF
    vmovd %2, %3
    vpbroadcastb %1, %2
%endmacro

%macro find_newline_mask 4
    vmovdqu %1, [%2]
    vpcmpeqb %1, %1, %3
    vpmovmskb %4, %1
%endmacro

%endif
