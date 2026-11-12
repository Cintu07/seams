// The site's script: the real viewer, the pixel city, the theme, the demos, the films, the guide and the footer.
import { createDiffViewer } from './web/embed.mjs';
import { createReview } from './web/review.mjs';
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
  drawSky();
}
$('theme').addEventListener('click', () => {
  theme = theme.name === 'sage' ? THEMES.dusk : THEMES.sage;
  storage.set('seams-site-theme', theme.name);
  paint();
});
new ResizeObserver(() => { drawSkyline($('city'), theme, 11); drawSky(); }).observe($('city'));

// the sky above the city: a soft gradient that meets the city's own sky colour, a sun (or a moon at
// dusk), and pixel clouds drifting slowly while the hero is on screen
const skyCanvas = $('sky'), heroEl = document.querySelector('.hero');
const clouds = Array.from({ length: 7 }, (_, i) => ({ x: (i * 0.37) % 1, y: 0.1 + ((i * 0.53) % 1) * 0.42, w: 14 + ((i * 7) % 5) * 5, speed: 0.004 + (i % 3) * 0.003 }));
let skyStart = performance.now(), skyFrame = 0, heroVisible = true;
function drawSky(now = performance.now()) {
  const px = 3, w = Math.ceil(skyCanvas.clientWidth / px), h = Math.ceil(skyCanvas.clientHeight / px);
  if (!w || !h) return;
  if (skyCanvas.width !== w || skyCanvas.height !== h) { skyCanvas.width = w; skyCanvas.height = h; }
  const ctx = skyCanvas.getContext('2d'), dusk = theme.name === 'dusk';
  const cityTop = h - Math.ceil($('city').clientHeight / px);
  const g = ctx.createLinearGradient(0, 0, 0, Math.max(1, cityTop));
  g.addColorStop(0, dusk ? '#1d2630' : '#e6f1e4');
  g.addColorStop(1, theme.sky[0]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  let s = 5; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  if (dusk) { ctx.fillStyle = 'rgba(253, 251, 239, 0.7)'; for (let i = 0; i < w * 0.25; ++i) ctx.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * cityTop * 0.8), 1, 1); }
  // a round pixel disc: the sun, or a moon with two craters
  // on a phone the words fill the middle, so the sun goes up into the corner
  const narrow = w < 200, r = Math.max(6, Math.round(Math.min(w, h) * (narrow ? 0.045 : 0.06)));
  const cx = Math.round(w * (narrow ? 0.88 : 0.82)), cy = narrow ? r + 5 : Math.round(Math.max(r + 4, cityTop * 0.28));
  ctx.fillStyle = dusk ? '#fdfbef' : 'rgba(253, 248, 214, 0.95)';
  for (let y = -r; y <= r; ++y) { const half = Math.round(Math.sqrt(r * r - y * y)); ctx.fillRect(cx - half, cy + y, half * 2 + 1, 1); }
  if (dusk) { ctx.fillStyle = 'rgba(160, 170, 175, 0.45)'; ctx.fillRect(cx - Math.round(r * 0.4), cy - Math.round(r * 0.2), 3, 2); ctx.fillRect(cx + Math.round(r * 0.2), cy + Math.round(r * 0.35), 2, 2); }
  else { ctx.fillStyle = 'rgba(253, 248, 214, 0.35)'; for (let y = -r - 3; y <= r + 3; ++y) { const R2 = (r + 3) * (r + 3) - y * y; if (R2 < 0) continue; const half = Math.round(Math.sqrt(R2)); ctx.fillRect(cx - half, cy + y, half * 2 + 1, 1); } }
  // clouds: three stacked bars each, stepped like pixel art
  const t = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : (now - skyStart) / 1000;
  ctx.fillStyle = dusk ? 'rgba(170, 185, 196, 0.16)' : 'rgba(255, 255, 255, 0.62)';
  for (const c of clouds) {
    const x = Math.round((((c.x + t * c.speed) % 1.2) - 0.1) * w), y = Math.round(c.y * cityTop), cw = c.w;
    ctx.fillRect(x, y, cw, 3); ctx.fillRect(x + 3, y - 2, cw - 8, 2); ctx.fillRect(x + 7, y - 4, Math.max(3, cw - 16), 2);
  }
}
// clouds move a pixel every few seconds, so a few frames a second is plenty
function skyLoop(now) { skyFrame = 0; drawSky(now); if (heroVisible) skyFrame = setTimeout(() => requestAnimationFrame(skyLoop), 120); }
new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; if (heroVisible && !skyFrame) skyLoop(performance.now()); }).observe(heroEl);

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

// v inside the viewer flips unified and split, as the try-it text promises
$('viewer').addEventListener('keydown', (e) => {
  if (e.key !== 'v' || e.ctrlKey || e.metaKey || e.altKey || e.target.tagName === 'INPUT') return;
  e.preventDefault();
  $('viewToggle').click();
});

// ------------------------------------------------------------- a 5,000-file pull request
// plausible files from the same line shapes as the million-line demo: most modified a few times,
// some added, some deleted, sizes from tiny to a few thousand lines
const DIRS = ['src/core', 'src/ui', 'src/net', 'src/db', 'src/auth', 'lib/util', 'lib/parse', 'test/unit', 'test/e2e', 'tools', 'docs/api', 'src/workers'];
function pullRequest(count) {
  let seed = 99;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const files = [];
  for (let k = 0; k < count; ++k) {
    const lines = Math.round(20 + rnd() ** 3 * 3000), from = Math.floor(rnd() * 900000), edited = new Set();
    const edits = 1 + Math.floor(rnd() * 8);
    // an edit only shows on lines whose shape changes when edited (see lineOf), counted from the shared pattern
    while (edited.size < Math.min(edits, Math.floor(lines / 9))) { const i = 9 + Math.floor(rnd() * (lines - 18)); edited.add(i - ((from + i) % 9) + [1, 3, 6][Math.floor(rnd() * 3)]); }
    const text = (ed) => { let s = ''; for (let i = 0; i < lines; ++i) s += lineOf(from + i, ed && edited.has(i)) + '\n'; return s; };
    const kind = rnd(), path = `${DIRS[k % DIRS.length]}/${WORDS[k % WORDS.length]}_${WORDS[(k * 5) % WORDS.length]}_${k}.ts`;
    files.push({ path, old: kind < 0.02 ? null : text(false), new: kind > 0.99 ? null : text(true) });
  }
  return files.sort((x, y) => (x.path < y.path ? -1 : 1));
}
let review = null;
$('openPr').addEventListener('click', async () => {
  const t0 = performance.now();
  const files = pullRequest(5000);
  const made = performance.now() - t0;
  let lines = 0;
  for (const f of files) lines += (f.new ?? f.old).split('\n').length - 1;
  review?.destroy();
  review = createReview($('review'), {
    theme: theme === THEMES.dusk ? 'dusk' : 'sage',
    onChange: (e) => {
      if (e.counted) $('prStats').textContent = `${files.length.toLocaleString()} files, ${lines.toLocaleString()} lines · every file diffed in the background in ${(e.ms / 1000).toFixed(1)} s · generated in ${made.toFixed(0)} ms`;
    },
  });
  const t1 = performance.now();
  await review.setFiles(files);
  $('prStats').textContent = `${files.length.toLocaleString()} files, ${lines.toLocaleString()} lines · first file on screen ${(performance.now() - t1).toFixed(0)} ms after open · diffing the rest…`;
  $('openPr').textContent = 'regenerate';
});

// ------------------------------------------------------------- the films
// one screen and a reel beside it. in view, the chosen film plays silently as a preview; the big
// button starts it again from the top with sound, as a proper watch
const FILMS = {
  million: { src: 'media/million.mp4', poster: 'media/million.jpg', title: 'a million lines, then the terminal', sound: true,
    note: 'the million-line demo on this site, split view and find, then the cli: diff, patch, apply, and a patch refusing the wrong file. with music.' },
  'pull-request': { src: 'media/pull-request.mp4', poster: 'media/pull-request.jpg', title: 'tinygrad as one pull request: 1,218 files', sound: false,
    note: '3,000 commits of real tinygrad history as one pull request. all 1,218 files diffed in 255 ms, then filtered down to five.' },
  versus: { src: 'media/versus.mp4', poster: 'media/versus.jpg', title: 'seams (left) and @pierre/diffs (right), same million lines', sound: false,
    note: 'the same million-line pair opened at the same moment in the same browser: seams on the left, @pierre/diffs on the right.' },
};
const film = $('film'), screen = $('screen');
const clock = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
let filmName = 'million', previewing = true;
function load(name, { play = false, sound = false } = {}) {
  filmName = name;
  const f = FILMS[name];
  film.poster = f.poster;
  film.src = f.src;
  film.muted = !sound;
  $('caption').textContent = f.title;
  $('filmNote').textContent = f.note;
  $('muteBtn').hidden = !f.sound;
  previewing = !sound;
  screen.classList.toggle('watched', sound);
  for (const b of document.querySelectorAll('#reel button')) b.classList.toggle('on', b.dataset.film === name);
  syncButtons();
  if (play) film.play().catch(() => {});
}
function syncButtons() {
  $('playBtn').classList.toggle('pause', !film.paused);
  $('playBtn').setAttribute('aria-label', film.paused ? 'play' : 'pause');
  $('muteBtn').classList.toggle('muted', film.muted);
  $('muteBtn').setAttribute('aria-label', film.muted ? 'sound on' : 'sound off');
  screen.classList.toggle('playing', !film.paused);
}
film.addEventListener('play', syncButtons);
film.addEventListener('pause', syncButtons);
film.addEventListener('volumechange', syncButtons);
film.addEventListener('loadedmetadata', () => { $('length').textContent = clock(film.duration); });
film.addEventListener('timeupdate', () => {
  const p = film.duration ? film.currentTime / film.duration : 0;
  $('played').style.width = `${p * 100}%`;
  $('time').textContent = clock(film.currentTime);
  $('scrub').setAttribute('aria-valuenow', String(Math.round(p * 100)));
});
film.addEventListener('progress', () => { if (film.buffered.length && film.duration) $('loaded').style.width = `${(film.buffered.end(film.buffered.length - 1) / film.duration) * 100}%`; });
// a preview loops; a proper watch moves on to the next film
film.addEventListener('ended', () => {
  if (previewing) { film.currentTime = 0; film.play().catch(() => {}); return; }
  const names = Object.keys(FILMS), next = names[(names.indexOf(filmName) + 1) % names.length];
  load(next, { play: true, sound: true });
});
const watch = () => { film.currentTime = 0; previewing = false; screen.classList.add('watched'); film.muted = false; film.play().catch(() => {}); syncButtons(); };
$('bigplay').addEventListener('click', watch);
$('playBtn').addEventListener('click', () => { if (film.paused) { if (previewing) watch(); else film.play(); } else film.pause(); });
film.addEventListener('click', () => { if (previewing) watch(); else if (film.paused) film.play(); else film.pause(); });
$('muteBtn').addEventListener('click', () => { film.muted = !film.muted; if (!film.muted) { previewing = false; screen.classList.add('watched'); } });
$('fullBtn').addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : screen.requestFullscreen?.()));
for (const b of document.querySelectorAll('#reel button')) b.addEventListener('click', () => load(b.dataset.film, { play: true, sound: true }));
const seek = (e) => { const r = $('scrub').getBoundingClientRect(); if (film.duration) film.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * film.duration; };
let seeking = false;
$('scrub').addEventListener('pointerdown', (e) => { seeking = true; $('scrub').setPointerCapture(e.pointerId); seek(e); });
$('scrub').addEventListener('pointermove', (e) => { if (seeking) seek(e); });
$('scrub').addEventListener('pointerup', () => { seeking = false; });
$('scrub').addEventListener('keydown', (e) => {
  const d = { ArrowRight: 5, ArrowLeft: -5 }[e.key];
  if (d && film.duration) { e.preventDefault(); film.currentTime = Math.min(film.duration, Math.max(0, film.currentTime + d)); }
});
load('million');
// the silent preview runs only while the screen is in view, and never for people who asked for less motion
const calm = matchMedia('(prefers-reduced-motion: reduce)');
new IntersectionObserver(([entry]) => {
  if (!previewing) { if (!entry.isIntersecting) film.pause(); return; }
  if (entry.isIntersecting && !calm.matches) film.play().catch(() => {}); else film.pause();
}, { threshold: 0.35 }).observe(screen);

// ------------------------------------------------------------- the guide
const tabs = [...document.querySelectorAll('.tabs [role=tab]')];
function pickTab(tab, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute('aria-controls')).hidden = !on;
  }
  if (focus) tab.focus();
}
for (const t of tabs) {
  t.addEventListener('click', () => pickTab(t));
  t.addEventListener('keydown', (e) => {
    const k = tabs.indexOf(t), d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (d) { e.preventDefault(); pickTab(tabs[(k + d + tabs.length) % tabs.length], true); }
  });
}
// links to a panel (the hero's "new" pill, #guide-cli and so on) open that tab
function followHash() {
  const tab = tabs.find((t) => `#${t.getAttribute('aria-controls')}` === location.hash);
  if (tab) { pickTab(tab); $('guide').scrollIntoView(); }
}
addEventListener('hashchange', followHash);
followHash();
for (const button of document.querySelectorAll('.code .copy')) {
  button.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(button.nextElementSibling.textContent); button.textContent = 'copied'; }
    catch { button.textContent = 'select it'; }
    setTimeout(() => { button.textContent = 'copy'; }, 1400);
  });
}
