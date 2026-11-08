CC = gcc
NASM = nasm
CFLAGS = -std=c11 -O2 -g -Wall -Wextra -Werror -Iinclude -Iref
NASMFLAGS = -f elf64 -g -F dwarf -w+error -Iinclude/
INCLUDES = include/layout.inc include/regs.inc include/simd.inc

ENGINE = build/api.o build/scan_lines.o build/hash_lines.o build/intern.o build/trim.o \
         build/myers.o build/emit.o build/apply.o build/diff.o build/patch.o build/merge.o
ENGINE_BAD_HASH = $(filter-out build/hash_lines.o,$(ENGINE)) build/hash_lines_bad.o

.PHONY: all wasm test test-wasm bench clean
all: build/harness build/v2_harness build/diff_harness build/diff_harness_bad_hash build/bench build/diff_bench build/corpus_bench build/seams build/script_dump

build:
	mkdir -p build

build/%.o: src/%.asm $(INCLUDES) | build
	$(NASM) $(NASMFLAGS) $< -o $@

build/hash_lines_bad.o: src/hash_lines.asm $(INCLUDES) | build
	$(NASM) $(NASMFLAGS) -DSEAMS_BAD_HASH $< -o $@

build/abi.o: test/abi.asm $(INCLUDES) | build
	$(NASM) $(NASMFLAGS) $< -o $@

build/harness: test/harness.c test/cases/scan_cases.h ref/ref_scan.c ref/ref_scan.h include/seams.h $(ENGINE) build/abi.o
	$(CC) $(CFLAGS) test/harness.c ref/ref_scan.c $(ENGINE) build/abi.o -o $@

build/v2_harness: test/v2_harness.c ref/ref_merge.c ref/ref_merge.h include/seams.h $(ENGINE)
	$(CC) $(CFLAGS) test/v2_harness.c ref/ref_merge.c $(ENGINE) -o $@

build/diff_harness: test/diff_harness.c ref/ref_diff.c ref/ref_diff.h include/seams.h $(ENGINE)
	$(CC) $(CFLAGS) test/diff_harness.c ref/ref_diff.c $(ENGINE) -o $@

build/diff_harness_bad_hash: test/diff_harness.c ref/ref_diff.c ref/ref_diff.h include/seams.h $(ENGINE_BAD_HASH)
	$(CC) $(CFLAGS) test/diff_harness.c ref/ref_diff.c $(ENGINE_BAD_HASH) -o $@

build/bench: bench/bench.c include/seams.h $(ENGINE)
	$(CC) $(CFLAGS) $< $(ENGINE) -o $@

test: build/harness build/diff_harness build/diff_harness_bad_hash build/v2_harness
	./build/harness
	./build/diff_harness "normal hash"
	SEAMS_FUZZ_PAIRS=20000 ./build/diff_harness_bad_hash "forced collisions"
	./build/v2_harness

build/seams: tools/seams.c include/seams.h $(ENGINE)
	$(CC) $(CFLAGS) $< $(ENGINE) -o $@

build/diff_bench: bench/diff_bench.c include/seams.h $(ENGINE)
	$(CC) $(CFLAGS) $< $(ENGINE) -o $@

bench: build/bench build/diff_bench build/corpus_bench
	./build/bench
	./bench/run_diff.sh

clean:
	rm -rf build

build/corpus_bench: bench/corpus_bench.c ref/ref_diff.c ref/ref_diff.h include/seams.h $(ENGINE)
	$(CC) $(CFLAGS) bench/corpus_bench.c ref/ref_diff.c $(ENGINE) -o $@

NODE ?= node

build/script_dump: test/script_dump.c include/seams.h $(ENGINE)
	$(CC) $(CFLAGS) $< $(ENGINE) -o $@

wasm/node_modules: wasm/package.json
	cd wasm && npm install --silent --no-audit --no-fund
	touch $@

build/seams.wasm: wasm/seams.wat wasm/layout.mjs wasm/build.mjs wasm/node_modules | build
	$(NODE) wasm/build.mjs

test-wasm: build/seams.wasm build/script_dump
	$(NODE) test/wasm_harness.mjs "normal hash" build/seams.wasm
	SEAMS_FUZZ_PAIRS=10000 $(NODE) test/wasm_harness.mjs "forced collisions" build/seams_bad_hash.wasm
	SEAMS_FAST=1 SEAMS_FUZZ_PAIRS=10000 $(NODE) test/wasm_harness.mjs "normal hash" build/seams.wasm

wasm: build/seams.wasm
