#!/usr/bin/env bash
# Writes (old, new) pairs of modified .c/.h files from recent kernel commits:
#   <out>/<n>.old = git show <commit>^:<path>, <out>/<n>.new = git show <commit>:<path>
# usage: bench/data/pull_pairs.sh <linux checkout> <out dir> [max pairs, default 3000] [files per commit, default 2]
# Commits come from `git log --no-merges` on the checked-out branch, newest first, so the set is
# reproducible for a given HEAD. Pairs whose parent is missing (shallow clone edge) are skipped.
set -euo pipefail
repo=$1 out=$2 max=${3:-3000} per_commit=${4:-2}
mkdir -p "$out"
rm -f "$out/manifest.txt.tmp"
n=0
while read -r commit; do
  while read -r path; do
    [ "$n" -ge "$max" ] && break 2
    git -C "$repo" show "$commit^:$path" > "$out/$n.old" 2>/dev/null || continue
    git -C "$repo" show "$commit:$path" > "$out/$n.new" 2>/dev/null || continue
    printf '%s %s\n' "$commit" "$path" >> "$out/manifest.txt.tmp"
    n=$((n + 1))
  done < <(git -C "$repo" diff-tree --no-commit-id -r --diff-filter=M --name-only "$commit" | grep -E '\.(c|h)$' | head -n "$per_commit")
done < <(git -C "$repo" log --no-merges --format=%H)
rm -f "$out/$n.old" "$out/$n.new"
mv "$out/manifest.txt.tmp" "$out/manifest.txt"
echo "$n" > "$out/count"
echo "wrote $n pairs to $out (HEAD $(git -C "$repo" rev-parse --short HEAD))"
