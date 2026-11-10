// Test files for the cross-platform check: a million-line pair with scattered edits, a line added
// in the middle and no newline at the end, and a small three-way merge with a conflict.
//   node tools/ci-fixtures.mjs <dir>
import { writeFileSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2];
const a = Array.from({ length: 1_000_000 }, (_, i) => `    total += row(${i + 1});`);
writeFileSync(join(dir, 'old.ts'), a.join('\n') + '\n');
for (let i = 9_999; i < a.length; i += 10_000) a[i] = a[i].replace('+=', '-=');
a.splice(500_000, 0, '    // added in the middle');
writeFileSync(join(dir, 'new.ts'), a.join('\n'));                       // no final newline
writeFileSync(join(dir, 'base.txt'), 'a\nb\nc\nd\ne\n');
writeFileSync(join(dir, 'ours.txt'), 'a\nB\nc\nd\nE\n');
writeFileSync(join(dir, 'theirs.txt'), 'a\nb\nc\nD\ne2\n');
