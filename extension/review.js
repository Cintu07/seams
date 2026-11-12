// Fetches a whole pull request from GitHub and opens it in the seams review view, then keeps it in
// step with GitHub while the tab is open.
// The file list comes from the API (about a dozen requests for a thousand files). The contents come
// at the exact base and head commits: for a small pull request one file at a time, for a large one as
// two repository snapshots (tarballs) unpacked as they download, keeping only the changed files.
// Review comments from GitHub are pinned to their lines, and with a token that can write pull
// requests, comments written here are posted to the pull request. New commits are picked up on their
// own: only files whose contents changed are fetched again, and the view stays on the same line.
import { createReview } from './lib/review.mjs';
import { filesFromTarball } from './tarball.mjs';

const q = new URLSearchParams(location.search);
const [owner, repo, number] = [q.get('owner'), q.get('repo'), q.get('pr')];
// a local stand-in for api.github.com, for the tests; nothing else may receive the token
const API = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(q.get('api') ?? '') ? q.get('api') : 'https://api.github.com';
const status = document.getElementById('s');
let failed = false;
const say = (text, bad = false) => { if (failed && !bad) return; status.textContent = text; status.className = bad ? 'bad' : ''; };
const { token } = await chrome.storage.sync.get('token');
const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const TARBALL_ABOVE = 100;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PULL = `/repos/${owner}/${repo}/pulls/${number}`;

class GitHubError extends Error { constructor(message, status) { super(message); this.status = status; } }
async function api(path, { method = 'GET', body } = {}) {
  const init = { method, headers: { ...headers }, cache: 'no-store' };
  if (body) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(API + path, init);
  if (r.ok) return r.json();
  throw failure(r, method, path);
}
function failure(r, method, path) {
  if (method !== 'GET' && (r.status === 403 || r.status === 404)) return new GitHubError('This token cannot comment here. In the extension options, use a token with "Pull requests: read and write" on this repository.', r.status);
  if (r.status === 403 || r.status === 429) return new GitHubError('GitHub rate limit reached. Add a token in the extension options and try again.', r.status);
  if (r.status === 404) return new GitHubError(token ? 'Pull request not found, or the token cannot see this repository.' : 'Pull request not found. For a private repository, add a token in the extension options.', 404);
  return new GitHubError(`GitHub said ${r.status} for ${method} ${path}`, r.status);
}
// a GET that costs nothing when nothing changed: GitHub answers 304 to a matching etag
const etags = new Map();
async function poll(path) {
  const r = await fetch(API + path, { headers: { ...headers, ...(etags.has(path) ? { 'If-None-Match': etags.get(path) } : {}) }, cache: 'no-store' });
  if (r.status === 304) return null;
  if (!r.ok) throw failure(r, 'GET', path);
  if (r.headers.get('etag')) etags.set(path, r.headers.get('etag'));
  return r.json();
}
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
// one file's bytes at one commit, retried when GitHub asks to slow down or hiccups
async function fileAt(fullName, sha, path) {
  const url = token || API !== 'https://api.github.com' ? `${API}/repos/${fullName}/contents/${encodePath(path)}?ref=${sha}` : `https://raw.githubusercontent.com/${fullName}/${sha}/${encodePath(path)}`;
  for (let attempt = 0; ; ++attempt) {
    const r = await fetch(url, url.startsWith(API) ? { headers: { ...headers, Accept: 'application/vnd.github.raw' } } : {});
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await wait(500 * 2 ** attempt); continue; }
    throw new Error(`could not read ${path} at ${sha.slice(0, 7)} (GitHub said ${r.status})`);
  }
}
// a fixed number of requests in flight; the first failure stops everything and is what you see
async function pool(items, limit, work, onDone) {
  let next = 0, done = 0, stop = null;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length && !stop) {
      const i = next++;
      try { await work(items[i]); } catch (error) { stop ??= error; }
      onDone(++done);
    }
  }));
  if (stop) throw stop;
}
const asText = (bytes) => (bytes === undefined ? undefined : bytes.includes(0) ? undefined : new TextDecoder().decode(bytes));

// file contents by what they are: the old side by base commit and path, the new side by blob, so a
// push that touches three files fetches three files
const known = new Map();
const oldPath = (f) => f.previous_filename ?? f.filename;
const oldKey = (pr, f) => `${pr.base.sha}:${oldPath(f)}`, newKey = (f) => `blob:${f.sha}`;

async function listFiles(pr) {
  const changed = [];
  for (let page = 1; changed.length < pr.changed_files && page <= 30; ++page) {
    const batch = await api(`${PULL}/files?per_page=100&page=${page}`);
    if (!batch.length) break;
    changed.push(...batch);
    say(`listing files… ${changed.length.toLocaleString('en')} of ${pr.changed_files.toLocaleString('en')}`);
  }
  return changed;
}

async function readFiles(pr, changed) {
  const base = pr.base.repo.full_name, head = (pr.head.repo ?? pr.base.repo).full_name;
  const wantOld = changed.filter((f) => f.status !== 'added' && !known.has(oldKey(pr, f)));
  const wantNew = changed.filter((f) => f.status !== 'removed' && !known.has(newKey(f)));
  if (wantOld.length + wantNew.length > 2 * TARBALL_ABOVE) {
    // two snapshots instead of thousands of requests
    const viaApi = token || API !== 'https://api.github.com';
    const tarball = (full, sha) => (viaApi ? `${API}/repos/${full}/tarball/${sha}` : `https://codeload.github.com/${full}/tar.gz/${sha}`);
    const init = viaApi ? { headers } : {};
    let mb = [0, 0];
    const show = () => say(`downloading both snapshots… ${(mb[0] + mb[1]).toFixed(0)} MB`);
    const [before, after] = await Promise.all([
      wantOld.length ? filesFromTarball(tarball(base, pr.base.sha), new Set(wantOld.map(oldPath)), { init, onProgress: (n) => { mb[0] = n / 2 ** 20; show(); } }) : new Map(),
      wantNew.length ? filesFromTarball(tarball(head, pr.head.sha), new Set(wantNew.map((f) => f.filename)), { init, onProgress: (n) => { mb[1] = n / 2 ** 20; show(); } }) : new Map(),
    ]);
    for (const f of wantOld) known.set(oldKey(pr, f), before.get(oldPath(f)) ?? new Uint8Array(0));
    for (const f of wantNew) known.set(newKey(f), after.get(f.filename) ?? new Uint8Array(0));
  } else {
    const jobs = [...wantOld.map((f) => [oldKey(pr, f), base, pr.base.sha, oldPath(f)]), ...wantNew.map((f) => [newKey(f), head, pr.head.sha, f.filename])];
    await pool(jobs, 8, async ([key, full, sha, path]) => known.set(key, await fileAt(full, sha, path)),
      (n) => say(`reading files… ${n.toLocaleString('en')} of ${jobs.length.toLocaleString('en')}`));
  }
  const files = [];
  let binary = 0;
  for (const f of changed) {
    const old = f.status === 'added' ? null : asText(known.get(oldKey(pr, f)));
    const now = f.status === 'removed' ? null : asText(known.get(newKey(f)));
    if (old === undefined || now === undefined) { binary++; continue; }
    files.push(f.previous_filename ? { path: f.filename, oldPath: f.previous_filename, old, new: now } : { path: f.filename, old, new: now });
  }
  return { files, binary, fetched: wantOld.length + wantNew.length };
}

// review comments, as threads pinned to lines. A comment GitHub could only take as a comment on the
// whole file (its line was outside the diff GitHub shows) starts with `L12` and goes back on line 12.
const FILE_LINE = /^`L(\d+)( \(old\))?` · /;
let changedNow = [];
async function loadComments() {
  const all = [];
  for (let page = 1; page <= 30; ++page) {
    const batch = await api(`${PULL}/comments?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  all.sort((x, y) => x.created_at.localeCompare(y.created_at));
  const threads = new Map(), skipped = new Set();
  for (const c of all) {
    const root = c.in_reply_to_id ?? c.id;
    if (skipped.has(root)) continue;
    const item = { author: c.user?.login ?? 'ghost', body: c.body ?? '', at: c.created_at, url: c.html_url };
    if (threads.has(root)) { threads.get(root).comments.push(item); continue; }
    let line = c.line, side = c.side === 'LEFT' ? 'a' : 'b';
    if (c.subject_type === 'file') {
      const m = item.body.match(FILE_LINE);
      if (m) { line = Number(m[1]); side = m[2] ? 'a' : 'b'; item.body = item.body.slice(m[0].length); }
      else { line = 1; side = changedNow.find((f) => f.filename === c.path)?.status === 'removed' ? 'a' : 'b'; }
    }
    // no line: the code it was about has changed since, and GitHub leaves it out of the diff too
    if (line == null) { skipped.add(root); continue; }
    threads.set(root, { id: root, path: c.path, line, side, comments: [item] });
  }
  review?.setNotes([...threads.values()]);
  return { threads: threads.size, outdated: skipped.size };
}

let review = null, pr = null, loaded = '';   // loaded: what the last fetch brought, for the footer
async function postNote({ path, line, side, body, thread }) {
  if (!token) throw new Error('To comment from here, add a token with "Pull requests: read and write" in the extension options.');
  if (thread) await api(`${PULL}/comments/${thread}/replies`, { method: 'POST', body: { body } });
  else {
    try {
      await api(`${PULL}/comments`, { method: 'POST', body: { body, commit_id: pr.head.sha, path, line, side: side === 'a' ? 'LEFT' : 'RIGHT' } });
    } catch (error) {
      // GitHub only takes line comments inside the hunks it shows; anywhere else it becomes a file comment that says its line
      if (error.status !== 422) throw error;
      await api(`${PULL}/comments`, { method: 'POST', body: { body: `\`L${line}${side === 'a' ? ' (old)' : ''}\` · ${body}`, commit_id: pr.head.sha, path, subject_type: 'file' } });
    }
  }
  await loadComments();
}

const short = (sha) => sha.slice(0, 7);
function showTitle() {
  document.title = `seams · ${pr.title}`;
  const title = document.getElementById('title');
  title.textContent = `${owner}/${repo} #${number} · ${pr.title}${pr.merged_at ? ' (merged)' : pr.state === 'closed' ? ' (closed)' : ''}`;
  title.href = pr.html_url;
}

try {
  const t0 = performance.now();
  pr = await poll(PULL);
  showTitle();
  changedNow = await listFiles(pr);
  const first = await readFiles(pr, changedNow);
  loaded = `${first.files.length.toLocaleString('en')} files${first.binary ? ` (${first.binary} binary skipped)` : ''} fetched in ${((performance.now() - t0) / 1000).toFixed(1)} s`;
  review = createReview(document.getElementById('r'), {
    onNote: postNote,
    onChange: (e) => { if (e.counted) say(`${loaded} · every file diffed in ${e.ms.toFixed(0)} ms, in this tab · watching GitHub for changes`); },
  });
  await review.setFiles(first.files);
  if (pr.changed_files > changedNow.length) say(`GitHub lists at most ${changedNow.length.toLocaleString('en')} of this pull request's ${pr.changed_files.toLocaleString('en')} files`, true);
  await loadComments();
  watch();
} catch (error) {
  failed = true;
  say(error.message, true);
}

// keep up with GitHub. One request per check, and a 304 when nothing changed, which GitHub doesn't
// count against a token's limit. Without a token every request counts (60 an hour), so it checks less.
function watch() {
  const every = Number(q.get('every')) || (token ? 10_000 : 120_000);
  let busy = false, seenUpdate = pr.updated_at;
  // with a token the newest comment is watched too (free when unchanged); without one, a new comment
  // shows up as the pull request's updated_at moving
  const NEWEST = `${PULL}/comments?per_page=1&sort=updated&direction=desc`;
  if (token) poll(NEWEST).catch(() => {});
  async function check() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const fresh = await poll(PULL);
      if (fresh) {
        const before = pr;
        pr = fresh;
        showTitle();
        if (fresh.head.sha !== before.head.sha || fresh.base.sha !== before.base.sha) {
          say(`new commits: ${short(before.head.sha)} → ${short(fresh.head.sha)}, fetching what changed…`);
          changedNow = await listFiles(fresh);
          const next = await readFiles(fresh, changedNow);
          loaded = `updated to ${short(fresh.head.sha)} at ${new Date().toLocaleTimeString()}: ${next.fetched} file version${next.fetched === 1 ? '' : 's'} fetched, ${next.files.length.toLocaleString('en')} files`;
          await review.setFiles(next.files, { keep: true });
        }
        if (fresh.updated_at !== seenUpdate) { seenUpdate = fresh.updated_at; if (!token) await loadComments(); }
      }
      if (token && await poll(NEWEST)) await loadComments();
    } catch (error) {
      say(`couldn't check GitHub for changes (${error.message}); trying again`, false);
    } finally { busy = false; }
  }
  setInterval(check, every);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
}
