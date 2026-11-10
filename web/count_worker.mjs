// Diffs a batch of file pairs and sends back only the counts: lines deleted and inserted per file.
// The review uses it to fill in a whole pull request's numbers while one file is on screen.
// In: { batch: [{ i, a, b }] } (ArrayBuffers, transferred). Out: { counts: [{ i, deleted, inserted }], ms }
import { loadSeams } from '../wasm/seams.mjs';

const ready = fetch(new URL('../build/seams.wasm', import.meta.url))
  .then((r) => r.arrayBuffer())
  .then((bytes) => loadSeams(bytes));

self.onmessage = async ({ data: { batch } }) => {
  const seams = await ready;
  const t0 = performance.now();
  const counts = batch.map(({ i, a, b }) => {
    const script = seams.diff(new Uint8Array(a), new Uint8Array(b), { fast: true });
    let deleted = 0, inserted = 0;
    for (let r = 0; r < script.count; ++r) { deleted += script.aCount[r]; inserted += script.bCount[r]; }
    return { i, deleted, inserted };
  });
  self.postMessage({ counts, ms: performance.now() - t0 });
};
