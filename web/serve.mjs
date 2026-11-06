// Static server for the viewer. / is web/, /build and /wasm come from the repo, /fixtures from
// SEAMS_FIXTURES (default scratch/pierre_bench/fixtures).  node web/serve.mjs [port]
// If the port is taken (often by a copy of this server that is still running), the next one is used.
import { createServer } from 'http';
import { createReadStream, statSync } from 'fs';
import { join, normalize, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const firstPort = Number(process.argv[2] ?? 4174);
const fixtures = process.env.SEAMS_FIXTURES ?? join(root, 'scratch/pierre_bench/fixtures');
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

function resolve(urlPath) {
  const path = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) return null;
  if (path.startsWith('fixtures')) return join(fixtures, path.slice('fixtures'.length));
  if (path.startsWith('build') || path.startsWith('wasm')) return join(root, path);
  return join(root, 'web', path || 'index.html');
}

function listen(port, triesLeft) {
  const server = createServer((req, res) => {
    const file = resolve(new URL(req.url, 'http://x').pathname);
    try {
      if (!file || !statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && triesLeft > 0) {
      console.log(`port ${port} is in use (maybe seams is already running there), trying ${port + 1}`);
      listen(port + 1, triesLeft - 1);
    } else {
      console.error(`could not start: ${error.message}`);
      process.exit(1);
    }
  });
  server.listen(port, () => console.log(`seams viewer on http://localhost:${port}/`));
}
listen(firstPort, 10);
