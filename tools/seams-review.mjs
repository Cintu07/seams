// A pull request as one file the review view opens: every changed text file between two commits,
// old and new contents side by side. Binary files are listed and skipped.
//   node tools/seams-review.mjs <repo> <base> <head> [-o review.json]
//   then in a page: review.setFiles((await (await fetch('review.json')).json()).files)
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';

const args = process.argv.slice(2);
const outAt = args.indexOf('-o');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : 'review.json';
const [repo, base, head] = args;
if (!head) { console.error('usage: node tools/seams-review.mjs <repo> <base> <head> [-o review.json]'); process.exit(2); }

const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 30 });
const show = (rev, path) => { const b = git('show', `${rev}:${path}`); return b.includes(0) ? undefined : b.toString('utf8'); };

const files = [], skipped = [];
for (const line of git('diff', '--name-status', '--no-renames', '-z', base, head).toString().split('\0').reduce((acc, x, i, all) => (i % 2 === 0 && x ? acc.concat([[x, all[i + 1]]]) : acc), [])) {
  const [status, path] = line;
  const old = status === 'A' ? null : show(base, path);
  const now = status === 'D' ? null : show(head, path);
  if (old === undefined || now === undefined) { skipped.push(path); continue; }
  files.push({ path, old, new: now });
}
writeFileSync(out, JSON.stringify({ base, head, files }));
console.log(`${files.length} files -> ${out}${skipped.length ? ` (${skipped.length} binary skipped)` : ''}`);
