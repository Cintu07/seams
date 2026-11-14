// Builds the site into _site/: the page, the viewer modules and the wasm core at the same relative
// paths they have in the repo (the worker finds ../build/seams.wasm from web/), and the demo files.
//   node wasm/build.mjs && node site/build.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const f of ['site.css', 'main.mjs']) cpSync(join(root, 'site', f), join(out, f));
writeFileSync(join(out, 'index.html'), withStructuredData(readFileSync(join(root, 'site/index.html'), 'utf8')));
writeFileSync(join(out, 'llms.txt'), readFileSync(join(root, 'site/llms.txt')));
cpSync(join(root, 'site/media'), join(out, 'media'), { recursive: true });
cpSync(join(root, 'site/fonts'), join(out, 'fonts'), { recursive: true });
cpSync(join(root, 'site/assets'), join(out, 'assets'), { recursive: true });
mkdirSync(join(out, 'web'));
for (const f of ['embed.mjs', 'renderer.mjs', 'interact.mjs', 'lex.mjs', 'words.mjs', 'look.mjs', 'diff_worker.mjs', 'layout.mjs', 'pack.mjs', 'review.mjs', 'count_worker.mjs'])
  cpSync(join(root, 'web', f), join(out, 'web', f));
mkdirSync(join(out, 'wasm'));
for (const f of ['seams.mjs', 'layout.mjs']) cpSync(join(root, 'wasm', f), join(out, 'wasm', f));
mkdirSync(join(out, 'build'));
if (!existsSync(join(root, 'build/seams.wasm'))) throw new Error('build/seams.wasm is missing: run node wasm/build.mjs first');
cpSync(join(root, 'build/seams.wasm'), join(out, 'build/seams.wasm'));
// the library itself, so a page can import it by url with no package manager
if (existsSync(join(root, 'pkg/dist'))) cpSync(join(root, 'pkg/dist'), join(out, 'lib'), { recursive: true });

// the demo: web/embed.mjs before and after the commit that added packs, straight from git history
mkdirSync(join(out, 'demo'));
const show = (rev) => execFileSync('git', ['show', `${rev}:web/embed.mjs`], { cwd: root });
const added = execFileSync('git', ['log', '--format=%h', '--diff-filter=A', '--', 'web/pack.mjs'], { cwd: root }).toString().trim().split('\n').pop();
writeFileSync(join(out, 'demo/embed.old.mjs'), show(`${added}^`));
writeFileSync(join(out, 'demo/embed.new.mjs'), show(added));
writeFileSync(join(out, '.nojekyll'), '');

// JSON-LD for search and answer engines: the app, the person who made it, the faq and the films, all read
// from index.html and the repo so they say what the page says
function withStructuredData(page) {
  const SITE = 'https://cintu07.github.io/seams/';
  const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
  const version = JSON.parse(readFileSync(join(root, 'extension/manifest.json'), 'utf8')).version;
  const tag = (() => { try { return execFileSync('git', ['describe', '--tags', '--abbrev=0'], { cwd: root }).toString().trim(); } catch { return null; } })();
  const person = {
    '@type': 'Person', '@id': 'https://pawann.dev/#person', name: 'Pawan Kalyan', alternateName: ['Cintu07', 'pawann'],
    url: 'https://pawann.dev', sameAs: ['https://github.com/Cintu07', 'https://cintu07.github.io/', 'https://x.com/pawankalyandev', 'https://www.linkedin.com/in/pavankalyan-kolagani/'],
  };
  const app = {
    '@type': 'SoftwareApplication', '@id': SITE + '#app', name: 'seams', url: SITE,
    description: text(page.match(/<meta name="description" content="([^"]+)"/)[1]),
    applicationCategory: 'DeveloperApplication', applicationSubCategory: 'Diff viewer',
    operatingSystem: 'Web browser, Linux, Windows, macOS', softwareVersion: (tag ?? `v${version}`).replace(/^v/, ''),
    license: 'https://opensource.org/licenses/MIT', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    downloadUrl: 'https://github.com/Cintu07/seams/releases', image: SITE + 'assets/share.png',
    screenshot: SITE + 'media/million.jpg', author: { '@id': person['@id'] }, creator: { '@id': person['@id'] },
    sameAs: ['https://github.com/Cintu07/seams'],
    featureList: ['Million-line diffs in about 0.2 s in the browser', 'Hand-written x86-64 assembly and WebAssembly diff engine',
      'WebGL rendering at the display refresh rate', 'Whole GitHub pull requests with review comments synced both ways',
      'Unified and side-by-side views, find, syntax highlighting for about twenty languages', 'Command-line unified diff, patch and three-way merge'],
  };
  const source = { '@type': 'SoftwareSourceCode', name: 'seams', codeRepository: 'https://github.com/Cintu07/seams',
    programmingLanguage: ['Assembly', 'WebAssembly', 'JavaScript', 'C'], license: 'https://opensource.org/licenses/MIT', author: { '@id': person['@id'] } };
  const faq = { '@type': 'FAQPage', '@id': SITE + '#faq', mainEntity: [...page.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/g)].map(([, q, a]) => (
    { '@type': 'Question', name: text(q), acceptedAnswer: { '@type': 'Answer', text: text(a) } })) };
  const films = [...page.matchAll(/data-film="([^"]+)"[^]*?<em>(\d+):(\d+)<\/em><\/span><b>([^<]+)<\/b>/g)].map(([, name, m, sec, title]) => {
    const added = execFileSync('git', ['log', '--diff-filter=A', '--format=%cI', '--', `site/media/${name}.mp4`], { cwd: root }).toString().trim().split('\n').pop();
    return { '@type': 'VideoObject', name: `seams: ${title}`, description: `seams, ${title}.`, thumbnailUrl: SITE + `media/${name}.jpg`,
      contentUrl: SITE + `media/${name}.mp4`, uploadDate: added || new Date().toISOString(), duration: `PT${Number(m)}M${Number(sec)}S`, embedUrl: SITE + '#watch' };
  });
  const graph = { '@context': 'https://schema.org', '@graph': [app, source, person, faq, ...films] };
  if (!faq.mainEntity.length || !films.length) throw new Error('structured data: the faq or the films were not found in index.html');
  return page.replace('</head>', `<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>\n</head>`);
}
console.log(`_site built (demo from ${added})`);
