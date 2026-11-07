// Themes and pixel art for the viewer.
// The canvas renderer takes a palette with the same keys in every theme; the page reads the CSS
// colours from the same object, so one table decides how everything looks.

export const THEMES = {
  sage: {
    name: 'sage',
    page: '#b9d5be', panel: '#b1cfb7', ink: '#1b2a21', soft: '#4c6a55', line: '#9fbfa6',
    sky: ['#cfe4d3', '#b9d5be'], skyInk: "#24392b", skyGlow: "rgba(255, 255, 255, .5)", building: ['#8fae97', '#7d9c86', '#6c8a75'], window: '#f6f2c8', water: '#9dbfb0',
    renderer: {
      background: '#b9d5be', text: '#1b2a21', gutter: '#6a8a73', gutterChanged: '#3e5a46',
      deletedRow: '#e3c4b6', insertedRow: '#d4ead0', deletedMark: '#a4432e', insertedMark: '#256f3e',
      deletedText: '#3a2019', insertedText: '#12301c', currentRow: '#c4ddc8', unknown: '#7a4fb0',
      emptyRow: '#adc9b2', selection: '#9cc4a6', match: '#f0d98a', matchCurrent: '#e3a94a',
      keyword: '#7b2d50', type: '#1e5f63', string: '#7d5410', number: '#a3471f', comment: '#4f6e5a', func: '#38478a',
    },
  },
  dusk: {
    name: 'dusk',
    page: '#2c3742', panel: '#26303a', ink: '#ece5d2', soft: '#9aa6ad', line: '#3a4652',
    sky: ['#55646f', '#2c3742'], skyInk: "#fdfbef", skyGlow: "rgba(15, 20, 25, .45)", building: ['#3d4954', '#34404a', '#2a343d'], window: '#f3c97a', water: '#22303b',
    renderer: {
      background: '#2c3742', text: '#ece5d2', gutter: '#76838c', gutterChanged: '#b8c2c8',
      deletedRow: '#4b3338', insertedRow: '#2d4a3d', deletedMark: '#f2907c', insertedMark: '#8fdba8',
      deletedText: '#f6dcd6', insertedText: '#d9f4e2', currentRow: '#34404c', unknown: '#c6a2f2',
      emptyRow: '#262f38', selection: '#3f5566', match: '#6b5a2a', matchCurrent: '#a8792b',
      keyword: '#f0a3c0', type: '#8fd3cf', string: '#e8c27a', number: '#f2a07b', comment: '#8a97a3', func: '#aebff2',
    },
  },
};

// '#' ink, '+' accent, '.' empty; drawn as rects so they stay crisp at any zoom
function pixels(rows, { ink = 'currentColor', accent = ink, scale = 2 } = {}) {
  const h = rows.length, w = rows[0].length;
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < w; ++x) {
      if (row[x] === '.') continue;
      rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${row[x] === '+' ? accent : ink}"/>`;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}

// a page with a folded corner and a face
const page = (eyes, mouth) => [
  '..#########.....',
  '..#.......##....',
  '..#.......#.#...',
  '..#.......####..',
  '..#..........#..',
  eyes,
  eyes,
  '..#..........#..',
  mouth[0],
  mouth[1],
  '..#..........#..',
  '..#..........#..',
  '..############..',
];

export const ICONS = {
  // the old file is a little sleepy, the new one is pleased with itself
  oldFile: page('..#..##..##..#..', ['..#..........#..', '..#...####...#..']),
  newFile: page('..#..#....#..#..', ['..#..#....#..#..', '..#...####...#..']).map((r, i) => (i === 1 ? '..#.......##.+..' : i === 0 ? '..#########...+.' : r)),
  next: [
    '................',
    '......####......',
    '......#..#......',
    '......#..#......',
    '......#..#......',
    '...####..####...',
    '....#......#....',
    '.....#....#.....',
    '......#..#......',
    '.......##.......',
    '................',
  ],
};

// the mascot: a small computer whose face follows what the viewer is doing
const screen = (face) => [
  '.##############.',
  '.#............#.',
  '.#.##########.#.',
  ...face.map((row) => `.#.#${row}#.#.`),
  '.#.##########.#.',
  '.#............#.',
  '.##############.',
  '......####......',
  '....########....',
];
export const FACES = {
  idle:   screen(['........', '..#..#..', '........', '..####..', '........']),
  busy:   screen(['........', '.##..##.', '........', '...##...', '...##...']),
  happy:  screen(['........', '.#.##.#.', '#......#', '..#..#..', '...##...']),
  same:   screen(['........', '..+..+..', '........', '.#....#.', '..####..']),
  sleepy: screen(['........', '.##..##.', '........', '...##...', '........']),
};

export const icon = (name, options) => pixels(ICONS[name], options);
export const face = (name, options) => pixels(FACES[name], options);

// A pixel city at dusk, redrawn whenever the size or theme changes. Seeded, so it never jumps.
export function drawSkyline(canvas, theme, seed = 7) {
  const pixel = 3;
  const w = Math.ceil(canvas.clientWidth / pixel), h = Math.ceil(canvas.clientHeight / pixel);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, theme.sky[0]);
  sky.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  let s = seed;
  const random = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const ground = Math.floor(h * 0.86);
  // three layers, far to near
  theme.building.forEach((colour, layer) => {
    let x = -Math.floor(random() * 6);
    while (x < w) {
      const bw = 5 + Math.floor(random() * (9 + layer * 3));
      const bh = Math.floor(h * (0.1 + random() * (0.2 + layer * 0.06)));
      const top = ground - bh + layer * 2;
      ctx.fillStyle = colour;
      ctx.fillRect(x, top, bw, ground - top);
      for (let wy = top + 2; wy < ground - 2; wy += 3)
        for (let wx = x + 1; wx < x + bw - 1; wx += 2)
          if (random() < 0.09 + layer * 0.05) { ctx.fillStyle = theme.window; ctx.fillRect(wx, wy, 1, 1); }
      x += bw + Math.floor(random() * 3);
    }
  });
  ctx.fillStyle = theme.water;
  ctx.fillRect(0, ground, w, h - ground);
  // a few glints on the water
  ctx.fillStyle = theme.window;
  for (let i = 0; i < w / 6; ++i) ctx.fillRect(Math.floor(random() * w), ground + 2 + Math.floor(random() * (h - ground - 3)), 2 + Math.floor(random() * 3), 1);
}
