import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { AIRLINES } from '../src/data/airline-reference.js';

const root = new URL('../assets/airline-logos/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'));
const rows = catalog.airlines, source = catalog.source;
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s\p{P}]/gu, '').replace(/(?:股份)?有限公司$|公司$/, '');
const logos = {}, manifest = [];
for (const row of rows) {
  if (!/^[a-z0-9-]+\.svg$/.test(row.file)) throw new Error('Invalid local logo filename');
  const type = row.type, path = row.file;
  const svg = await readFile(new URL(path, root), 'utf8');
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const element = dom.window.document.documentElement;
  if (element.localName !== 'svg' || !element.hasAttribute('viewBox') || element.querySelector('script,foreignObject,image,use,a,style,iframe,animate,set')) throw new Error('Unexpected SVG content: ' + row.slug);
  for (const node of [element, ...element.querySelectorAll('*')]) for (const attr of node.attributes) {
    const value = attr.value.replace(/url\(\s*['"]?#[\w-]+['"]?\s*\)/g, '');
    if (/^on/i.test(attr.name) || /href$/i.test(attr.name) && !/^#[\w-]+$/.test(attr.value) || /url\(|javascript:|https?:/i.test(value) && !attr.name.startsWith('xmlns')) throw new Error('Unexpected SVG attribute: ' + row.slug);
  }
  dom.window.close();
  const names = [row.name, row.slug, row.iata, row.icao, ...(row.aliases || [])];
  const candidates = AIRLINES.filter(item => item[3].some(code => [row.iata, row.icao].includes(code)));
  const exact = candidates.filter(item => [item[1], item[2], ...item[4]].some(name => normalize(name) === normalize(row.name)));
  const icao = candidates.filter(item => item[3].includes(row.icao));
  const matches = exact.length ? exact : icao.length === 1 ? icao : candidates.length === 1 ? candidates : [];
  if (matches.length === 1) names.push(matches[0][1], matches[0][2], ...matches[0][3], ...matches[0][4]);
  const bytes = Buffer.from(svg);
  logos[row.slug] = { code: row.iata || row.icao || row.slug, name: row.name, names: [...new Set(names.filter(name => typeof name === 'string' && name))], image: `data:image/svg+xml;base64,${bytes.toString('base64')}` };
  manifest.push({ slug: row.slug, iata: row.iata, icao: row.icao, asset: path, type, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(new URL('../src/data/airline-logos.js', import.meta.url), `// Generated from the local assets/airline-logos catalogue. See docs/airline-logos.md.\nexport const AIRLINE_LOGOS=${JSON.stringify(logos)};\n`);
await writeFile(new URL('../licenses/airline-logos.json', import.meta.url), JSON.stringify({ source, version: catalog.version, checked: '2026-11-17', notice: 'The original catalogue is MIT licensed. Airline marks belong to their respective owners and are excluded from the library MIT and application licenses.', images: manifest }, null, 2) + '\n');
console.log(`Saved ${manifest.length} unified SVG airline marks (${manifest.reduce((sum, row) => sum + row.bytes, 0)} bytes).`);
