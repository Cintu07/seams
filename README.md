# seams

A line diff and patch engine written in NASM x86-64. The same engine is also hand-written in WebAssembly text (`wasm/seams.wat`) for the browser.

`seams_diff` takes two byte buffers and returns a minimal line edit script. `seams_apply` takes the
first buffer and that script and rebuilds the second buffer byte for byte, including a missing final
newline. The script stores only change records (`a_start`, `b_start`, `a_count`, `b_count`); unchanged
runs are the gaps between them.

## Pipeline

1. `scan_lines.asm`: find line starts and lengths. Scalar and AVX2 versions give identical tables.
2. `trim.asm`: find the longest common byte prefix and suffix and round them to whole lines.
   Those lines pair up in any minimal script, so the next steps only see the lines between them.
3. `hash_lines.asm`: 64-bit hash per remaining line.
4. `intern.asm`: map each distinct line to a dense id (open addressing, bytes compared on every hash match).
5. `myers.asm`: drop lines that never occur on the other side, then exact linear-space Myers
   (middle snake, no heuristics). Output is one `changed` byte per line.
6. `emit.asm`: turn the changed bytes into change records.
7. `apply.asm`: copy byte ranges from both buffers and check the script is well formed.

## WebAssembly core

`wasm/seams.wat` is a hand-written port of the same pipeline with simd128 scan and trim. `make wasm`
builds `build/seams.wasm` (about 5 KB; needs Node). `make test-wasm` checks that its scalar and SIMD
scripts are identical to the native engine record for record on every harness pair, including the
kernel corpus when `SEAMS_CORPUS` is set. `wasm/seams.mjs` is a small JS host:

```js
import { loadSeams } from "./wasm/seams.mjs";
const seams = await loadSeams(wasmBytes);
const script = seams.diff(oldBytes, newBytes); // { aStart, bStart, aCount, bCount } as Uint32Arrays
```

## Use it

`make` builds `build/seams`, a command-line diff that prints a standard unified diff (`patch` and
`git apply` read it):

```sh
seams old.c new.c              # coloured unified diff, exit status 1 if they differ
seams -U 1 old.c new.c > fix.patch
seams --stat --time big.old big.new
```

To let git use it, put `build/seams` and `tools/seams-git` on your PATH, then:

```sh
GIT_EXTERNAL_DIFF=seams-git git diff
GIT_EXTERNAL_DIFF=seams-git git show --ext-diff HEAD
```

The CLI was checked on 3,000 Linux kernel commit pairs: GNU `patch` applies every diff it prints and
gets the new file back byte for byte.

## Build

Inside WSL2 Ubuntu, with NASM, GCC and make:

```sh
make
make test
make bench
```

`make test` runs:

- the scanner against a C reference, with guard bytes and callee-saved register checks;
- 200,000 random file pairs plus 118 edge cases, each checked for round trip, edit count equal to
  textbook Myers, script shape, and scalar/AVX2 agreement;
- the same checks on a build whose hash is `length & 1`, so every line collides.

`make bench` compares against imara-diff and `git diff --no-index` on generated fixtures, then on a
corpus of real edits: 3,000 old/new pairs of `.c` and `.h` files from Linux kernel commits, pulled
with `bench/data/pull_pairs.sh`. The Rust harness is in `bench/imara/`; fixtures come from
`bench/gen_fixtures.mjs`.

On the kernel corpus seams takes 166 ms against 319 ms for imara-diff's default Myers, and its
scripts are 188 edits shorter in total. Most real edits leave long identical stretches at both ends
of a file; seams skips them before hashing. On generated files with sparse edits it is level with or
faster than imara. On dense edits (10,000 changes spread through the file) it is 2.2 to 2.7 times
slower, because it always returns the minimal script and imara's default gives that up for speed.
