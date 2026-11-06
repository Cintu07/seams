# seams

A line diff and patch engine written in NASM x86-64. A browser core in WAT comes later.

`seams_diff` takes two byte buffers and returns a minimal line edit script. `seams_apply` takes the
first buffer and that script and rebuilds the second buffer byte for byte, including a missing final
newline. The script stores only change records (`a_start`, `b_start`, `a_count`, `b_count`); unchanged
runs are the gaps between them.

## Pipeline

1. `scan_lines.asm`: find line starts and lengths. Scalar and AVX2 versions give identical tables.
2. `hash_lines.asm`: 64-bit hash per line.
3. `intern.asm`: map each distinct line to a dense id (open addressing, bytes compared on every hash match).
4. `myers.asm`: drop lines that never occur on the other side, then exact linear-space Myers
   (middle snake, no heuristics). Output is one `changed` byte per line.
5. `emit.asm`: turn the changed bytes into change records.
6. `apply.asm`: copy byte ranges from both buffers and check the script is well formed.

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

`make bench` compares against imara-diff and `git diff --no-index` on generated fixtures. The Rust
harness is in `bench/imara/`. Today seams is 1.4 to 2 times slower than imara-diff's default Myers on
sparse edits. Most of that time is hashing and interning, not the diff itself.
