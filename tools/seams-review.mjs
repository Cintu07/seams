// Review any branch of any git repo in the browser, the way a pull request shows it.
//
//   node tools/seams-review.mjs [repo] main..my-branch          open it in your browser
//   node tools/seams-review.mjs [repo] main..my-branch -o r.json   or write the review to a file
//
// Like a pull request, a..b compares b with the point where it left a (their merge base). Every
// changed text file is read in one `git cat-file --batch` pass, renames are followed, binary files are
// listed and skipped. The page, the diff engine and your code are served from this machine only.
import { execFileSync, spawn } from 'child_process';
import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, extname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

const SEAMS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const outAt = args.indexOf('-o');
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : null;
let repo = '.', range;
if (args.length === 1) range = args[0];
else if (args.length === 2 && args[1].includes('..')) [repo, range] = args;
else if (args.length === 3) { repo = args[0]; range = `${args[1]}..${args[2]}`; }
if (!range || !range.includes('..')) {
  console.error('usage: node tools/seams-review.mjs [repo] <base>..<head> [-o review.json]');
  process.exit(2);
}
const [baseRef, headRef] = range.split(/\.{2,3}/);
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { maxBuffer: 1 << 30 }).toString().trim();

// ---------------------------------------------------------------- what changed
const started = performance.now();
let base, head;
try {
  head = git('rev-parse', '--verify', `${headRef}^{commit}`);
  base = git('merge-base', baseRef, head);
} catch {
  console.error(`seams-review: ${repo} has no ${baseRef} or ${headRef}`);
  process.exit(2);
}
const fields = git('diff', '--name-status', '-z', '-M', base, head).split('\0');
const changes = [];
for (let i = 0; i < fields.length && fields[i];) {
  const status = fields[i][0];
  if (status === 'R' || status === 'C') { changes.push({ status, from: fields[i + 1], path: fields[i + 2] }); i += 3; }
  else { changes.push({ status, from: fields[i + 1], path: fields[i + 1] }); i += 2; }
}

// ---------------------------------------------------------------- every blob in one pass
// cat-file --batch answers "<rev>:<path>" lines with "<sha> blob <size>\n<bytes>\n", in order
function readBlobs(specs) {
  return new Promise((done, fail) => {
    const child = spawn('git', ['-C', repo, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
    const parts = [];
    child.stdout.on('data', (d) => parts.push(d));
    child.on('error', fail);
    child.on('close', () => {
      const all = Buffer.concat(parts), blobs = [];
      let at = 0;
      for (let k = 0; k < specs.length; ++k) {
        const nl = all.indexOf(10, at), header = all.subarray(at, nl).toString();
        at = nl + 1;
        if (header.endsWith(' missing')) { blobs.push(null); continue; }
        const size = Number(header.split(' ')[2]);
        blobs.push(all.subarray(at, at + size));
        at += size + 1;
      }
      done(blobs);
    });
    child.stdin.end(specs.map((s) => s + '\n').join(''));
  });
}
const specs = [];
for (const c of changes) { specs.push(c.status === 'A' ? '' : `${base}:${c.from}`); specs.push(c.status === 'D' ? '' : `${head}:${c.path}`); }
const wanted = specs.filter(Boolean);
const blobs = await readBlobs(wanted);
const byspec = new Map(wanted.map((s, k) => [s, blobs[k]]));
const text = (spec) => { if (!spec) return null; const b = byspec.get(spec); return b === null || b === undefined ? undefined : b.includes(0) ? undefined : b.toString('utf8'); };

const files = [], skipped = [];
for (const [k, c] of changes.entries()) {
  const old = text(specs[2 * k]), now = text(specs[2 * k + 1]);
  if (old === undefined || now === undefined) { skipped.push(c.path); continue; }
  files.push(c.from !== c.path ? { path: c.path, oldPath: c.from, old, new: now } : { path: c.path, old, new: now });
}
const renamed = files.filter((f) => f.oldPath).length;
const took = performance.now() - started;
const title = `${basename(resolve(repo))} · ${baseRef}..${headRef}`;
console.log(`${files.length} files (${renamed} renamed${skipped.length ? `, ${skipped.length} binary skipped` : ''}) read in ${(took / 1000).toFixed(1)} s`);
const bundle = JSON.stringify({ title, base, head, files });
if (out) { writeFileSync(out, bundle); console.log(`-> ${out}`); process.exit(0); }

// ---------------------------------------------------------------- serve it here and open the browser
const local = existsSync(join(SEAMS, 'build/seams.wasm'));
const lib = local ? '/web/review.mjs' : 'https://cintu07.github.io/seams/lib/review.mjs';
const page = `<!doctype html><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title>
<style>
html,body{margin:0;height:100%;background:#c3dbc8;color:#1b2a21;font:14px/1.4 "IBM Plex Mono",Consolas,monospace}
body{display:grid;grid-template-rows:auto 1fr auto}
header{display:flex;gap:16px;align-items:baseline;padding:12px 20px;border-bottom:1px solid #9fbfa6}
header b{font-weight:500}header span{color:#45624e}#r{min-height:0;background:#b9d5be}
footer{padding:7px 20px;border-top:1px solid #9fbfa6;color:#45624e;font-size:13px}
</style>
<header><b>seams review</b><span>${title.replace(/</g, '&lt;')}</span></header><div id="r"></div><footer id="s">loading…</footer>
<script type="module">
import { createReview } from '${lib}';
const t0 = performance.now();
const { files } = await (await fetch('/review.json')).json();
const s = document.getElementById('s');
const review = createReview(document.getElementById('r'), { onChange: (e) => { if (e.counted) s.textContent = files.length.toLocaleString('en') + ' files · every file diffed in ' + e.ms.toFixed(0) + ' ms · nothing left this machine'; } });
await review.setFiles(files);
s.textContent = files.length.toLocaleString('en') + ' files · first file on screen in ' + (performance.now() - t0).toFixed(0) + ' ms · diffing the rest…';
</script>`;
const TYPES = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = createServer((q, r) => {
  const path = decodeURIComponent(q.url.split('?')[0]);
  if (path === '/') { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return r.end(page); }
  if (path === '/review.json') { r.writeHead(200, { 'content-type': 'application/json' }); return r.end(bundle); }
  if (path === '/favicon.ico') { r.writeHead(204); return r.end(); }
  // only the viewer's own folders, nothing else on disk
  if (local && /^\/(web|wasm)\/[\w.-]+\.mjs$|^\/build\/seams\.wasm$/.test(path)) {
    r.writeHead(200, { 'content-type': TYPES[extname(path)] });
    return r.end(readFileSync(join(SEAMS, path)));
  }
  r.writeHead(404); r.end();
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`open ${url}  (ctrl+c to stop)`);
  if (process.env.SEAMS_NO_OPEN) return;
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref();
});
