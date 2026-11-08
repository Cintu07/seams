#!/bin/bash
# Runs the whole project in front of you: build, tests, a real diff, speed. Leaves a shell open after.
export PATH=$HOME/.local/bin:$HOME/opt/node/bin:$HOME/opt/nasm/usr/bin:$PATH GIT_PAGER=cat TIMEFORMAT=$'  (%3Rs)'
R=/mnt/c/Users/pavan/Desktop/seems
step() { printf '\n\e[1;36m==> %s\e[0m\n' "$1"; sleep 1; }
cd $R
step "1. build the assembly engine, the seams command and the WebAssembly engine"
time make -s all wasm
step "2. native tests: 200,000 random pairs + edge cases, each checked against a reference"
time make -s test
step "3. WebAssembly engine must match the assembly engine exactly (incl. 3,000 kernel commits)"
time SEAMS_CORPUS=$HOME/work/kernel_pairs make -s test-wasm
cd ~/seams-demo
step "4. a real Linux kernel commit (btrfs)"
seams a/fs/btrfs/verity.c b/fs/btrfs/verity.c
step "5. its output is a real patch: apply it and compare"
seams a/fs/btrfs/verity.c b/fs/btrfs/verity.c > fix.patch
patch -s -o patched.c a/fs/btrfs/verity.c < fix.patch && cmp patched.c b/fs/btrfs/verity.c && echo "identical"
step "6. two 1,000,000-line files: git vs seams"
time git diff --no-index --stat big/old.ts big/new.ts
time seams --stat big/old.ts big/new.ts
step "7. 3,000 real kernel commits: seams (native, wasm) vs imara-diff"
cd $R
taskset -c 2 ./build/corpus_bench $HOME/work/kernel_pairs 5 | grep -E "avx2-scan pairs"
taskset -c 2 $HOME/seams_imara_target/release/imara_bench --corpus $HOME/work/kernel_pairs 5 | grep "imara myers "
taskset -c 2 node bench/wasm_bench.mjs --corpus $HOME/work/kernel_pairs 5 | grep simd128
printf '\n\e[1;32mdone. you are in ~/seams-demo; try: seams a/fs/btrfs/verity.c b/fs/btrfs/verity.c\e[0m\n'
cd ~/seams-demo
exec bash
