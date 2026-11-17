import { STATIONS, AIRPORTS } from './data/location-reference.js';
import { AIRLINES } from './data/airline-reference.js';
import { normalizePlaceKey as key } from './places.js';
import { resolveCities, canonicalCity } from './locations.js';
import {AIRPORT_CITY_ALIASES} from './data/airport-city-associations.js';
import { bindSuggestionPicker } from './airport-picker.js';
import { escape as e } from './html.js';

const cities = new Map();
function addCity(name, aliases = []) {
  if (!name) return;
  if (!cities.has(name)) cities.set(name, { name, aliases: new Set([name]) });
  for (const alias of aliases.filter(Boolean)) cities.get(name).aliases.add(alias);
}
for (const [name, city, , pinyin, initials] of STATIONS) addCity(city, name === city ? [pinyin, initials] : []);
for (const [code, municipality, country, name] of AIRPORTS) {
  for(const city of resolveCities({ type: 'flight', originCode: code }, 'origin'))addCity(city, [code, name, ...(AIRPORT_CITY_ALIASES[city] || []), ...(country !== 'CN' || canonicalCity(municipality) === city ? [municipality] : [])]);
}
const publicCities = [...cities.values()].map(row => ({ name: row.name, terms: [...row.aliases].map(key) }));
const airlines = AIRLINES.map(([id, zh, en, codes, aliases]) => ({ id, name: zh || en, english: en, codes, terms: [zh, en, ...codes, ...aliases].filter(Boolean).map(key) }));
const frequentAirlines = new Set(['中国国际航空', '中国东方航空', '中国南方航空', '海南航空', '深圳航空', '四川航空', '厦门航空', '山东航空', '春秋航空', '吉祥航空', '新加坡航空', '国泰航空']);
function matches(rows, query, limit) {
  const value = key(query); if (!value) return [];
  return rows.map(row => ({ row, score: Math.min(...row.terms.map(term => term === value ? 0 : term.startsWith(value) ? 1 : term.includes(value) ? 2 : 99)) }))
    .filter(match => match.score < 99).sort((a, b) => a.score - b.score || Number(frequentAirlines.has(b.row.name)) - Number(frequentAirlines.has(a.row.name)) || a.row.name.localeCompare(b.row.name, 'zh-CN')).slice(0, limit).map(({ row }) => ({ ...row }));
}
export function suggestCities(query, records = [], limit = 8) {
  const local = [...new Set(records.flatMap(record => [record.originCity, record.destinationCity].flatMap(value=>String(value || '').split(' / '))).filter(name => name && !cities.has(name)))].map(name => ({ name, terms: [key(name)] }));
  return matches([...publicCities, ...local], query, limit);
}
export const suggestAirlines = (query, limit = 8) => matches(airlines, query, limit);

export function bindReferenceFields(form, records) {
  for (const input of form.querySelectorAll('[name="originCity"], [name="destinationCity"], [name="airline"]')) {
    const airline = input.name === 'airline';
    bindSuggestionPicker(input, row => {
      input.value = row.name;
      input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
    }, {
      search: query => airline ? suggestAirlines(query) : suggestCities(query, records), label: airline ? '匹配航空公司' : '匹配城市',
      empty: airline ? '未找到匹配航空公司，可继续手动填写' : '未找到匹配城市，可继续手动填写',
      renderOption: row => `<span class="airport-option-name"><strong>${e(row.name)}</strong>${airline ? `<small>${e([row.codes.join(' / '), row.english !== row.name ? row.english : ''].filter(Boolean).join(' · '))}</small>` : ''}</span>`
    });
  }
}
