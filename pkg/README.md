# seams-diff

A diff viewer for huge files. The diff runs in hand-written WebAssembly in a worker; the view is drawn
with WebGL2, one instanced quad per glyph, only the rows on screen. A 1,000,000-line diff shows its first
screen in under 200 ms and scrolls at the display's refresh rate.

Includes unified and split views, selection and copy, find (Ctrl+F), a screen-reader mirror of the
visible lines, and syntax highlighting for TypeScript/JavaScript, Rust, Python, C/C++ and Go.

## Vanilla

```js
import { createDiffViewer } from 'seams-diff';

const viewer = createDiffViewer(document.getElementById('diff'), { theme: 'sage', view: 'unified' });
await viewer.setFiles(oldText, newText, { name: 'main.rs' });
viewer.setView('split');
viewer.nextChange();
```

The element needs a height. Files can be strings, `Uint8Array`s, `ArrayBuffer`s or `Blob`s.

## React

```jsx
import { SeamsDiff } from 'seams-diff/react';

<SeamsDiff oldFile={before} newFile={after} name="main.ts" view="split" theme="dusk" style={{ height: 600 }} />
```

## Keys

Arrows, Page Up/Down, Home/End scroll; `n` / `p` jump between changes; Ctrl+F finds; Enter / Shift+Enter
step through matches; drag, shift-click or double-click to select; Ctrl+C copies.

## Bundlers

The worker and the `.wasm` file are loaded with `new URL('./file', import.meta.url)`, which Vite, webpack 5,
Rollup and esbuild handle without configuration.
