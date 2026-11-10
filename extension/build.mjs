// Puts the seams library (pkg/dist: the viewer, the review, the workers and the wasm) into
// extension/lib, so the extension carries everything it runs. Load extension/ as an unpacked extension.
//   node pkg/build.mjs && node extension/build.mjs
import { cpSync, rmSync, existsSync } from 'fs';
const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
if (!existsSync(root + 'pkg/dist/review.mjs')) throw new Error('run node pkg/build.mjs first');
rmSync(root + 'extension/lib', { recursive: true, force: true });
cpSync(root + 'pkg/dist', root + 'extension/lib', { recursive: true, filter: (p) => !/react|\.d\.ts$/.test(p) });
console.log('extension/lib ready');
