// The extension's review page against a fake GitHub: comments from GitHub pinned to their lines,
// a comment and a reply written in seams and posted back, a comment outside GitHub's hunks falling
// back to a file comment that keeps its line, and a push picked up live without losing your place.
//   node pkg/build.mjs && node extension/build.mjs && node extension/test_sync.mjs
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { extname, join } from 'path';
import { createHash } from 'crypto';
import { chromium } from '../web/node_modules/playwright-core/index.mjs';

const root = new URL('.', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';
const BASE = 'b'.repeat(40);
const repo = {
  [BASE]: { 'src/a.ts': lines(2000, (i) => `const a${i} = ${i};`), 'b.md': lines(50, (i) => `note ${i}`) },
};
let head = 'c'.repeat(40);
repo[head] = { 'src/a.ts': repo[BASE]['src/a.ts'].replace('const a10 = 10;', 'const a10 = 11;'), 'b.md': repo[BASE]['b.md'].replace('note 3\n', 'note three\n') };
let updated = '2026-11-12T10:00:00Z', etag = 1;
const comments = [{ id: 7, path: 'src/a.ts', line: 10, side: 'RIGHT', body: 'why 11?', user: { login: 'reviewer' }, created_at: '2026-11-12T09:00:00Z', html_url: 'https://github.com/o/r/pull/1#discussion_r7' }];
const posted = [];
// a blob is named by its contents, as in git
const blob = (sha, path) => createHash('sha1').update(repo[sha][path]).digest('hex');
const pull = () => ({ title: 'fake pull request', html_url: 'https://github.com/o/r/pull/1', state: 'open', updated_at: updated, changed_files: 2,
  base: { sha: BASE, repo: { full_name: 'o/r' } }, head: { sha: head, repo: { full_name: 'o/r' } } });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.woff2': 'font/woff2' };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), p = url.pathname;
  const json = (body, status = 200, tag) => { res.writeHead(status, { 'content-type': 'application/json', ...(tag ? { etag: tag } : {}) }); res.end(JSON.stringify(body)); };
  if (p.startsWith('/ext/')) {
    const file = join(root, p.slice(5));
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    return res.end(readFileSync(file));
  }
  if (p === '/repos/o/r/pulls/1') {
    const tag = `"${etag}"`;
    if (req.headers['if-none-match'] === tag) { res.writeHead(304); return res.end(); }
    return json(pull(), 200, tag);
  }
  if (p === '/repos/o/r/pulls/1/files') return json(url.searchParams.get('page') === '1' ? ['src/a.ts', 'b.md'].map((f) => ({ filename: f, status: 'modified', sha: blob(head, f) })) : []);
  const content = p.match(/^\/repos\/o\/r\/contents\/(.+)$/);
  if (content) { res.writeHead(200); return res.end(repo[url.searchParams.get('ref')][decodeURIComponent(content[1])]); }
  if (p === '/repos/o/r/pulls/1/comments' && req.method === 'GET') {
    const newest = url.searchParams.get('per_page') === '1';
    const tag = `"c${comments.length}"`;
    if (newest && req.headers['if-none-match'] === tag) { res.writeHead(304); return res.end(); }
    return json(newest ? comments.slice(-1) : comments, 200, newest ? tag : undefined);
  }
  if (req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    body = JSON.parse(body);
    posted.push({ url: p, ...body });
    const reply = p.match(/comments\/(\d+)\/replies$/);
    // github takes line comments only near a change; line 1500 of a.ts is nowhere near one
    if (!reply && body.line > 1000) return json({ message: 'Validation Failed' }, 422);
    const c = { id: 100 + comments.length, body: body.body, user: { login: 'pawan' }, created_at: new Date().toISOString(), html_url: 'https://github.com/x',
      ...(reply ? { in_reply_to_id: Number(reply[1]), path: comments.find((x) => x.id === Number(reply[1])).path, line: comments.find((x) => x.id === Number(reply[1])).line, side: 'RIGHT' }
        : body.subject_type === 'file' ? { path: body.path, line: null, subject_type: 'file' } : { path: body.path, line: body.line, side: body.side }) };
    comments.push(c); updated = new Date().toISOString(); etag++;
    return json(c, 201);
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port, origin = `http://localhost:${port}`;

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
await page.addInitScript(() => { Object.defineProperty(window, 'chrome', { value: { storage: { sync: { get: async () => ({ token: 'fake' }) } } } }); });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${origin}/ext/review.html?owner=o&repo=r&pr=1&api=${encodeURIComponent(origin)}&every=400`);
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures++; };
const footer = () => page.textContent('#s');
await page.waitForFunction(() => /diffed in/.test(document.getElementById('s').textContent), null, { timeout: 15000 });
check(true, `loaded: ${await footer()}`);

// the comment GitHub already has is a pin on line 10, and the file list counts it
await page.waitForSelector('.pin:not(.ghost):not([hidden])');
check((await page.textContent('.file.on')).includes('●1'), 'file list shows one thread on src/a.ts');
await page.click('.pin:not(.ghost)');
check((await page.textContent('.thread')).includes('why 11?'), 'the pin opens the thread from GitHub');

// reply in it
await page.fill('.thread textarea', 'it was off by one');
await page.keyboard.press('Control+Enter');
await page.waitForFunction(() => !document.querySelector('.thread'));
check(posted.at(-1)?.url.endsWith('/comments/7/replies') && posted.at(-1).body === 'it was off by one', 'reply posted to the thread');
await page.waitForFunction(() => document.querySelector('.pin:not(.ghost)')?.textContent === '2');
check(true, 'the pin now counts two comments');

// a new comment from the gutter, on the line under the mouse
const canvas = await page.$('.main canvas[role=img]');
const box = await canvas.boundingBox();
const cellH = 13 * 1.75;   // the viewer's default font size times its line height
await page.mouse.move(box.x + 20, box.y + cellH * 6.5);
await page.waitForSelector('.pin.ghost:not([hidden])');
await page.click('.pin.ghost');
await page.fill('.thread textarea', 'gutter comment');
await page.click('.thread .go');
await page.waitForFunction(() => !document.querySelector('.thread'));
const sent = posted.at(-1);
check(sent.url.endsWith('/pulls/1/comments') && sent.commit_id === head && sent.path === 'src/a.ts' && sent.line === 7 && sent.side === 'RIGHT', `gutter comment posted: line ${sent.line} ${sent.side}`);
await page.waitForFunction(() => document.querySelectorAll('.pin:not(.ghost):not([hidden])').length === 2);
check(true, 'and pinned where it was written');

// far from any change: GitHub says 422, seams posts a file comment that remembers the line
await page.focus('.main canvas[role=img]');
await page.keyboard.press('End');
await page.waitForTimeout(200);
await page.mouse.move(box.x + 20, box.y + cellH * 10.5);
await page.waitForSelector('.pin.ghost:not([hidden])');
await page.click('.pin.ghost');
await page.fill('.thread textarea', 'far away');
await page.click('.thread .go');
await page.waitForFunction(() => !document.querySelector('.thread'));
const fileComment = posted.at(-1);
check(fileComment.subject_type === 'file' && /^`L\d+` · far away$/.test(fileComment.body), `fell back to a file comment: ${fileComment.body}`);
await page.waitForFunction(() => document.querySelectorAll('.pin:not(.ghost):not([hidden])').length >= 1);
const farPin = await page.evaluate(() => [...document.querySelectorAll('.pin:not(.ghost):not([hidden])')].map((p) => p.title));
check(farPin.some((t) => t.endsWith(': far away')), 'pinned back on its own line, without the L prefix');

// a push: a.ts changes again near the end. the view stays on a.ts at the same place and fetches one file
const before = await page.evaluate(() => document.querySelector('.seams-review .files-head b').textContent);
const next = 'd'.repeat(40);
repo[next] = { 'src/a.ts': repo[head]['src/a.ts'].replace('const a1990 = 1990;', 'const a1990 = 0;\nconst extra = 1;'), 'b.md': repo[head]['b.md'] };
const contentGets = [];
page.on('request', (r) => { if (r.url().includes('/contents/')) contentGets.push(r.url()); });
head = next; updated = new Date().toISOString(); etag++;
await page.waitForFunction(() => /updated to dddddd/.test(document.getElementById('s').textContent), null, { timeout: 10000 });
const after = await page.evaluate(() => document.querySelector('.seams-review .files-head b').textContent);
check(contentGets.length === 1 && contentGets[0].includes('src/a.ts'), `only the changed file was fetched again (${contentGets.length})`);
check((await page.textContent('.file.on')).includes('a.ts'), 'still on src/a.ts');
await page.waitForFunction(() => /updated to dddddd.*diffed in/.test(document.getElementById('s').textContent));
check(true, `footer: ${await footer()}`);
check(before !== after, `totals moved: "${before}" → "${after}"`);
const visible = await page.evaluate(() => [...document.querySelectorAll('.pin')].filter((p) => p.checkVisibility()).map((p) => p.title));
check(visible.length === 1 && visible[0].endsWith('far away'), `only pins on screen are drawn (${visible.length})`);
// the thread open on screen, for a look
await page.click('.pin:not(.ghost):not([hidden])');
await page.screenshot({ path: join(root, '..', 'bench', 'results', 'sync.png') });

check(errors.length === 0, `no page errors ${errors.join(' | ')}`);
await browser.close(); server.close();
if (failures) { console.log(`${failures} failed`); process.exit(1); }
