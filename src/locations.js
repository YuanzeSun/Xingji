import { STATIONS, AIRPORTS, LOCATION_REFERENCE } from './data/location-reference.js';
import { resolvePlace, placeWords, normalizePlaceKey as key, INTERNATIONAL_CITIES } from './places.js';
import { isJourneyRecord } from './record-kind.js';
import {AIRPORT_SERVICE_CITIES} from './data/airport-cities.js';
import {AIRPORT_CITY_ALIASES} from './data/airport-city-associations.js';
export { LOCATION_REFERENCE };

const cityKey = value => key(value).replace(/市$/, '');
const cityAliases = new Map(), railAliases = new Map(), stationRows = new Map(), airportCodes = new Map(), airportNames = new Map();
function add(map, alias, value) {
  const k = key(alias); if (!k) return;
  if (!map.has(k)) map.set(k, new Set()); map.get(k).add(value);
}
for (const [name, city, code, pinyin, initials] of STATIONS) {
  stationRows.set(key(name), [name, city, code, pinyin, initials]);
  add(cityAliases, cityKey(city), city);
  if (name === city) add(cityAliases, pinyin, city);
  for (const alias of [name, code, pinyin, initials]) add(railAliases, alias, city);
}
for (const [english, chinese] of Object.entries(INTERNATIONAL_CITIES)) {
  add(cityAliases, english, chinese); add(cityAliases, chinese, chinese);
}
for (const city of Object.values(AIRPORT_SERVICE_CITIES)) add(cityAliases, city, city);
for (const [city,aliases] of Object.entries(AIRPORT_CITY_ALIASES)) for(const alias of [city,...aliases]) add(cityAliases,alias,city);
export function canonicalCity(value) {
  const cleaned = String(value || '').trim();
  const aliases = cityAliases.get(cityKey(cleaned));
  return aliases?.size === 1 ? [...aliases][0] : cleaned.replace(/市$/, '');
}
const municipalityRegions = new Map();
for (const [, municipality, country, , , region] of AIRPORTS) {
  if (['CN', 'HK', 'MO', 'TW'].includes(country)) continue;
  add(municipalityRegions, municipality, region || country);
}
for (const [code, municipality, country, name, aliases, region] of AIRPORTS) {
  const chinese = cityAliases.get(cityKey(municipality));
  // Untranslated Chinese municipalities remain unassigned instead of inventing a prefecture.
  let city = AIRPORT_SERVICE_CITIES[code] || (chinese?.size === 1 ? [...chinese][0] : country === 'CN' ? '' : municipality);
  if (!city) continue;
  if (!['CN', 'HK', 'MO', 'TW'].includes(country) && municipalityRegions.get(key(municipality))?.size > 1) city += `（${region || country}）`;
  add(airportCodes, code, city);
  for (const alias of [name, ...aliases.split('|')]) {
    add(airportNames, alias, city);
    if (/机场$/.test(alias)) add(airportNames, alias.replace(/(?:国际)?机场$/, ''), city);
  }
}
// Explicit Chinese names for rows whose upstream keywords omit them.
// Resolve verified airport identities before selecting their service city.
for (const [code, names] of Object.entries({ PKX: ['北京大兴', '北京大兴国际机场'], TFU: ['成都天府', '成都天府国际机场'], CAN: ['广州白云', '广州白云国际机场'] })) {
  for (const city of airportCodes.get(key(code)) || []) for (const name of names) add(airportNames, name, city);
}
function matchCities(names, codes) {
  if (names?.size && codes?.size) {
    const common = [...names].filter(city => codes.has(city));
    return common.length === 1 ? { city: common[0], status: 'reference' } : { city: '', status: 'conflict' };
  }
  const found = names?.size ? names : codes;
  return found?.size === 1 ? { city: [...found][0], status: 'reference' } : { city: '', status: found?.size ? 'ambiguous' : 'unknown' };
}
export function resolveCity(record, side) {
  const name = String(record[side] || '').trim(), code = key(record[side + 'Code']);
  const railway = record.type === 'rail';
  const place = resolvePlace(record, side);
  if (place.status === 'conflict') return { city: '', status: 'conflict', source: railway ? '12306站点库' : 'OurAirports机场库' };
  if (railway && place.status === 'matched') return { city: place.city, status: 'reference', source: '12306站点库' };
  if (!railway && place.status === 'matched' && place.cities.length > 1) return { city: place.city, cities:[...place.cities], status:'reference', source:'机场多城市资料' };
  const names = railway ? railAliases.get(key(name.replace(/站$/, ''))) : airportNames.get(key(name)) || airportCodes.get(key(name));
  const codes = railway ? railAliases.get(code) : airportCodes.get(key(place.code || code));
  const matched = matchCities(names, codes);
  if (!railway && matched.status === 'unknown') {
    const city = cityAliases.get(cityKey(name));
    if (city?.size === 1) return { city: [...city][0], status: 'reference', source: '城市名称' };
  }
  return { ...matched, source: railway ? '12306站点库' : AIRPORT_SERVICE_CITIES[place.code] ? '民航局机场城市库' : 'OurAirports机场库' };
}
export const sameCity = (a, b) => !!a && !!b && cityKey(canonicalCity(a)) === cityKey(canonicalCity(b));
export function resolveCities(record,side) {
  const result=resolveCity(record,side);
  return result.cities || (result.city ? [result.city] : []);
}
export const cityLabel=(record,side)=>resolveCities(record,side).join(' / ');
export const matchesCity=(record,side,city)=>resolveCities(record,side).some(name=>sameCity(name,city));
export function locationWords(record, side) {
  const words = resolveCities(record, side);
  if (record.type === 'rail') {
    const name = key(String(record[side] || '').replace(/站$/, ''));
    const row = stationRows.get(name);
    if (row) words.push(row[2], row[3], row[4]);
  } else words.push(...placeWords(record, side));
  return words.filter(Boolean);
}
export function journeyCities(records) {
  const cities = new Set();
  for (const record of records.filter(isJourneyRecord)) {
    for (const city of [...resolveCities(record, 'origin'), ...resolveCities(record, 'destination')]) cities.add(city);
  }
  return [...cities].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
export function placesInCity(records, city) {
  const places = new Set();
  for (const r of records) for (const side of ['origin', 'destination']) if (matchesCity(r, side, city)) places.add(r[side] || r[side + 'Code']);
  return [...places].filter(Boolean).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}
