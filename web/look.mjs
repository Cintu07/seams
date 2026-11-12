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
      deletedWord: '#d49a86', insertedWord: '#a9d6a3', keyword: '#7b2d50', type: '#1e5f63', string: '#7d5410', number: '#a3471f', comment: '#4f6e5a', func: '#38478a',
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
      deletedWord: '#7a4048', insertedWord: '#3d6e54', keyword: '#f0a3c0', type: '#8fd3cf', string: '#e8c27a', number: '#f2a07b', comment: '#8a97a3', func: '#aebff2',
    },
  },
  // a warm paper page for daylight and printing
  paper: {
    name: 'paper',
    page: '#f7f3e8', panel: '#efe9d9', ink: '#2a2620', soft: '#6b6455', line: '#ddd4bf',
    sky: ['#fbf8ef', '#f7f3e8'], skyInk: '#2a2620', skyGlow: 'rgba(255, 255, 255, .6)', building: ['#d8cfb8', '#c9bfa5', '#b8ad92'], window: '#fff6c8', water: '#e3dccb',
    renderer: {
      background: '#f7f3e8', text: '#2a2620', gutter: '#9a917f', gutterChanged: '#5e5647',
      deletedRow: '#f6d9d0', insertedRow: '#dcebd2', deletedMark: '#b5412b', insertedMark: '#3f7a2c',
      deletedText: '#4a1e14', insertedText: '#1d3a12', currentRow: '#efe9d9', unknown: '#7a4fb0',
      emptyRow: '#efeadb', selection: '#d9d0b5', match: '#f3dd8a', matchCurrent: '#e6a940',
      deletedWord: '#eab3a3', insertedWord: '#b9dca4', keyword: '#8a2d4f', type: '#1f6363', string: '#7a5410', number: '#a8461e', comment: '#736b5b', func: '#3a4a8f',
    },
  },
  // terracotta and sand
  clay: {
    name: 'clay',
    page: '#f1dfd0', panel: '#ead4c2', ink: '#33211a', soft: '#7a5c4c', line: '#dcc3ae',
    sky: ['#f8e7d6', '#f1dfd0'], skyInk: '#33211a', skyGlow: 'rgba(255, 250, 240, .55)', building: ['#ddc0a8', '#cfae94', '#bf9c80'], window: '#fff1c2', water: '#e3c8b2',
    renderer: {
      background: '#f1dfd0', text: '#33211a', gutter: '#a07f6c', gutterChanged: '#6a4c3d',
      deletedRow: '#ecc0b0', insertedRow: '#d6e2c0', deletedMark: '#a33a22', insertedMark: '#4d7a2a',
      deletedText: '#4a170c', insertedText: '#24360f', currentRow: '#ead4c2', unknown: '#7a4fb0',
      emptyRow: '#e8d3c1', selection: '#dcc0a8', match: '#f1d47c', matchCurrent: '#e09b3c',
      deletedWord: '#df9a84', insertedWord: '#b7cf94', keyword: '#8c2a3d', type: '#2a5f5a', string: '#7a4a0c', number: '#a5421b', comment: '#7a5d50', func: '#47468c',
    },
  },
  // near black, for oled screens and dark rooms
  ink: {
    name: 'ink',
    page: '#0e1012', panel: '#15181b', ink: '#e6e6e3', soft: '#8b9096', line: '#24282c',
    sky: ['#1a1f24', '#0e1012'], skyInk: '#e6e6e3', skyGlow: 'rgba(0, 0, 0, .5)', building: ['#1d2227', '#171b1f', '#121518'], window: '#e8c26a', water: '#0b0d0f',
    renderer: {
      background: '#0e1012', text: '#e6e6e3', gutter: '#5d6166', gutterChanged: '#a6abb1',
      deletedRow: '#3a1a1a', insertedRow: '#13301f', deletedMark: '#ff7b6b', insertedMark: '#5fd38a',
      deletedText: '#ffd9d3', insertedText: '#d3f7df', currentRow: '#181b1e', unknown: '#c6a2f2',
      emptyRow: '#0a0b0d', selection: '#2b3a4a', match: '#5a4a12', matchCurrent: '#9a7414',
      deletedWord: '#6e2a26', insertedWord: '#22603a', keyword: '#ff8fb1', type: '#7fd6d0', string: '#e7c46f', number: '#ffa36b', comment: '#6f767d', func: '#9fb6ff',
    },
  },
  // deep blue, the city at night by the water
  harbor: {
    name: 'harbor',
    page: '#13233a', panel: '#102036', ink: '#dce6f2', soft: '#91a4bb', line: '#24395a',
    sky: ['#2b4a72', '#13233a'], skyInk: '#dce6f2', skyGlow: 'rgba(5, 12, 24, .5)', building: ['#1e3554', '#192e4a', '#142640'], window: '#ffd98a', water: '#0e1c30',
    renderer: {
      background: '#13233a', text: '#dce6f2', gutter: '#5f7591', gutterChanged: '#a9bdd6',
      deletedRow: '#45283a', insertedRow: '#16403f', deletedMark: '#ff8f9a', insertedMark: '#6fe0c0',
      deletedText: '#ffe0e5', insertedText: '#d5fbef', currentRow: '#1a2d47', unknown: '#c6a2f2',
      emptyRow: '#0f1d31', selection: '#2a4a6e', match: '#5c4e1f', matchCurrent: '#a5832c',
      deletedWord: '#74364c', insertedWord: '#22675a', keyword: '#ff9ecb', type: '#7fe0e8', string: '#f2cf86', number: '#ffae85', comment: '#7489a3', func: '#a8c4ff',
    },
  },
  // white, with orange for deleted and blue for inserted instead of red and green, so the two stay
  // apart for people with red-green colour blindness
  clear: {
    name: 'clear',
    page: '#ffffff', panel: '#f4f4f4', ink: '#111111', soft: '#555555', line: '#dddddd',
    sky: ['#f4f7fb', '#ffffff'], skyInk: '#111111', skyGlow: 'rgba(255, 255, 255, .7)', building: ['#d9dee6', '#c8cfda', '#b6bfcd'], window: '#ffe9a8', water: '#e6ebf2',
    renderer: {
      background: '#ffffff', text: '#111111', gutter: '#777777', gutterChanged: '#333333',
      deletedRow: '#ffe2cc', insertedRow: '#d6e6ff', deletedMark: '#c25400', insertedMark: '#1f5fbf',
      deletedText: '#3d1a00', insertedText: '#0b2a55', currentRow: '#f2f2f2', unknown: '#6a3fb0',
      emptyRow: '#f4f4f4', selection: '#cfd8e6', match: '#ffe680', matchCurrent: '#ffb84d',
      deletedWord: '#ffbf8f', insertedWord: '#a8c8ff', keyword: '#6b1f8f', type: '#0f5a5a', string: '#7a4a00', number: '#a33a00', comment: '#6f6f6f', func: '#1d3f9a',
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
