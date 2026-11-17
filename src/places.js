import { STATIONS, AIRPORTS } from './data/location-reference.js';
import { AIRPORT_LABELS } from './data/airport-labels.js';
import { AIRPORT_TIMEZONES } from './data/airport-timezones.js';
import {AIRPORT_SERVICE_CITIES} from './data/airport-cities.js';
import {AIRPORT_CITY_ASSOCIATIONS,AIRPORT_CITY_ALIASES} from './data/airport-city-associations.js';

export const normalizePlaceKey = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/國際/g, '国际').replace(/機場/g, '机场').replace(/[\s'’·._/–—-]/g, '');
const key = normalizePlaceKey;
const rail = new Map(), air = new Map(), airports = new Map(), stations = new Map(), airportWords = new Map();
function add(index, alias, id) {
  const value = key(alias); if (!value) return;
  if (!index.has(value)) index.set(value, new Set());
  index.get(value).add(id);
}
for (const [name, city, code, pinyin, initials] of STATIONS) {
  stations.set(code, { id: code, code, name, pinyin, city });
  for (const alias of [name, name + '站', code, pinyin, pinyin.replace(/v/g, 'ü'), pinyin.replace(/v/g, 'u:'), initials]) add(rail, alias, code);
}
const chineseCities = new Map();
for (const [name, city, , pinyin] of STATIONS) if (name === city) chineseCities.set(key(pinyin), city);
export const INTERNATIONAL_CITIES = { Tokyo: '东京', Osaka: '大阪', London: '伦敦', Paris: '巴黎', Seoul: '首尔', Singapore: '新加坡', Bangkok: '曼谷', 'Hong Kong': '香港', Macau: '澳门', Taipei: '台北', 'New York': '纽约', 'San Francisco': '旧金山' };
const labels = {
  PEK: ['北京首都', '北京首都国际机场'], PKX: ['北京大兴', '北京大兴国际机场'],
  SHA: ['上海虹桥', '上海虹桥国际机场'], PVG: ['上海浦东', '上海浦东国际机场'],
  CAN: ['广州白云', '广州白云国际机场'], TFU: ['成都天府', '成都天府国际机场'],
  CTU: ['成都双流', '成都双流国际机场'], HND: ['东京羽田', '东京羽田机场'],
  NRT: ['东京成田', '东京成田国际机场'],
  BZX: ['巴中恩阳', '巴中恩阳机场'], LIJ: ['丽水', '丽水机场'],
  TWC: ['图木舒克唐王城', '图木舒克唐王城机场'], UYN: ['榆林榆阳', '榆林榆阳机场'],
  BFJ: ['毕节飞雄', '毕节飞雄机场'], KCA: ['库车龟兹', '库车龟兹机场'],
  TLQ: ['吐鲁番交河', '吐鲁番交河机场'], TNH: ['通化三源浦', '通化三源浦机场']
};
const localized = new Map(AIRPORT_LABELS.map(([code, fullName, aliases]) => [code, { fullName, aliases }]));
for (const [code, municipality, country, english, aliases] of AIRPORTS) {
  const city = AIRPORT_SERVICE_CITIES[code] || chineseCities.get(key(municipality)) || INTERNATIONAL_CITIES[municipality] || '';
  const cities = AIRPORT_CITY_ASSOCIATIONS[code] || (city ? [city] : []);
  const local = localized.get(code);
  const names = [...(labels[code] || []), ...(local?.aliases || []), english, ...aliases.split('|')].filter(Boolean);
  const fullName = labels[code]?.[1] || local?.fullName || names.find(name => /机场$/.test(name)) || english;
  const name = labels[code]?.[0] || (['CN', 'HK', 'MO', 'TW'].includes(country) ? fullName.replace(/(?:国际)?机场$/, '') : english);
  const chineseFullName = /\p{Script=Han}/u.test(fullName) ? fullName : '';
  airports.set(code, { id: code, code, name, fullName: fullName || english, city, cities, municipality, country, englishName: english, chineseFullName, chineseName: chineseFullName.replace(/(?:国际)?机场$/, '') });
  airportWords.set(code, new Set());
  const addAlias = alias => {
    if ([...cities, municipality, ...cities.flatMap(city=>AIRPORT_CITY_ALIASES[city] || []), '机场', '国际机场', '国际', '機場', '國際機場', '國際', 'airport', 'internationalairport'].some(generic => key(generic) === key(alias))) return;
    add(air, alias, code);
    airportWords.get(code).add(alias);
  };
  for (const alias of [code, ...names]) {
    // City names identify a city, not a specific airport.
    if (key(alias) === key(city) || key(alias) === key(municipality)) continue;
    addAlias(alias);
    // Outside the domestic catalogue, derive short Chinese names only when
    // the city translation is known, so a city-only stem cannot select an airport.
    if (/机场$/.test(alias) && (city || ['CN', 'HK', 'MO', 'TW'].includes(country))) {
      for (const variant of [alias.replace(/机场$/, ''), alias.replace(/(?:国际)?机场$/, '')]) addAlias(variant);
      if (city && alias.startsWith(city)) {
        const short = alias.slice(city.length);
        for (const variant of [short, short.replace(/机场$/, ''), short.replace(/(?:国际)?机场$/, '')]) addAlias(variant);
      } else if (city) {
        addAlias(city + alias);
        addAlias(city + alias.replace(/(?:国际)?机场$/, ''));
      }
    }
  }
}

const airportSearch = [...airports.values()].map(place => ({
  place,
  code: key(place.code),
  terms: [...new Set([place.name, place.fullName, ...place.cities, ...place.cities.flatMap(city=>AIRPORT_CITY_ALIASES[city] || []), place.municipality, ...(airportWords.get(place.code) || [])].map(key).filter(Boolean))]
}));

export function searchAirports(value, limit = 8) {
  const query = key(value);
  if (!query) return [];
  const exact = airports.get(query.toUpperCase());
  if (exact) return [{ ...exact, cities:[...exact.cities] }];
  const matches = [];
  for (const row of airportSearch) {
    const score = row.code.startsWith(query) ? 0 : row.terms.includes(query) ? 1
      : row.terms.some(term => term.startsWith(query)) ? 2 : row.terms.some(term => term.includes(query)) ? 3 : -1;
    if (score >= 0) matches.push({ place: row.place, score });
  }
  return matches.sort((a, b) => a.score - b.score || a.place.code.localeCompare(b.place.code))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 8))).map(({ place }) => ({ ...place, cities:[...place.cities] }));
}

const stationSearch=STATIONS.map(([name,city,code,pinyin,initials])=>({
  place:{name,city,code,pinyin},
  names:[name,pinyin,pinyin.replace(/v/g,'ü'),pinyin.replace(/v/g,'u:'),initials].map(key),
  city:key(city)
}));
export function searchStations(value,limit=8) {
  const query=key(value).replace(/站$/,'');if(!query)return [];
  return stationSearch.map(row=>({row,score:row.names.includes(query)?0:row.names.some(name=>name.startsWith(query))?1:row.city===query?2:row.names.some(name=>name.includes(query))?3:-1}))
    .filter(match=>match.score>=0).sort((a,b)=>a.score-b.score||a.row.place.name.localeCompare(b.row.place.name,'zh-CN'))
    .slice(0,Math.max(1,Math.min(20,Number(limit)||8))).map(({row})=>({...row.place}));
}

export function resolvePlace(record, side) {
  const railway = record.type === 'rail';
  const index = railway ? rail : air, rows = railway ? stations : airports;
  const name = String(record[side] || '').trim(), code = String(record[side + 'Code'] || '').trim();
  const exactCode = value => {
    const code = value.normalize('NFKC').toUpperCase();
    return rows.has(code) ? new Set([code]) : undefined;
  };
  const byName = exactCode(name) || index.get(key(name));
  const byCode = exactCode(code) || (railway ? index.get(key(code)) : undefined);
  let ids = byName?.size ? [...byName] : byCode?.size ? [...byCode] : [];
  if (byName?.size && byCode?.size) ids = ids.filter(id => byCode.has(id));
  if (!ids.length) return { status: byName?.size && byCode?.size ? 'conflict' : 'unknown' };
  if (ids.length > 1) return { status: 'ambiguous' };
  if (code && !byCode?.size) return { status: 'conflict' };
  const place=rows.get(ids[0]);
  return { ...place, ...(!railway ? {cities:[...place.cities]} : {}), status: 'matched', nameMatched: !!byName?.size };
}

export function railwayStop(record, side) {
  const suppliedName = String(record[side] || '').trim(), suppliedPinyin = String(record[side + 'Code'] || '').trim();
  const place = resolvePlace(record, side);
  if (place.status !== 'matched') return { name: suppliedName, pinyin: suppliedPinyin };
  const name = !suppliedName || place.nameMatched ? place.name + (/站$/.test(suppliedName) && !place.name.endsWith('站') ? '站' : '') : suppliedName;
  const pinyin = key(suppliedPinyin) === key(place.pinyin) ? suppliedPinyin : place.pinyin;
  return { name, pinyin: pinyin === pinyin.toLowerCase() ? pinyin.charAt(0).toUpperCase() + pinyin.slice(1) : pinyin };
}

export function normalizePlaces(record) {
  if (record.type !== 'flight') return record;
  for (const side of ['origin', 'destination']) {
    const place = resolvePlace(record, side);
    record[side === 'origin' ? 'departureZone' : 'arrivalZone'] = place.status === 'matched' ? AIRPORT_TIMEZONES[place.code] || '' : '';
    if (place.status !== 'matched') continue;
    // Resolve the airport identity without translating a supplied Chinese name
    // into the English reference name used by many overseas airports.
    const keepChinese = /\p{Script=Han}/u.test(record[side]) && !/\p{Script=Han}/u.test(place.name);
    if (!record[side] || (place.nameMatched && !keepChinese)) record[side] = place.name;
    record[side + 'Code'] = place.code;
  }
  return record;
}

export function placeIdentity(record, side) {
  const place = resolvePlace(record, side);
  if (place.status === 'conflict' || place.status === 'ambiguous') return '';
  if (place.status === 'matched') return `${record.type}:${place.id}`;
  return key(record[side] || record[side + 'Code']).replace(/站$/, '');
}

export function placeWords(record, side) {
  const place = resolvePlace(record, side);
  return place.status === 'matched' ? [place.name, place.code, ...(airportWords.get(place.id) || []), ...(record.type==='flight' ? [...place.cities,...place.cities.flatMap(city=>AIRPORT_CITY_ALIASES[city] || [])] : [])] : [];
}
