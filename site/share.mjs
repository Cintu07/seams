// renders site/share.html into site/assets/share.png, the picture a link to the site unfurls into.
// it serves the repo root itself, because the card draws the site's own skyline from web/look.mjs
import { chromium } from '../web/node_modules/playwright-core/index.mjs';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.woff2': 'font/woff2' };
const server = createServer((q, r) => {
  const p = join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(root) || !existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' }); r.end(readFileSync(p));
}).listen(0, '127.0.0.1');
await new Promise((ok) => server.on('listening', ok));
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(`http://127.0.0.1:${server.address().port}/site/share.html`);
await page.waitForFunction(() => window.ready === true);
await page.screenshot({ path: join(root, 'site/assets/share.png') });
await browser.close();
server.close();
console.log('wrote site/assets/share.png');
