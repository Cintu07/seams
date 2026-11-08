# seams

**Site and live demo: [cintu07.github.io/seams](https://cintu07.github.io/seams)**

A line diff and patch engine written in NASM x86-64. The same engine is also hand-written in WebAssembly text (`wasm/seams.wat`) for the browser.

`seams_diff` takes two byte buffers and returns a minimal line edit script. `seams_apply` takes the
first buffer and that script and rebuilds the second buffer byte for byte, including a missing final
newline. The script stores only change records (`a_start`, `b_start`, `a_count`, `b_count`); unchanged
runs are the gaps between them.

## Get it

- In a web page, no install: `import { createDiffViewer } from 'https://cintu07.github.io/seams/lib/index.mjs'`.
- Linux x86-64: `seams-linux-x86_64.tar.gz` from [Releases](https://github.com/Cintu07/seams/releases), one static binary.
- Self-hosted web library: `seams-web.tar.gz` from the same release; serve the folder and import `index.mjs`.
- From source: `make` (NASM and GCC).

## Pipeline

1. `scan_lines.asm`: find line starts and lengths. Scalar and AVX2 versions give identical tables.
2. `trim.asm`: find the longest common byte prefix and suffix and round them to whole lines.
   Those lines pair up in any minimal script, so the next steps only see the lines between them.
3. `hash_lines.asm`: 64-bit hash per remaining line.
4. `intern.asm`: map each distinct line to a dense id (open addressing, bytes compared on every hash match).
5. `myers.asm`: drop lines that never occur on the other side, then linear-space Myers (middle
   snake). Exact by default. With `SEAMS_FLAG_FAST` each middle-snake search gets a budget of
   `max(4096, 2^(bits(n)/2))` rounds and, when it runs out, splits at the furthest point the forward
   search reached: on 40,000 shuffled lines that is 5.4 s down to 0.9 s for a script 0.33% longer.
   Output is one `changed` byte per line.
6. `emit.asm`: turn the changed bytes into change records.
7. `apply.asm`: copy byte ranges from both buffers and check the script is well formed.
8. `patch.asm`: write and apply self-contained patches (they carry the inserted bytes, so the new file
   is not needed to apply them). A patch records the length and hash of its base and refuses any other.
9. `merge.asm`: three-way merge of two scripts from the same base, diff3 style, with conflict markers.

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

## Browser viewer

`web/` is a diff viewer on top of the wasm core: the diff runs in a worker, the view is drawn with
WebGL2 (only visible rows, one draw call per frame). Build the wasm core, then:

```sh
node web/serve.mjs          # http://localhost:4174/ ; pick or drop two files
```

`?old=NAME&new=NAME` loads files from the fixtures directory (`SEAMS_FIXTURES`). Keys: arrows, Page
Up/Down, Home/End, `n`/`p` for the next/previous change. A 1M-line diff scrolls within the display
frame budget (p99 under 8 ms at 145 Hz) with 0.2 ms of CPU per frame; `web/bench_viewer.mjs` measures it.

## Packs: diff ahead of time

`tools/seams-pack.mjs` diffs two files once (in CI, on a server) and writes a `.seamspack` with both
files, their line tables, the edit script and the highlighter's line states. The viewer opens it with
nothing left to compute: a 1M-line diff shows its first frame in 34 ms instead of about 500, measured
on a laptop on battery (`bench/throttle.mjs`).

```sh
node tools/seams-pack.mjs old.ts new.ts -o change.seamspack
```

```js
viewer.setPack('/change.seamspack');            // seams-diff, or <SeamsDiff pack="..." /> in React
```

## Use it

`make` builds `build/seams`, a command-line diff that prints a standard unified diff (`patch` and
`git apply` read it):

```sh
seams old.c new.c              # coloured unified diff, exit status 1 if they differ
seams -U 1 old.c new.c > fix.patch
seams --stat --time big.old big.new
seams --minimal old.c new.c    # the smallest diff, however long it takes (default: bounded time)

seams patch old new > change.seams   # self-contained patch: a 100-edit change to a 32 MB file is 7.5 KB
seams apply old change.seams > new   # refused if old is not the file the patch was made from
seams merge base ours theirs > out   # exit 1 and conflict markers when both sides changed a region
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
- the same checks on a build whose hash is `length & 1`, so every line collides;
- the cost cutoff on 40,000 shuffled lines: round trip, scalar/AVX2 agreement, never shorter than exact;
- 100,000 patch and merge cases (`test/v2_harness.c`): patches round trip and refuse a wrong base, a
  cut or a damaged patch; merges match `ref/ref_merge.c` byte for byte, give back the edited side when
  the other is untouched, and take an identical edit on both sides once.

`make bench` compares against imara-diff and `git diff --no-index` on generated fixtures, then on a
corpus of real edits: 3,000 old/new pairs of `.c` and `.h` files from Linux kernel commits, pulled
with `bench/data/pull_pairs.sh`. The Rust harness is in `bench/imara/`; fixtures come from
`bench/gen_fixtures.mjs`.

On the kernel corpus seams takes 166 ms against 319 ms for imara-diff's default Myers, and its
scripts are 188 edits shorter in total. Most real edits leave long identical stretches at both ends
of a file; seams skips them before hashing. On generated files with sparse edits it is level with or
faster than imara. On dense edits (10,000 changes spread through the file) it is 2.2 to 2.7 times
slower with `--minimal`, because it returns the minimal script and imara's default gives that up for
speed. The bounded default (`SEAMS_FLAG_FAST`) has not been benchmarked against imara yet.

## License

MIT, see [LICENSE](LICENSE).
