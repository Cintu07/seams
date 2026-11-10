#!/bin/bash
# Builds seams for Intel macs: the same assembly as macho64 objects. macOS uses the System V calling
# convention like Linux, so nothing in the engine changes; nasm --prefix _ adds the underscore macOS
# puts on C symbol names. Run on a mac with nasm (brew install nasm) and clang.
#   tools/build-macos.sh            -> build/mac/seams
set -e
cd "$(dirname "$0")/.."
mkdir -p build/mac/src
objs=()
for f in src/*.asm; do
  name=$(basename "$f" .asm)
  # mach-o has no elf symbol types and no gnu stack note
  sed -E -e 's/^(global [A-Za-z0-9_]+):(function|data)( hidden)?/\1/' -e '/^section \.note\.GNU-stack/d' "$f" > "build/mac/src/$name.asm"
  nasm -f macho64 --prefix _ -w+error -Iinclude/ -o "build/mac/$name.o" "build/mac/src/$name.asm"
  objs+=("build/mac/$name.o")
done
${CC:-clang} -arch x86_64 -O2 -std=c11 -Wall -Wextra -Iinclude "${objs[@]}" tools/seams.c -o build/mac/seams
echo "built build/mac/seams"
