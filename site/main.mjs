// The site's one script: the real viewer, the pixel city, the theme, the three demos.
import { createDiffViewer } from './web/embed.mjs';
import { THEMES, face, drawSkyline } from './web/look.mjs';

const $ = (id) => document.getElementById(id);
const storage = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
                  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window */ } } };
let theme = storage.get('seams-site-theme') === 'dusk' ? THEMES.dusk : THEMES.sage;

// ---------------------------------------------------------------- look

function paint() {
  document.documentElement.dataset.theme = theme.name;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme.name === 'dusk' ? '#252f39' : '#c3dbc8');
  drawSkyline($('city'), theme, 11);
  $('mascot').innerHTML = face(current ? 'happy' : 'idle', { scale: 6, accent: theme.renderer.insertedMark });
  $('mascotSmall').innerHTML = face(theme.name === 'dusk' ? 'sleepy' : 'idle', { scale: 2, accent: theme.renderer.insertedMark });
  viewer.setTheme(theme.name);
}
$('theme').addEventListener('click', () => {
  theme = theme.name === 'sage' ? THEMES.dusk : THEMES.sage;
  storage.set('seams-site-theme', theme.name);
  paint();
});
new ResizeObserver(() => drawSkyline($('city'), theme, 11)).observe($('city'));

// small pixel pictures for the use cards: '#' ink, '+' accent
const ICONS = {
  wall: ['############', '#..#..#..#.#', '############', '#.#..#..#..#', '############', '#..#..#..#.#', '############', '.....++.....', '....++++....'],
  bot: ['.....++.....', '.....#......', '.##########.', '.#........#.', '.#.##..##.#.', '.#........#.', '.#..####..#.', '.##########.', '..#......#..'],
  table: ['############', '#++++#+++++#', '############', '#....#.....#', '############', '#....#.....#', '############', '#....#.....#', '############'],
  gear: ['....####....', '..#.#..#.#..', '.##########.', '.##......##.', '###..++..###', '.##......##.', '.##########.', '..#.#..#.#..', '....####....'],
  plug: ['...#....#...', '...#....#...', '.##########.', '.#........#.', '.#..++++..#.', '.#........#.', '..########..', '.....##.....', '.....##.....'],
  merge: ['#..........#', '#..........#', '.#........#.', '..#......#..', '...#....#...', '....#..#....', '.....++.....', '.....++.....', '.....++.....'],
};
function pixels(rows, scale = 3) {
  const h = rows.length, w = rows[0].length;
  let rects = '';
  rows.forEach((row, y) => [...row].forEach((c, x) => {
    if (c !== '.') rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c === '+' ? 'var(--accent)' : 'var(--ink)'}"/>`;
  }));
  return `<svg class="px" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
for (const card of document.querySelectorAll('.card[data-icon]')) card.insertAdjacentHTML('afterbegin', pixels(ICONS[card.dataset.icon]));

// ---------------------------------------------------------------- the viewer

const viewer = createDiffViewer($('viewer'), { theme: theme.name });
let current = null, busy = false;
const fmt = (n) => n.toLocaleString('en');

function report(stats, extra = '') {
  current = stats;
  const t = stats.timing;
  $('stats').textContent = `${fmt(stats.rows)} rows · −${fmt(stats.deleted)} +${fmt(stats.inserted)} · diff ${t.diff.toFixed(1)} ms · ` +
    `first frame ${t.firstFrame.toFixed(1)} ms${extra}`;
  $('mascot').innerHTML = face('happy', { scale: 6, accent: theme.renderer.insertedMark });
}

function choose(name) {
  for (const chip of document.querySelectorAll('[data-demo]')) chip.classList.toggle('on', chip.dataset.demo === name);
}

async function run(name, work) {
  if (busy) return;
  busy = true;
  choose(name);
  $('stats').textContent = 'working…';
  try { await work(); } catch (e) { $('stats').textContent = String(e.message ?? e); }
  busy = false;
}

// a real change to seams itself: web/embed.mjs before and after packs were added
async function ownCode() {
  const [a, b] = await Promise.all(['demo/embed.old.mjs', 'demo/embed.new.mjs'].map((u) => fetch(u).then((r) => r.text())));
  report(await viewer.setFiles(a, b, { name: 'embed.mjs' }), ' · web/embed.mjs, the commit that added packs');
}

// a million lines of plausible code, generated here, then one hundred scattered edits
const WORDS = ['table', 'offset', 'length', 'index', 'cursor', 'buffer', 'rows', 'line', 'start', 'count', 'piece', 'node', 'edit', 'range'];
const lineOf = (i, edited) => {
  const w = WORDS[i % WORDS.length], v = WORDS[(i * 7) % WORDS.length];
  switch (i % 9) {
    case 0: return `export function ${w}At${i}(${v}: number): number {`;
    case 1: return `  const ${w} = ${v} * ${(i * 2654435761) % 997} + ${edited ? 'delta' : i % 13};`;
    case 2: return `  if (${w} > ${v}.length) return -1;`;
    case 3: return `  // ${edited ? 'checked against the cached piece first' : 'walks the pieces from the left'}`;
    case 4: return `  for (let k = 0; k < ${w}; k++) ${v}[k] += ${i % 31};`;
    case 5: return `  const label = "${w}-${i}";`;
    case 6: return `  return ${w} ${edited ? '>>> 0' : '| 0'};`;
    case 7: return '}';
    default: return '';
  }
};
async function million() {
  const t0 = performance.now();
  const LINES = 1_000_000, edits = new Set();
  let seed = 17;
  // only some line shapes read differently when edited (see lineOf), so every edit lands on one
  while (edits.size < 100) { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; const i = seed % (LINES - 9); edits.add(i - (i % 9) + [1, 3, 6][seed % 3]); }
  const encoder = new TextEncoder(), build = (edited) => {
    const out = new Uint8Array(LINES * 64);
    let at = 0;
    for (let i = 0; i < LINES; ++i) {
      at += encoder.encodeInto(lineOf(i, edited && edits.has(i)) + '\n', out.subarray(at)).written;
    }
    return out.slice(0, at);
  };
  const a = build(false), b = build(true);
  const made = performance.now() - t0;
  report(await viewer.setFiles(a, b, { name: 'million.ts' }), ` · the ${(a.length / 2 ** 20).toFixed(0)} MB files were generated in this tab in ${made.toFixed(0)} ms`);
}

// two of your own: the first picked is the old one
async function yours(list) {
  const files = [...list];
  if (files.length < 2) { $('stats').textContent = 'pick two files: the old one, then the new one'; return; }
  report(await viewer.setFiles(files[0], files[1], { oldName: files[0].name, newName: files[1].name }), ` · ${files[0].name} → ${files[1].name}`);
}

for (const chip of document.querySelectorAll('button[data-demo]'))
  chip.addEventListener('click', () => run(chip.dataset.demo, chip.dataset.demo === 'own' ? ownCode : million));
$('millionTop').addEventListener('click', () => { $('try').scrollIntoView(); run('million', million); });
$('files').addEventListener('change', (e) => run('files', () => yours(e.target.files)));
$('viewer').addEventListener('dragover', (e) => e.preventDefault());
$('viewer').addEventListener('drop', (e) => { e.preventDefault(); run('files', () => yours(e.dataTransfer.files)); });
$('viewToggle').addEventListener('click', () => {
  const split = $('viewToggle').getAttribute('aria-pressed') !== 'true';
  viewer.setView(split ? 'split' : 'unified');
  $('viewToggle').setAttribute('aria-pressed', String(split));
  $('viewToggle').textContent = split ? 'unified view' : 'split view';
});

paint();
run('own', ownCode);
