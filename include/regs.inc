%ifndef SEAMS_REGS_INC
%define SEAMS_REGS_INC

%macro save_registers 1-*
    %rep %0
        push %1
        %rotate 1
    %endrep
%endmacro

%macro restore_registers 1-*
    %rep %0
        %rotate -1
        pop %1
    %endrep
%endmacro

%endif
