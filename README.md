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
- Windows x86-64: `seams-windows-x86_64.zip` from the same release. The same assembly, built with
  `tools/build-windows.sh` (NASM `-f win64`, linked with `zig cc`); CI checks it gives Linux's answers
  byte for byte. Windows' Smart App Control may block it until the binary is signed.
- macOS (Intel): `seams-macos-x86_64.tar.gz`, built with `tools/build-macos.sh` (NASM `-f macho64`).
  Apple Silicon macs run it through Rosetta 2; a native ARM64 engine is not written.
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

The rows at the top of a diff are often unchanged, and unchanged leading lines are context in any diff
(the engine trims them before Myers runs). So when two files over 1 MiB start with a screen of the
same lines, the viewer draws those lines while the worker is still diffing, and swaps in the whole
diff at the same rows when it lands. On the 1M-line benchmark that puts text on screen in one display
frame (about 2 ms) instead of 0.2 s; `timing.firstScreen` reports it next to `timing.firstFrame`.

Syntax highlighting is a set of small hand-written lexers, picked from the file name: TypeScript and
JavaScript, Rust, Python, C and C++, Go, Java, Kotlin, C#, Swift, Scala, Ruby, shell, PHP, Lua, SQL,
Zig, NASM, WebAssembly text, JSON, CSS and SCSS, and YAML, TOML, Makefiles and Dockerfiles for
comments and constants. `node web/test_lex.mjs` checks them.

Themes: `sage`, `dusk`, `paper`, `clay`, `ink`, `harbor` and `clear`, passed as `{ theme: 'ink' }` or
`viewer.setTheme('paper')`. `clear` marks deleted lines orange and inserted lines blue instead of
red and green, so the two stay apart with red-green colour blindness. A theme is a plain object, so
your own colours work too: copy `THEMES.sage` and change what you like.

## A whole pull request

`web/review.mjs` puts a file list beside the viewer. Every file is diffed in the background as soon
as the review opens (a few workers, the same WebAssembly core), so the list fills in with +/- counts
while the first file is on screen. Only the rows in view exist in the DOM. A generated 5,000-file,
3.8M-line pull request shows its first file 60 ms after opening and has every file diffed in about
a second. `]` and `[` move between files; the box filters paths.

Review any branch of any repo, like a pull request (it compares with the merge base):

```sh
cd path/to/repo
node path/to/seams/tools/seams-review.mjs main..my-branch      # opens it in your browser
node path/to/seams/tools/seams-review.mjs main..my-branch -o review.json
```

Every changed text file is read in one `git cat-file --batch` pass and renames are followed:
3,000 commits of tinygrad (1,136 files, 78 renames) are ready in 0.7 s. The page, the engine and
your code are served from your machine only.

### On GitHub

`extension/` is a browser extension that puts an **open in seams** button next to the title of any
GitHub pull request. It lists the files through the API and fetches both sides at the exact commits;
a pull request over 100 files comes as two repository snapshots unpacked while they download, keeping
only the changed files. A 1,150-file pull request (tinygrad, 3,000 commits) opens in about 20 s, most
of it download, and is diffed in under 0.4 s. A token in the options page covers private repositories.

The tab stays in step with the pull request while it's open:

- review comments from GitHub are pinned to their lines, with their replies;
- hovering a line number shows a **+**, and the comment written there is posted to the pull request
  as yours, on that line (a token with *Pull requests: read and write*). GitHub only takes line
  comments near a change, so anywhere else it goes up as a comment on the file that starts with
  `` `L1980` `` and comes back pinned to line 1980;
- a push is picked up within ten seconds (two minutes without a token). Only files whose contents
  changed are fetched again, and the view stays on the same file and line.

Checking costs one request, and GitHub answers 304 when nothing changed, which doesn't count against
a token's limit. `node extension/test_sync.mjs` runs all of it against a fake GitHub.

```sh
node pkg/build.mjs && node extension/build.mjs   # then load extension/ unpacked (developer mode)
```

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

`--page change.html` also writes a page with the first screen of the diff already in its HTML, so
the change is readable before any script runs, and the viewer takes over on top of it at the same
rows once the pack is in. For a 1M-line diff the text is painted at 156 ms (204 ms with the CPU
slowed 6x) and the live viewer at 343 ms (936 ms). The page is 6 KB; the pack can still be on its
way while the reader is already looking at the diff.

`bench/slow_laptop.mjs` runs the site's million-line demo on a CPU slowed 4x or 6x through the
DevTools protocol. Edge ignores that throttle inside workers, so the worker's diff is re-timed on the
throttled main thread: at 6x it takes 0.4 to 0.6 s, the first frame lands at 0.46 s, and wheel
scrolling keeps every frame.

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
of a file; seams skips them before hashing.

Dense edits (10,000 changes spread through the file) used to be where imara won. With `--minimal`
seams returns the minimal script and pays for it. The default fast mode now has the early split
that git's xdiff and imara use: once a search has cost more than 256 steps, a point far along a
front whose last 20 steps were all matching lines is taken as the split, without waiting for the
two fronts to meet. On these files it finds the same minimal edit count while doing about a fifth
of the work (`bench/myers_model.c` is the C model used to try it before writing it in assembly).
Median ms, one vCPU, `bench/diff_bench.c` against imara-diff 0.2's default Myers:

| pair | seams exact | seams fast | imara myers | edits, seams / imara |
|---|---|---|---|---|
| 1M lines, 100 edits | 78 | 75 | 93 | 274 / 274 |
| 1M lines, 10,000 edits | 290 | 89 | 115 | 26,255 / 26,257 |
| 100k lines, 10,000 edits | 42 | 12.5 | 16.1 | 24,724 / 24,796 |
| 50k lines, all different | 3.2 | 3.2 | 3.1 | 100,000 / 100,000 |

The last row is level within run-to-run noise (an earlier run had imara at 3.7). Shuffled files,
the case the budget was made for, are unchanged: they have no long runs of matching lines, so the
early split never fires there. The browser engine takes the same splits; on the 100k-line pair its
fast mode went from 51 to 18 ms. `bench/stage_bench.c` times each stage on its own.

## License

MIT, see [LICENSE](LICENSE).
