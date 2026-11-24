import { calendarDate } from './journey-date.js';
import { resolvePlace } from './places.js';

export const flightNumber = value => String(value || '').normalize('NFKC').replace(/\s/g, '').toUpperCase();

export function flightQuery(record) {
  if (record.type && record.type !== 'flight') throw new Error('航班查询仅用于机票');
  const fnum = flightNumber(record.service ?? record.fnum), date = calendarDate(record.departureDate ?? record.date ?? '');
  if (!/^(?=[A-Z0-9]{0,1}[A-Z])[A-Z0-9]{2}\d{1,5}[A-Z]?$/.test(fnum)) throw new Error('请填写完整航班号，例如 CA181');
  if (date.length !== 10) throw new Error('请先选择完整的出发日期');
  const query = { fnum, date };
  for (const [side, key] of [['origin', 'dep'], ['destination', 'arr']]) {
    const place = resolvePlace({ ...record, type: 'flight' }, side);
    if (place.status === 'matched') query[key] = place.code;
    else if (record[key] && /^[A-Z]{3}$/.test(record[key])) query[key] = record[key];
  }
  return query;
}
