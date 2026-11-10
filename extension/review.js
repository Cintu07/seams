// Fetches a whole pull request from GitHub and opens it in the seams review view.
// The file list comes from the API (about a dozen requests for a thousand files). The contents come
// at the exact base and head commits: for a small pull request one file at a time, for a large one as
// two repository snapshots (tarballs) unpacked as they download, keeping only the changed files.
// With a token saved in the options page, private repositories work too.
import { createReview } from './lib/review.mjs';
import { filesFromTarball } from './tarball.mjs';

const q = new URLSearchParams(location.search);
const [owner, repo, number] = [q.get('owner'), q.get('repo'), q.get('pr')];
const status = document.getElementById('s');
let failed = false;
const say = (text, bad = false) => { if (failed && !bad) return; status.textContent = text; status.className = bad ? 'bad' : ''; };
const { token } = await chrome.storage.sync.get('token');
const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const TARBALL_ABOVE = 100;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path) {
  const r = await fetch(`https://api.github.com${path}`, { headers });
  if (r.status === 403 || r.status === 429) throw new Error('GitHub rate limit reached. Add a token in the extension options and try again.');
  if (r.status === 404) throw new Error(token ? 'Pull request not found, or the token cannot see this repository.' : 'Pull request not found. For a private repository, add a token in the extension options.');
  if (!r.ok) throw new Error(`GitHub said ${r.status} for ${path}`);
  return r.json();
}
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
// one file's bytes at one commit, retried when GitHub asks to slow down or hiccups
async function fileAt(fullName, sha, path) {
  const url = token ? `https://api.github.com/repos/${fullName}/contents/${encodePath(path)}?ref=${sha}` : `https://raw.githubusercontent.com/${fullName}/${sha}/${encodePath(path)}`;
  for (let attempt = 0; ; ++attempt) {
    const r = await fetch(url, token ? { headers: { ...headers, Accept: 'application/vnd.github.raw' } } : {});
    if (r.ok) return new Uint8Array(await r.arrayBuffer());
    if ((r.status === 429 || r.status >= 500) && attempt < 4) { await wait(500 * 2 ** attempt); continue; }
    throw new Error(`could not read ${path} at ${sha.slice(0, 7)} (GitHub said ${r.status})`);
  }
}
// a fixed number of requests in flight; the first failure stops everything and is what you see
async function pool(items, limit, work, onDone) {
  let next = 0, done = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length && !failed) { const i = next++; results[i] = await work(items[i]); onDone(++done); }
  }));
  return results;
}
const asText = (bytes) => (bytes === undefined ? undefined : bytes.includes(0) ? undefined : new TextDecoder().decode(bytes));

try {
  const t0 = performance.now();
  const pr = await api(`/repos/${owner}/${repo}/pulls/${number}`);
  document.title = `seams · ${pr.title}`;
  const title = document.getElementById('title');
  title.textContent = `${owner}/${repo} #${number} · ${pr.title}`;
  title.href = pr.html_url;
  const changed = [];
  for (let page = 1; changed.length < pr.changed_files && page <= 30; ++page) {
    const batch = await api(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    if (!batch.length) break;
    changed.push(...batch);
    say(`listing files… ${changed.length.toLocaleString('en')} of ${pr.changed_files.toLocaleString('en')}`);
  }
  const base = pr.base.repo.full_name, head = (pr.head.repo ?? pr.base.repo).full_name;
  const oldPath = (f) => f.previous_filename ?? f.filename;
  let read;   // (file) => [old text | null, new text | null], undefined for binary
  if (changed.length > TARBALL_ABOVE) {
    // two snapshots instead of thousands of requests
    const tarball = (full, sha) => (token ? `https://api.github.com/repos/${full}/tarball/${sha}` : `https://codeload.github.com/${full}/tar.gz/${sha}`);
    const init = token ? { headers } : {};
    let mb = [0, 0];
    const show = () => say(`downloading both snapshots… ${(mb[0] + mb[1]).toFixed(0)} MB`);
    const [before, after] = await Promise.all([
      filesFromTarball(tarball(base, pr.base.sha), new Set(changed.filter((f) => f.status !== 'added').map(oldPath)), { init, onProgress: (n) => { mb[0] = n / 2 ** 20; show(); } }),
      filesFromTarball(tarball(head, pr.head.sha), new Set(changed.filter((f) => f.status !== 'removed').map((f) => f.filename)), { init, onProgress: (n) => { mb[1] = n / 2 ** 20; show(); } }),
    ]);
    read = (f) => [f.status === 'added' ? null : asText(before.get(oldPath(f)) ?? new Uint8Array(0)), f.status === 'removed' ? null : asText(after.get(f.filename) ?? new Uint8Array(0))];
  } else {
    const fetched = await pool(changed, 8, async (f) => [
      f.status === 'added' ? null : asText(await fileAt(base, pr.base.sha, oldPath(f))),
      f.status === 'removed' ? null : asText(await fileAt(head, pr.head.sha, f.filename)),
    ], (n) => say(`reading files… ${n.toLocaleString('en')} of ${changed.length.toLocaleString('en')}`));
    const byFile = new Map(changed.map((f, i) => [f, fetched[i]]));
    read = (f) => byFile.get(f);
  }
  const files = [];
  let binary = 0;
  for (const f of changed) {
    const [old, now] = read(f);
    if (old === undefined || now === undefined) { binary++; continue; }
    files.push(f.previous_filename ? { path: f.filename, oldPath: f.previous_filename, old, new: now } : { path: f.filename, old, new: now });
  }
  const fetchedIn = performance.now() - t0;
  const review = createReview(document.getElementById('r'), {
    onChange: (e) => { if (e.counted) say(`${files.length.toLocaleString('en')} files${binary ? ` (${binary} binary skipped)` : ''} fetched in ${(fetchedIn / 1000).toFixed(1)} s · every file diffed in ${e.ms.toFixed(0)} ms, in this tab`); },
  });
  await review.setFiles(files);
  if (pr.changed_files > changed.length) say(`GitHub lists at most ${changed.length.toLocaleString('en')} of this pull request's ${pr.changed_files.toLocaleString('en')} files`, true);
} catch (error) {
  failed = true;
  say(error.message, true);
}
