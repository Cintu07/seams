#!/bin/bash
# Builds seams.exe for Windows x86-64 from WSL: the same assembly, as win64 objects, linked with
# `zig cc` (a C compiler with its own Windows C library). The engine keeps the System V calling
# convention inside; seams.h marks its functions sysv_abi for Windows compilers, so callers save
# what Windows expects around each call.
#   tools/build-windows.sh            -> build/win/seams.exe
set -e
cd "$(dirname "$0")/.."
ZIG=${ZIG:-/mnt/c/Users/pavan/AppData/Local/Microsoft/WinGet/Packages/zig.zig_Microsoft.Winget.Source_8wekyb3d8bbwe/zig-x86_64-windows-0.17.0/zig.exe}
mkdir -p build/win/src
objs=()
for f in src/*.asm; do
  name=$(basename "$f" .asm)
  [ "$name" = hash_lines_bad ] && continue
  # coff has no symbol types and no gnu stack note
  sed -E -e 's/^(global [A-Za-z0-9_]+):(function|data)( hidden)?/\1/' -e '/^section \.note\.GNU-stack/d' "$f" > "build/win/src/$name.asm"
  nasm -f win64 -w+error -Iinclude/ -o "build/win/$name.obj" "build/win/src/$name.asm"
  objs+=("build/win/$name.obj")
done
"$ZIG" cc -target x86_64-windows-gnu -O2 -std=c11 -Wall -Wextra -Iinclude "${objs[@]}" tools/seams.c -o build/win/seams.exe 2>&1
echo "built build/win/seams.exe"
