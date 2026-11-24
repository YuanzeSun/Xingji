import { airlineLogo } from './airline-logo.js';
import { readBoardingCode } from './bcbp.js';
import { BOARDING_METADATA_LABELS, boardingMetadataValues } from './boarding-metadata.js';
import { daysInYear, journeyDate, dateLabel } from './journey-date.js';
import { resolvePlace } from './places.js';

const labels = {
  ...BOARDING_METADATA_LABELS, service: '航班号', departureDate: '出发日期',
  origin: '出发机场', destination: '到达机场', passenger: '旅客姓名',
  pnr: '订座编号 PNR', seat: '座位号', seatClass: '舱位代码', airline: '航空公司',
  ticketNumber: '票号', gate: '登机口', actualBoardingTime: '实际登机时间'
};
const compact = value => String(value || '').normalize('NFKC').replace(/\s+/gu, '').toUpperCase();
const nameKey = value => compact(value).replace(/[^\p{L}]/gu, '');
const serviceKey = value => compact(value).replace(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])0+(?=\d)/, '$1');
const isAirport = key => key === 'origin' || key === 'destination';
const airportCode = (record, key) => {
  const place = resolvePlace(record, key);
  return place.status === 'matched' ? place.code : compact(record[key + 'Code']) || (/^[A-Z]{3}$/.test(compact(record[key])) ? compact(record[key]) : '');
};

export function boardingScanReview(record, read, rescan) {
  const currentDate = journeyDate(record.departureDate);
  const year = rescan || read.legCount === 1 || serviceKey(record.service) === serviceKey(read.service) ? currentDate?.year : null;
  const date = { year: year && read.dayOfYear <= daysInYear(year) ? year : null, dayOfYear: read.dayOfYear };
  const incoming = {
    service: read.service, departureDate: date, origin: read.originCode, destination: read.destinationCode,
    passenger: read.passengerChinese || read.passenger,
    pnr: read.pnr, seat: read.seat, seatClass: read.cabin, airline: read.airline,
    ticketNumber: read.ticketNumber, gate: read.gate, ...boardingMetadataValues(read)
  };
  const previous = rescan && record.boardingCodeSource === 'original' ? readBoardingCode(record.boardingCode, record.boardingLegIndex) : null;
  const airports = rescan ? { origin: airportCode(record, 'origin'), destination: airportCode(record, 'destination') } : {};
  const same = (key, old, value) => {
    if (key === 'departureDate') return currentDate?.dayOfYear === value.dayOfYear;
    if (isAirport(key)) return airports[key] === value;
    if (key === 'service') return serviceKey(old) === serviceKey(value);
    if (key === 'seat') return compact(old).replace(/^0+/, '') === compact(value).replace(/^0+/, '');
    if (key === 'passenger') {
      const name = nameKey(old);
      return [read.passenger, read.passengerChinese].some(value => value && nameKey(value) === name) ||
        (!read.passengerChinese && previous?.passengerChinese && nameKey(previous.passengerChinese) === name && nameKey(previous.passenger) === nameKey(read.passenger));
    }
    if (compact(old) === compact(value)) return true;
    if (key === 'airline') {
      const brand = airlineLogo(old);
      return !!brand && brand.code === airlineLogo(value)?.code;
    }
    return false;
  };
  const describe = (key, value, code) => key === 'departureDate' ? dateLabel(value, '-') : isAirport(key) && code && value !== code ? `${value}（${code}）` : value;
  const values = {}, conflicts = [];
  let added = 0;
  for (const [key, value] of Object.entries(incoming)) {
    if (!value) continue;
    const airport = isAirport(key);
    const oldCode = airport ? airports[key] : '';
    const old = record[key] || oldCode;
    const present = key === 'departureDate' ? !!currentDate?.dayOfYear : !!old;
    const update = airport ? { [key]: value, [key + 'Code']: value } : { [key]: value };
    if (!rescan || !present) {
      Object.assign(values, update);
      if (!present) added++;
    } else if (!same(key, old, value)) {
      conflicts.push({ key, label: labels[key], existing: describe(key, old, oldCode), scanned: describe(key, value), update });
    }
  }
  const conflicting = key => conflicts.some(conflict => conflict.key === key);
  const rejected = (conflicting('service') && conflicting('departureDate')) ||
    (conflicting('origin') && conflicting('destination') && !!airports.origin && !!airports.destination);
  return { values, conflicts, rejected, added };
}
