// Builds the npm package into pkg/dist: the viewer modules, the worker, the WebAssembly core.
// No bundling: plain ES modules. Bundlers (Vite, webpack 5, Rollup, esbuild) pick up the worker and the
// .wasm file through `new URL('./x', import.meta.url)`.   node pkg/build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'pkg/dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const files = {
  'web/embed.mjs': 'index.mjs', 'web/renderer.mjs': 'renderer.mjs', 'web/interact.mjs': 'interact.mjs',
  'web/lex.mjs': 'lex.mjs', 'web/words.mjs': 'words.mjs', 'web/look.mjs': 'look.mjs', 'web/diff_worker.mjs': 'diff_worker.mjs',
  'web/pack.mjs': 'pack.mjs', 'web/layout.mjs': 'rows.mjs',
  'web/review.mjs': 'review.mjs', 'web/count_worker.mjs': 'count_worker.mjs',
  'wasm/seams.mjs': 'seams.mjs', 'wasm/layout.mjs': 'layout.mjs',
};
for (const [from, to] of Object.entries(files)) {
  let s = readFileSync(join(root, from), 'utf8');
  s = s.replace("'../wasm/seams.mjs'", "'./seams.mjs'").replace("'../build/seams.wasm'", "'./seams.wasm'");
  // web/layout.mjs (row layout) ships as rows.mjs, beside wasm's own layout.mjs (descriptor offsets)
  if (from.startsWith('web/')) s = s.replace("from './layout.mjs'", "from './rows.mjs'");
  // web/embed.mjs ships as index.mjs
  s = s.replace("from './embed.mjs'", "from './index.mjs'");
  if (s.includes('../')) throw new Error(`${from} still reaches outside the package`);
  writeFileSync(join(dist, to), s);
}
copyFileSync(join(root, 'build/seams.wasm'), join(dist, 'seams.wasm'));
for (const f of ['react.mjs', 'index.d.ts', 'react.d.ts']) copyFileSync(join(root, 'pkg', f), join(dist, f));
console.log('pkg/dist built');
