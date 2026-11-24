import { AIRLINE_LOGOS } from './data/airline-logos.js';
import { normalizePlaceKey } from './places.js';

const key = value => normalizePlaceKey(value).replace(/(?:股份)?有限公司$|公司$/, '');
const names = new Map();
for (const [id, logo] of Object.entries(AIRLINE_LOGOS)) {
  for (const name of logo.names) {
    const normalized = key(name);
    if (!names.has(normalized)) names.set(normalized, new Set());
    names.get(normalized).add(id);
  }
}
for (const [name, code] of Object.entries({ 国航:'CA', 东航:'MU', 南航:'CZ', 海航:'HU', 深航:'ZH', 川航:'3U', 厦航:'MF', 厦门航空:'MF', 山航:'SC', 新航:'SQ', 国泰:'CX', 中国春秋航空:'9C', 美国航空:'AA', 全日空航空:'NH' })) {
  const matches = Object.entries(AIRLINE_LOGOS).filter(([, logo]) => logo.code === code);
  if (matches.length === 1) names.set(key(name), new Set([matches[0][0]]));
}

export function airlineLogo(airline = '') {
  const matches = names.get(key(airline));
  if (matches?.size !== 1) return null;
  const id = [...matches][0];
  return { id, ...AIRLINE_LOGOS[id] };
}
