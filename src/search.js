import {calendarDate} from './journey-date.js';
import {railTrainsetIds} from './rail-journey.js';
import { TEMPLATES, validDate } from './model.js';
import { matchesCity, locationWords } from './locations.js';
import { FLIGHT_STATUSES } from './flight-status.js';
import { SUPPLEMENT_FIELDS } from './rail-template.js';

export const DEFAULT_SEARCH = Object.freeze({ query: '', type: 'all', year: 'all', originCity: '', destinationCity: '', origin: '', destination: '', bothDirections: false, service: '', passenger: '', dateFrom: '', dateTo: '', seatClass: '', airline: '', template: '', minPrice: '', maxPrice: '', code: '', provenance: '', mark: '', sort: 'newest' });
export const SORTS = Object.freeze({ newest: '出发日期：由近到远', oldest: '出发日期：由远到近', 'price-asc': '票价：从低到高', 'price-desc': '票价：从高到低' });
const text = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const compact = value => text(value).replace(/[\s'’·-]/g, '');
const contains = (value, query) => compact(value).includes(compact(query));
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function searchOptions(input = {}) {
  const options = Object.fromEntries(Object.entries(DEFAULT_SEARCH).map(([key, value]) => [key, typeof value === 'boolean' ? input[key] === true : String(input[key] ?? value).slice(0, key === 'query' ? 1000 : 200)]));
  if (!Object.hasOwn(SORTS, options.sort)) options.sort = 'newest';
  return options;
}
function searchTerms(query) {
  return [...text(query).matchAll(/(-?)"([^"]+)"|(-?)([^\s"]+)/g)].map(m => ({ value: m[2] ?? m[4], exclude: !!(m[1] || m[3]), phrase: m[2] !== undefined }));
}
function searchable(record) {
  const fields = ['origin', 'destination', 'originCode', 'destinationCode', 'service', 'departureDate', 'departureTime', 'arrivalDate', 'arrivalTime', 'passenger', 'identity', 'seatClass', 'price', 'ticketNumber', 'saleCode', 'issuer', 'gate', 'departureTerminal', 'arrivalTerminal', 'boardingTime', 'airline', 'aircraft', 'flightStatus', 'pnr', 'railModel', 'railPowerSupply', 'railBureau', 'railRunner', 'railCarOwner', ...Object.keys(SUPPLEMENT_FIELDS)];
  const aliases = record.type === 'flight' ? '机票 航空 登机牌 飞机 flight ' + (FLIGHT_STATUSES[record.flightStatus || 'normal'] || '') : '火车票 铁路 rail ' + (record.template.startsWith('rail-red') ? '红票 软纸票' : record.template === 'rail-supplement' ? '车补票 补票' : '蓝票') + (record.template === 'rail-receipt' ? ' 报销凭证' : '');
  const trainsets=railTrainsetIds(record);
  return [...trainsets,...fields.map(k => k.endsWith('Date') ? calendarDate(record[k]) : record[k]), ...locationWords(record, 'origin'), ...locationWords(record, 'destination'), TEMPLATES[record.template], aliases, record.provenance === 'reconstruction' ? '依据原票重建' : '纪念票面', ...(record.ticketMarks || []).map(m => m.text)].filter(Boolean).map(value => ({ text: text(value), compact: compact(value) }));
}
export function dateInterval(value) {
  if(value&&typeof value==='object')value=calendarDate(value);
  if (!value || !validDate(value)) return null;
  const [year, month, day] = value.split('-');
  const endMonth = month || '12';
  const endDay = day || String(new Date(Date.UTC(Number(year), Number(endMonth), 0)).getUTCDate()).padStart(2, '0');
  return { start: `${year}-${month || '01'}-${day || '01'}`, end: `${year}-${endMonth}-${endDay}` };
}
export function activeSearch(input) {
  const f = searchOptions(input), chips = [];
  const add = (key, label) => chips.push({ key, label });
  if (f.query) add('query', `关键词：${f.query}`);
  if (f.type !== 'all') add('type', f.type === 'rail' ? '火车票' : '机票');
  if (f.year !== 'all') add('year', f.year === 'unknown' ? '日期待补充' : `${f.year}年`);
  if (f.originCity || f.destinationCity || f.origin || f.destination) add('route', `${[f.originCity, f.origin].filter(Boolean).join(' · ') || '任意出发地'} ${f.bothDirections ? '↔' : '→'} ${[f.destinationCity, f.destination].filter(Boolean).join(' · ') || '任意目的地'}`);
  if (f.dateFrom || f.dateTo) add('dates', `出发：${f.dateFrom || '不限'} 至 ${f.dateTo || '不限'}`);
  for (const [key, label] of Object.entries({ service: '车次 / 航班', passenger: '旅客', seatClass: '席别 / 舱位', airline: '航空公司', mark: '票面标识' })) if (f[key]) add(key, `${label}：${f[key]}`);
  if (f.template) add('template', TEMPLATES[f.template] || f.template);
  if (f.code) add('code', f.code === 'with' ? '火车票：已收录条码' : '火车票：未收录条码');
  if (f.provenance) add('provenance', f.provenance === 'reconstruction' ? '依据原票重建' : '纪念票面');
  if (f.minPrice || f.maxPrice) add('price', `票价：¥${f.minPrice || '0'} 至 ${f.maxPrice || '不限'}`);
  if (f.sort !== 'newest') add('sort', SORTS[f.sort]);
  return chips;
}
export function clearSearchField(input, key) {
  const f = searchOptions(input);
  const groups = { route: ['originCity', 'destinationCity', 'origin', 'destination', 'bothDirections'], dates: ['dateFrom', 'dateTo'], price: ['minPrice', 'maxPrice'] };
  for (const field of groups[key] || [key]) if (Object.hasOwn(DEFAULT_SEARCH, field)) f[field] = DEFAULT_SEARCH[field];
  if (key === 'price' && f.sort.startsWith('price-')) f.sort = 'newest';
  return f;
}
export function searchTickets(records, input = {}) {
  const f = searchOptions(input), terms = searchTerms(f.query);
  for (const [field, label] of [['dateFrom', '起始日期'], ['dateTo', '截止日期']]) if (f[field] && !validDate(f[field])) return { records: [], error: `${label}请填写有效的年、年月或年月日，例如2025、2025-08、2025-08-16` };
  const start = dateInterval(f.dateFrom)?.start, end = dateInterval(f.dateTo)?.end;
  if (start && end && start > end) return { records: [], error: '起始日期不能晚于截止日期' };
  for (const field of ['minPrice', 'maxPrice']) if (f[field] && !/^\d{1,9}(\.\d{1,2})?$/.test(f[field])) return { records: [], error: '票价请填写非负数字，最多两位小数' };
  if (f.minPrice && f.maxPrice && Number(f.minPrice) > Number(f.maxPrice)) return { records: [], error: '最低票价不能高于最高票价' };
  const endpointMatches = (r, side, query) => !query || [r[side], r[side + 'Code'], ...locationWords(r, side).slice(1)].some(value => contains(String(value || '').replace(/站$/, ''), query.replace(/站$/, '')));
  const routeMatches = (r, reverse = false) => (!f.originCity || matchesCity(r, reverse ? 'destination' : 'origin', f.originCity)) && (!f.destinationCity || matchesCity(r, reverse ? 'origin' : 'destination', f.destinationCity)) && endpointMatches(r, reverse ? 'destination' : 'origin', f.origin) && endpointMatches(r, reverse ? 'origin' : 'destination', f.destination);
  const matched = records.filter(r => {
    if (r.deleted || (f.type !== 'all' && r.type !== f.type) || (f.year !== 'all' && (calendarDate(r.departureDate).slice(0, 4) || 'unknown') !== f.year)) return false;
    if (!routeMatches(r) && !(f.bothDirections && routeMatches(r, true))) return false;
    if (f.service && !contains(r.service, f.service)) return false;
    if (f.passenger && !contains(r.passenger, f.passenger)) return false;
    if (f.seatClass && !contains(r.seatClass, f.seatClass)) return false;
    if (f.airline && (r.type !== 'flight' || !contains(r.airline, f.airline))) return false;
    if (f.template && r.template !== f.template) return false;
    if (f.provenance && r.provenance !== f.provenance) return false;
    if (f.mark && !(r.ticketMarks || []).some(m => contains(m.text, f.mark))) return false;
    if (f.code && (r.type !== 'rail' || (f.code === 'with') !== !!r.ticketCode)) return false;
    if (start || end) { const date = dateInterval(r.departureDate); if (!date || (start && date.end < start) || (end && date.start > end)) return false; }
    if (f.minPrice && (!r.price || Number(r.price) < Number(f.minPrice))) return false;
    if (f.maxPrice && (!r.price || Number(r.price) > Number(f.maxPrice))) return false;
    if (terms.length) {
      const fields = searchable(r);
      if (!terms.every(t => { const found = fields.some(value => t.phrase ? value.text.includes(t.value) : value.compact.includes(compact(t.value))); return t.exclude ? !found : found; })) return false;
    }
    return true;
  });
  const byDate = (a, b) => {
    const left = calendarDate(a.departureDate), right = calendarDate(b.departureDate);
    if (!left || !right) return left ? -1 : right ? 1 : 0;
    return (collator.compare(left, right) || collator.compare(a.departureTime || '', b.departureTime || '')) * (f.sort === 'oldest' ? 1 : -1);
  };
  matched.sort((a, b) => {
    let order = 0;
    if (f.sort.startsWith('price-')) order = a.price === '' || b.price === '' ? a.price === b.price ? 0 : a.price === '' ? 1 : -1 : (Number(a.price) - Number(b.price)) * (f.sort === 'price-asc' ? 1 : -1);
    return order || byDate(a, b) || collator.compare(a.id, b.id);
  });
  return { records: matched, error: '' };
}
