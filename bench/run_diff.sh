#!/usr/bin/env bash
# One table: seams vs imara-diff vs git diff --no-index on the same pairs, pinned to vCPU 2.
# WSL2 cannot guarantee the vCPU runs on a P core of this hybrid CPU.
# Fixtures come from bench/gen_fixtures.mjs. git runs from /tmp so no repository attributes apply.
set -e
cd "$(dirname "$0")/.."
FIX=$(realpath "${SEAMS_FIXTURES:-scratch/pierre_bench/fixtures}")
IMARA=${IMARA_BIN:-$HOME/seams_imara_target/release/imara_bench}
RUNS=${RUNS:-9}
pairs="10k.old.ts:10k.e100.new.ts 100k.old.ts:100k.e100.new.ts 100k.old.ts:100k.e10000.new.ts 1m.old.ts:1m.e1.new.ts 1m.old.ts:1m.e100.new.ts 1m.old.ts:1m.e10000.new.ts div10k.old.ts:div10k.new.ts div50k.old.ts:div50k.new.ts"
for pair in $pairs; do
  old=$FIX/${pair%%:*}; new=$FIX/${pair##*:}
  echo "== ${pair##*:} ($(( ($(stat -c%s $old) + $(stat -c%s $new)) / 1024 )) KiB)"
  taskset -c 2 ./build/diff_bench "$old" "$new" "$RUNS"
  [ -x "$IMARA" ] && taskset -c 2 "$IMARA" "$old" "$new" "$RUNS"
  start=$(date +%s%N); (cd /tmp && taskset -c 2 git diff --no-index --minimal --stat "$old" "$new" >/dev/null || true); end=$(date +%s%N)
  echo "git diff --no-index --minimal (one run, includes process start) ms=$(( (end - start) / 1000000 ))"
  start=$(date +%s%N); (cd /tmp && taskset -c 2 git diff --no-index --stat "$old" "$new" >/dev/null || true); end=$(date +%s%N)
  echo "git diff --no-index default myers (one run, includes process start) ms=$(( (end - start) / 1000000 ))"
done
