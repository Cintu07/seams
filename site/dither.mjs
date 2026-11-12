// The footer: "seams" as big as the page is wide, drawn in ordered (bayer) dither. Every cell is one
// pixel of a small canvas that css scales up without smoothing. Brightness is the word itself, a slow
// wave across it, a light that follows the pointer, and rings that spread from wherever you click.
// It only animates while it's on screen, and holds still for people who ask for less motion.
const BAYER = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map((v) => (v + 0.5) / 64);
const hex = (c) => { const v = c.trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };

export function dither(canvas, { word = 'seams', cell = 4 } = {}) {
  const ctx = canvas.getContext('2d');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let cols = 0, rows = 0, mask = null, image = null, colours = null;
  let pointer = null, glow = 0, ripples = [], visible = false, frame = 0;

  function readColours() {
    const css = getComputedStyle(document.documentElement);
    colours = { page: hex(css.getPropertyValue('--page')), ink: hex(css.getPropertyValue('--ink')), accent: hex(css.getPropertyValue('--accent')), red: hex(css.getPropertyValue('--red')) };
  }
  // the word's shape, one value per cell: 1 inside a letter, fading at the edges
  function layout() {
    const box = canvas.getBoundingClientRect();
    const step = box.width < 600 ? cell - 1 : cell;   // finer cells on a phone, or the letters turn to blocks
    cols = Math.max(40, Math.round(box.width / step)); rows = Math.max(16, Math.round(box.height / step));
    canvas.width = cols; canvas.height = rows;
    const off = new OffscreenCanvas(cols, rows), o = off.getContext('2d', { willReadFrequently: true });
    o.fillStyle = '#fff'; o.textAlign = 'center'; o.textBaseline = 'alphabetic';
    // as tall as the strip allows, unless that is wider than the page (letter spacing included)
    const set = (px) => { o.font = `${px}px Dot, monospace`; o.letterSpacing = `${Math.round(px * 0.04)}px`; };
    let size = rows * 1.05;
    set(size);
    const fit = (cols * 0.94) / o.measureText(word).width;
    if (fit < 1) { size *= fit; set(size); }
    o.fillText(word, cols / 2, rows * 0.5 + size * 0.36);
    const data = o.getImageData(0, 0, cols, rows).data;
    mask = new Float32Array(cols * rows);
    for (let i = 0; i < mask.length; ++i) mask[i] = data[i * 4 + 3] / 255;
    image = ctx.createImageData(cols, rows);
    readColours();
  }

  function draw(now) {
    if (!image) return;   // the font isn't in yet, so there is no word to draw
    const t = calm.matches ? 0 : now / 1000;
    const px = image.data, { page, ink, accent, red } = colours;
    const R = Math.max(10, rows * 0.55), R2 = R * R;
    for (let y = 0; y < rows; ++y) {
      for (let x = 0; x < cols; ++x) {
        const i = y * cols + x, m = mask[i];
        // the word, breathing: a diagonal wave keeps some of every letter half-lit
        let v = m * (0.62 + 0.3 * Math.sin(x * 0.045 - y * 0.06 + t * 1.3));
        // a faint floor of noise-like texture under the word, densest at the bottom edge
        v += (1 - m) * Math.max(0, (y / rows - 0.72)) * 0.55;
        let lit = 0;
        if (pointer && glow > 0) {
          const dx = x - pointer.x, dy = (y - pointer.y) * 1.15, d2 = dx * dx + dy * dy;
          if (d2 < R2 * 4) { lit = Math.exp(-d2 / R2) * glow; v += lit * (m > 0.5 ? 0.38 : 0.4); }
        }
        let ring = 0;
        for (const r of ripples) {
          const dx = x - r.x, dy = y - r.y, d = Math.sqrt(dx * dx + dy * dy), front = r.age * rows * 1.6;
          const k = Math.exp(-((d - front) ** 2) / 5) * Math.max(0, 1 - r.age / 1.6);
          ring = Math.max(ring, k);
        }
        v += ring * 0.6;
        const on = v > BAYER[(y & 7) * 8 + (x & 7)];
        const c = !on ? page : ring > 0.55 ? red : m > 0.5 ? (lit > 0.3 ? accent : ink) : lit > 0.15 ? accent : ink;
        const j = i * 4;
        px[j] = c[0]; px[j + 1] = c[1]; px[j + 2] = c[2]; px[j + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  let last = 0;
  function tick(now) {
    frame = 0;
    const dt = Math.min(0.1, (now - (last || now)) / 1000); last = now;
    glow = pointer ? Math.min(1, glow + dt * 4) : Math.max(0, glow - dt * 2);
    for (const r of ripples) r.age += dt;
    ripples = ripples.filter((r) => r.age < 1.6);
    draw(now);
    if (visible && (!calm.matches || glow > 0 || ripples.length)) frame = requestAnimationFrame(tick);
  }
  const wake = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
  const toCell = (e) => { const b = canvas.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * cols, y: ((e.clientY - b.top) / b.height) * rows }; };
  canvas.addEventListener('pointermove', (e) => { pointer = toCell(e); wake(); });
  canvas.addEventListener('pointerleave', () => { pointer = null; wake(); });
  canvas.addEventListener('pointerdown', (e) => { const p = toCell(e); ripples.push({ ...p, age: 0 }); if (ripples.length > 6) ripples.shift(); wake(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); }).observe(canvas);
  new ResizeObserver(() => { layout(); draw(performance.now()); }).observe(canvas);
  document.fonts.load('40px Dot').then(() => { layout(); draw(performance.now()); });
  return { recolour() { if (image) { readColours(); draw(performance.now()); } } };
}
