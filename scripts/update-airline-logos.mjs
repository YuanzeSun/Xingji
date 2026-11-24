import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import { AIRLINES } from '../src/data/airline-reference.js';

const root = new URL('../assets/airline-logos/', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('catalog.json', root), 'utf8'));
const rows = catalog.airlines, source = catalog.source;
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[\s\p{P}]/gu, '').replace(/(?:股份)?有限公司$|公司$/, '');

function squareLogo(element, [x, y, width, height], original) {
  if (x === 0 && y === 0 && width === 24 && height === 24 && !element.hasAttribute('width') && !element.hasAttribute('height')) return original;

  const artwork = element.ownerDocument.createElementNS(element.namespaceURI, 'g');
  const scale = 24 / Math.max(width, height);
  artwork.setAttribute('transform', `translate(${(24 - width * scale) / 2 - x * scale} ${(24 - height * scale) / 2 - y * scale}) scale(${scale})`);
  for (const node of [...element.children]) if (!['title', 'desc', 'defs'].includes(node.localName)) artwork.append(node);
  element.append(artwork);
  element.setAttribute('viewBox', '0 0 24 24');
  element.removeAttribute('width');
  element.removeAttribute('height');
  return Buffer.from(element.outerHTML);
}

function cropWordmark(element, [x, y, width, height], svg) {
  const image = new Resvg(svg, { fitTo: { mode: 'width', value: 512 }, font: { loadSystemFonts: false } }).render();
  const { pixels } = image;
  let left = image.width, right = -1, top = image.height, bottom = -1;
  for (let row = 0; row < image.height; row++) for (let col = 0; col < image.width; col++) {
    if (!pixels[(row * image.width + col) * 4 + 3]) continue;
    left = Math.min(left, col); right = Math.max(right, col);
    top = Math.min(top, row); bottom = Math.max(bottom, row);
  }
  if (right < 0) throw new Error('Empty airline wordmark');
  const scale = width / image.width;
  const w = Math.min(width, (right + 1) * scale) - left * scale;
  const h = Math.min(height, (bottom + 1) * scale) - top * scale;
  element.setAttribute('viewBox', [x + left * scale, y + top * scale, w, h].map(value => Number(value.toFixed(4))).join(' '));
  element.removeAttribute('width');
  element.removeAttribute('height');
  return { bytes: Buffer.from(element.outerHTML), aspect: Number((w / h).toFixed(4)) };
}

const logos = {}, manifest = [];
async function readAsset(row, { file, type, source }) {
  if (!/^[a-z0-9-]+\.svg$/.test(file)) throw new Error('Invalid local logo filename');
  if (!['logo', 'icon'].includes(type)) throw new Error('Unexpected airline logo type: ' + row.slug);
  const svg = (await readFile(new URL(file, root), 'utf8')).replace(/\r\n/g, '\n');
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const element = dom.window.document.documentElement;
  if (element.localName !== 'svg' || !element.hasAttribute('viewBox') || element.querySelector('script,foreignObject,image,use,a,style,iframe,animate,set')) throw new Error('Unexpected SVG content: ' + row.slug);
  for (const node of [element, ...element.querySelectorAll('*')]) for (const attr of node.attributes) {
    const value = attr.value.replace(/url\(\s*['"]?#[\w-]+['"]?\s*\)/g, '');
    if (/^on/i.test(attr.name) || /href$/i.test(attr.name) && !/^#[\w-]+$/.test(attr.value) || /url\(|javascript:|https?:/i.test(value) && !attr.name.startsWith('xmlns')) throw new Error('Unexpected SVG attribute: ' + row.slug);
  }
  const viewBox = element.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  if (viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) throw new Error('Invalid logo viewBox: ' + row.slug);
  const bytes = Buffer.from(svg);
  const display = type === 'logo' ? cropWordmark(element, viewBox, svg) : { bytes: squareLogo(element, viewBox, bytes) };
  dom.window.close();
  const provenance = source ? { source } : {};
  manifest.push({ slug: row.slug, iata: row.iata, icao: row.icao, asset: file, type, ...provenance, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return { image: `data:image/svg+xml;base64,${display.bytes.toString('base64')}`, ...(display.aspect ? { aspect: display.aspect } : {}), ...provenance };
}

for (const row of rows) {
  const main = await readAsset(row, row);
  const marks = row.type === 'logo' ? { wordmark: main } : { icon: main };
  if (row.icon) marks.icon = await readAsset(row, { ...row.icon, type: 'icon' });
  const names = [row.name, row.slug, row.iata, row.icao, ...(row.aliases || [])];
  const candidates = AIRLINES.filter(item => item[3].some(code => [row.iata, row.icao].includes(code)));
  const exact = candidates.filter(item => [item[1], item[2], ...item[4]].some(name => normalize(name) === normalize(row.name)));
  const icao = candidates.filter(item => item[3].includes(row.icao));
  const matches = exact.length ? exact : icao.length === 1 ? icao : candidates.length === 1 ? candidates : [];
  if (matches.length === 1) names.push(matches[0][1], matches[0][2], ...matches[0][3], ...matches[0][4]);
  logos[row.slug] = { code: row.iata || row.icao || row.slug, name: row.name, names: [...new Set(names.filter(name => typeof name === 'string' && name))], ...marks };
}
await writeFile(new URL('../src/data/airline-logos.js', import.meta.url), `// Generated from the local assets/airline-logos catalogue. See docs/airline-logos.md.\nexport const AIRLINE_LOGOS=${JSON.stringify(logos)};\n`);
await writeFile(new URL('../licenses/airline-logos.json', import.meta.url), JSON.stringify({ source, version: catalog.version, notice: 'The original catalogue is MIT licensed. Airline marks belong to their respective owners and are excluded from the library MIT and application licenses.', images: manifest }, null, 2) + '\n');
console.log(`Saved ${manifest.length} unified SVG airline marks (${manifest.reduce((sum, row) => sum + row.bytes, 0)} bytes).`);
