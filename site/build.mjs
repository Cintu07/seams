// Builds the site into _site/: the page, the viewer modules and the wasm core at the same relative
// paths they have in the repo (the worker finds ../build/seams.wasm from web/), and the demo files.
//   node wasm/build.mjs && node site/build.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const f of ['index.html', 'site.css', 'main.mjs', 'dither.mjs']) cpSync(join(root, 'site', f), join(out, f));
cpSync(join(root, 'site/media'), join(out, 'media'), { recursive: true });
cpSync(join(root, 'site/fonts'), join(out, 'fonts'), { recursive: true });
cpSync(join(root, 'site/assets'), join(out, 'assets'), { recursive: true });
mkdirSync(join(out, 'web'));
for (const f of ['embed.mjs', 'renderer.mjs', 'interact.mjs', 'lex.mjs', 'words.mjs', 'look.mjs', 'diff_worker.mjs', 'layout.mjs', 'pack.mjs', 'review.mjs', 'count_worker.mjs'])
  cpSync(join(root, 'web', f), join(out, 'web', f));
mkdirSync(join(out, 'wasm'));
for (const f of ['seams.mjs', 'layout.mjs']) cpSync(join(root, 'wasm', f), join(out, 'wasm', f));
mkdirSync(join(out, 'build'));
if (!existsSync(join(root, 'build/seams.wasm'))) throw new Error('build/seams.wasm is missing: run node wasm/build.mjs first');
cpSync(join(root, 'build/seams.wasm'), join(out, 'build/seams.wasm'));
// the library itself, so a page can import it by url with no package manager
if (existsSync(join(root, 'pkg/dist'))) cpSync(join(root, 'pkg/dist'), join(out, 'lib'), { recursive: true });

// the demo: web/embed.mjs before and after the commit that added packs, straight from git history
mkdirSync(join(out, 'demo'));
const show = (rev) => execFileSync('git', ['show', `${rev}:web/embed.mjs`], { cwd: root });
const added = execFileSync('git', ['log', '--format=%h', '--diff-filter=A', '--', 'web/pack.mjs'], { cwd: root }).toString().trim().split('\n').pop();
writeFileSync(join(out, 'demo/embed.old.mjs'), show(`${added}^`));
writeFileSync(join(out, 'demo/embed.new.mjs'), show(added));
writeFileSync(join(out, '.nojekyll'), '');
console.log(`_site built (demo from ${added})`);
