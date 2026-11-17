import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { inflateRawSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { STATIONS, AIRPORTS } from '../src/data/location-reference.js';
import { includeCountryBoundary } from './map-boundaries.mjs';

const root = resolve(import.meta.dirname, '..'), cached = process.argv.includes('--from-cache');
const urls = {
  china: 'https://download.geonames.org/export/dump/CN.zip',
  cities: 'https://download.geonames.org/export/dump/cities500.zip',
  airports: 'https://davidmegginson.github.io/ourairports-data/airports.csv',
  land: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson',
  provinces: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces_lines.geojson',
  countries: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_boundary_lines_land.geojson',
  disputed: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_boundary_lines_disputed_areas.geojson'
};
const files = { china: 'geonames-CN.zip', cities: 'geonames-cities500.zip', airports: 'airports.csv', land: 'natural-earth-land-50m.json', provinces: 'natural-earth-provinces.json', countries: 'natural-earth-countries.json', disputed: 'natural-earth-disputed.json' };
await mkdir(resolve(root, '.preview'), { recursive: true });
async function source(name) {
  const path = resolve(root, '.preview', files[name]);
  if (cached) return readFile(path);
  const response = await fetch(urls[name], { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Map reference download failed: ${response.status}`);
  const content = Buffer.from(await response.arrayBuffer()); await writeFile(path, content); return content;
}
function unzip(buffer, filename) {
  // Read one named member in memory; no archive paths are extracted to the filesystem.
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65558) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('Invalid map reference ZIP');
  let position = buffer.readUInt32LE(end + 16);
  for (let i = 0, count = buffer.readUInt16LE(end + 10); i < count; i++) {
    if (buffer.readUInt32LE(position) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const method = buffer.readUInt16LE(position + 10), length = buffer.readUInt32LE(position + 20), nameLength = buffer.readUInt16LE(position + 28);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString();
    if (name === filename) {
      const local = buffer.readUInt32LE(position + 42), start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), content = buffer.subarray(start, start + length);
      if (![0, 8].includes(method)) throw new Error('Unsupported ZIP compression');
      return (method === 8 ? inflateRawSync(content, { maxOutputLength: 200_000_000 }) : content).toString('utf8');
    }
    position += 46 + nameLength + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
  }
  throw new Error('Missing map reference file: ' + filename);
}
function csvRows(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\r' || c === '\n') && !quoted) { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('Invalid airport CSV');
  row.push(cell); if (row.some(Boolean)) rows.push(row); return rows;
}
const sources = Object.fromEntries(await Promise.all(Object.keys(urls).map(async name => [name, await source(name)])));
const cityNames = [...new Set(STATIONS.map(row => row[1]))].sort(), cityKey = value => value.replace(/(?:自治州|地区|市|县|区|盟|州)$/, '');
const needed = new Set(cityNames.map(cityKey)), candidates = new Map(), seats = new Map();
const provinceNames = '北京 天津 河北 山西 内蒙古 辽宁 吉林 黑龙江 上海 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 广西 海南 重庆 四川 贵州 云南 西藏 陕西 甘肃 青海 宁夏 新疆'.split(' ');
const provinceLabels = {};
const ranks = { ADM1: 0, ADM2: 1, ADM3: 2, PPLC: 3, PPLA: 4, PPLA2: 5, PPLA3: 6, ADM4: 7, PPLA4: 8, PPL: 9 };
for (const text of [unzip(sources.china, 'CN.txt'), unzip(sources.cities, 'cities500.txt')]) for (const line of text.split('\n')) {
  const row = line.split('\t');
  if (!['CN', 'LA', 'HK', 'MO', 'TW'].includes(row[8]) || !Object.hasOwn(ranks, row[7])) continue;
  const entry = { id: row[0], rank: ranks[row[7]], kind: row[7], area: [row[8], row[10], row[11], row[12]], population: Number(row[14]), point: [Number(row[5]), Number(row[4])] };
  if (entry.kind === 'ADM1' && row[8] === 'CN') {
    const aliases = new Set(row[3].split(',')), name = provinceNames.find(name => aliases.has(name));
    if (name) provinceLabels[name] = entry.point;
  }
  if (/^PPL[AC]/.test(row[7])) for (const level of [1, 2, 3]) {
    const key = entry.area.slice(0, level + 1).join(':');
    if (!seats.has(key)) seats.set(key, new Map()); seats.get(key).set(entry.id, entry);
  }
  const names = new Set([row[1], row[2], ...row[3].split(',')].map(cityKey).filter(name => needed.has(name)));
  for (const name of names) {
    if (!candidates.has(name)) candidates.set(name, new Map());
    candidates.get(name).set(row[0], entry);
  }
}
const cities = {}, unresolved = [];
for (const name of cityNames) {
  const choices = [...(candidates.get(cityKey(name))?.values() || [])], rank = Math.min(...choices.map(row => row.rank)), best = choices.filter(row => row.rank === rank);
  // A repeated administrative name must not be placed at an arbitrary namesake.
  if (best.length === 1) {
    let chosen = best[0];
    if (/^ADM[123]$/.test(chosen.kind)) {
      const level = Number(chosen.kind.slice(3)), key = chosen.area.slice(0, level + 1).join(':'), matches = [...(seats.get(key)?.values() || [])].filter(row => row.rank <= level + 3).sort((a, b) => a.rank - b.rank || b.population - a.population);
      if (matches.length) chosen = matches[0];
    }
    cities[name] = [...chosen.point, chosen.id];
  }
  else unresolved.push(name);
}
const rows = csvRows(sources.airports.toString()), header = rows.shift(), field = name => { const i = header.indexOf(name); if (i < 0) throw new Error('Missing airport field: ' + name); return i; };
const code = field('iata_code'), lon = field('longitude_deg'), lat = field('latitude_deg'), airportCodes = new Set(AIRPORTS.map(row => row[0])), airports = {}, ambiguous = new Set();
for (const row of rows) if (airportCodes.has(row[code]) && row[lon] && row[lat]) {
  const point = [Number(row[lon]), Number(row[lat])];
  if (!point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) continue;
  if (airports[row[code]] && JSON.stringify(airports[row[code]]) !== JSON.stringify(point)) ambiguous.add(row[code]);
  airports[row[code]] = point;
}
for (const code of ambiguous) delete airports[code];
// Preserve every source vertex. Gzip/Brotli transfer encoding is lossless and handled by hosting.
let vertexCount = 0;
const linePath = line => { vertexCount += line.length; return line.map(([lon, lat], i) => `${i ? 'L' : 'M'}${((lon + 180) / 360 * 1000).toFixed(6)},${((90 - lat) / 360 * 1000).toFixed(6)}`).join(''); };
const world = JSON.parse(sources.land), ringPath = ring => linePath(ring) + 'Z';
const land = world.features.map(f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(polygon => polygon.map(ringPath).join('')).join('')).join('');
const landVertices = vertexCount;
const boundaries = JSON.parse(sources.provinces).features.filter(f => f.properties.ADM0_A3 === 'CHN' && f.properties.NAME_L && f.properties.NAME_R);
const provinces = boundaries.map(f => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).map(linePath).join('')).join('');
const provinceVertices = vertexCount - landVertices;
const baseBoundaries = JSON.parse(sources.countries).features;
const cnClaims = JSON.parse(sources.disputed).features.filter(includeCountryBoundary);
const countryBoundaries = [...baseBoundaries.filter(includeCountryBoundary), ...cnClaims];
const countries = countryBoundaries.map(f => (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates).map(linePath).join('')).join('');
const countryVertices = vertexCount - landVertices - provinceVertices;

if (Object.keys(cities).length < 350 || Object.keys(airports).length < 5000 || Object.keys(provinceLabels).length !== 31 || !land.startsWith('M')) throw new Error('Map reference appears incomplete');
if (boundaries.length < 60 || !provinces.startsWith('M')) throw new Error('Province boundaries appear incomplete');
if (countryBoundaries.length < 300 || !countries.startsWith('M')) throw new Error('Country boundaries appear incomplete');
const metadata = { boundaryView: 'CN', disputedBoundaries: 'china-view', cnClaimBoundaryIds: cnClaims.map(f => f.properties.ne_id), fetchedAt: new Date().toISOString().slice(0, 10), cities: Object.keys(cities).length, airports: Object.keys(airports).length, provincialBoundaries: boundaries.length, countryBoundaries: countryBoundaries.length, landVertices, provinceVertices, countryVertices, sources: urls, hashes: Object.fromEntries(Object.entries(sources).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])) };
const content = `// Generated by scripts/update-map-data.mjs. Coordinates only; no personal journeys.\n// GeoNames: CC BY 4.0; OurAirports and Natural Earth: Public Domain. See THIRD_PARTY_NOTICES.md.\nexport const MAP_REFERENCE=${JSON.stringify(metadata)};\nexport const CITY_POINTS=${JSON.stringify(cities)};\nexport const PROVINCE_LABELS=${JSON.stringify(provinceLabels)};\nexport const AIRPORT_POINTS=${JSON.stringify(airports)};\nexport const LAND_PATH=${JSON.stringify(land)};\nexport const PROVINCE_PATH=${JSON.stringify(provinces)};\nexport const COUNTRY_PATH=${JSON.stringify(countries)};\n`;
await writeFile(resolve(root, 'src/data/map-reference.js'), content);
console.log(JSON.stringify({ cities: metadata.cities, airports: metadata.airports, unresolved, bytes: Buffer.byteLength(content), gzipBytes: gzipSync(content).length }));
