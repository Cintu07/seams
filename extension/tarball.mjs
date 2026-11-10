// Reads chosen files out of a .tar.gz while it downloads: gunzip as a stream, walk the 512-byte tar
// headers, keep only the paths asked for, skip everything else without storing it. A whole repository
// snapshot passes through; only the changed files stay in memory.
// GitHub's tarballs put every path under one top folder (owner-repo-sha/) and use pax headers for
// long names; both are handled.
const BLOCK = 512;
const text = (b) => new TextDecoder().decode(b.subarray(0, Math.max(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0))));
const octal = (b) => parseInt(text(b).trim() || '0', 8);

export async function filesFromTarball(url, wanted, { init = {}, onProgress = () => {} } = {}) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`could not download ${url.split('/').slice(-1)[0].slice(0, 7)} (${response.status})`);
  const reader = response.body.pipeThrough(new DecompressionStream('gzip')).getReader();
  const found = new Map();
  let pending = new Uint8Array(0), seen = 0;
  let want = BLOCK, mode = 'header', entry = null, longName = null;
  // hand out exactly n bytes once they have arrived
  const take = (n) => { const out = pending.subarray(0, n); pending = pending.subarray(n); return out; };
  for (;;) {
    while (pending.length >= want) {
      if (mode === 'header') {
        const h = take(BLOCK);
        if (h.every((x) => x === 0)) { want = BLOCK; continue; }               // the two empty blocks at the end
        const size = octal(h.subarray(124, 136)), type = String.fromCharCode(h[156] || 48);
        const prefix = text(h.subarray(345, 500)), name = longName ?? (prefix ? `${prefix}/${text(h.subarray(0, 100))}` : text(h.subarray(0, 100)));
        longName = null;
        const path = name.split('/').slice(1).join('/');                           // drop owner-repo-sha/
        entry = { type, size, path, keep: type === 'x' || (type === '0' && wanted.has(path)) };
        mode = 'body'; want = Math.ceil(size / BLOCK) * BLOCK;
        if (want === 0) { if (entry.keep && type === '0') found.set(path, new Uint8Array(0)); mode = 'header'; want = BLOCK; }
      } else {
        const body = take(want).subarray(0, entry.size);
        if (entry.type === 'x') { const m = new TextDecoder().decode(body).match(/\d+ path=([^\n]*)\n/); if (m) longName = m[1]; }
        else if (entry.keep) found.set(entry.path, body.slice());
        mode = 'header'; want = BLOCK;
      }
    }
    const { value, done } = await reader.read();
    if (done) break;
    seen += value.length;
    onProgress(seen);
    const next = new Uint8Array(pending.length + value.length);
    next.set(pending); next.set(value, pending.length);
    pending = next;
  }
  return found;
}
