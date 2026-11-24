import { codeBytes } from './barcode-data.js';
import { calendarDate, journeyDate } from './journey-date.js';
import { resolvePlace } from './places.js';
import { isAnonymousRedTemplate } from './rail-template.js';
import { decodeRailQR, encodeRailQR } from './rail-qr-codec.js';

const SEAT_CLASSES = [
  '棚车', '硬座', '软座', '硬卧', '软卧', '包厢硬卧', '高级软卧', '一等软座', '二等软座', '商务座',
  '鸳鸯软卧', '混编硬座', '混编硬卧', '包厢软座', '特等软座', '动卧', '二人软包', '一人软包', '一等卧', '二等卧',
  '混编软座', '混编软卧', '一等座', '', '二等座', '特等座', '多功能座', '一等包座', '二等包座', '', '', '', '无座',
];
export const supportsGeneratedRailQR = template => !['rail-red-barcode', 'rail-refund-receipt', 'rail-supplement'].includes(template);

function station(values, side, code) {
  const place = resolvePlace({ type: 'rail', [side + 'Code']: code }, side);
  if (place.status === 'matched' && place.code === code) {
    values[side] = place.name;
    values[side + 'Code'] = place.pinyin;
  }
}

function seatValues(text) {
  const coach = Number(text.slice(24, 26));
  const carriage = coach === 31 ? '99' : coach === 32 ? '加' : coach > 32 ? '加' + (coach - 33)
    : coach ? text.slice(24, 26) : '';
  const seatClass = SEAT_CLASSES[parseInt(text[26], 36)] || '';
  const position = text[29], code = text.slice(30, 33);
  if (position === '3' || seatClass === '无座') return { carriage, seatClass, railStanding: true, seat: '' };
  if (position === '4' || position === '5') {
    const index = Number(code);
    return { carriage, seatClass, seat: String(Math.floor(index / 6) + 1).padStart(2, '0') + 'ABCDEF'[index % 6] };
  }
  if (/卧|软包/.test(seatClass)) {
    const bunk = '下中上'[Number(code[2]) - 1];
    return { carriage, seatClass, seat: bunk ? '0' + code.slice(0, 2) + '号' + bunk + '铺' : '' };
  }
  return { carriage, seatClass, seat: Number(code) ? code : '' };
}

export function readRailTicketCode(code, referenceYear = new Date().getFullYear()) {
  if (!code?.rawBytes || code.gs1 || !['QRCode', 'MicroQRCode'].includes(code.format)) return null;
  const bytes = codeBytes(code.rawBytes);
  if (bytes.length !== 144) return null;
  const payload = String.fromCharCode(...bytes);
  const text = decodeRailQR(payload, referenceYear);
  if (!text) return null;

  const prefix = text.slice(16, 19).replaceAll(' ', '');
  const train = Number(text.slice(19, 24));
  const date = text.slice(38, 46);
  let departureDate;
  try { departureDate = journeyDate(date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6)); }
  catch { return null; }
  if (!train || !departureDate) return null;
  const values = { ticketNumber: text.slice(0, 7), service: prefix + train, departureDate };
  station(values, 'origin', text.slice(7, 10));
  station(values, 'destination', text.slice(10, 13));
  const completeRoute = !!values.origin && !!values.destination;
  if (!completeRoute && (!(values.origin || values.destination) || !/^[GDCZTKYLSPX]?$/.test(prefix))) return null;

  const fare = text.slice(33, 38);
  values.price = Number(fare.slice(0, 4)) + '.' + fare[4];
  values.saleCode = text.slice(50, 60) + text.slice(64, 68) + values.ticketNumber;
  Object.assign(values, seatValues(text));
  if (values.seat) values.railStanding = false;

  const idType = Number(text.slice(68, 70)), idLength = Number(text.slice(70, 72));
  if (idType > 0 && idType < 31 && idLength > 0) {
    const identity = text.slice(72, 90).slice(-idLength);
    if (/^[0-9]+X?$/.test(identity) && /[1-9]/.test(identity)) values.identity = identity;
  }
  const suffix = text.slice(-7);
  if (text.length >= 107 && /^\d{7}$/.test(suffix)) {
    const time = suffix.slice(0, 2) + ':' + suffix.slice(2, 4);
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) values.departureTime = time;
    const name = text.slice(90, -7).trim();
    if (/^[\p{L}\p{M} .·'’-]+$/u.test(name)) values.passenger = name;
  }
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== '' || (key === 'seat' && values.railStanding)));
}

function encodeCoach(value) {
  const extra = value.match(/^加(\d{0,2})$/);
  if (extra) return extra[1] ? 33 + Number(extra[1]) : 32;
  if (value === '99') return 31;
  if (!value || /^\d{1,2}$/.test(value) && Number(value) <= 30) return Number(value);
  return -1;
}

function encodeSeat(record) {
  if (record.railStanding) return '3000';
  const seat = String(record.seat || '').trim().toUpperCase();
  if (!seat) return '0000';
  const lettered = seat.match(/^(\d{1,2})([A-F])$/);
  if (lettered && Number(lettered[1]) > 0) {
    return '4' + String((Number(lettered[1]) - 1) * 6 + 'ABCDEF'.indexOf(lettered[2])).padStart(3, '0');
  }
  if (/卧|软包/.test(record.seatClass)) {
    const bunk = seat.match(/^0?(\d{1,2})(?:号)?([下中上])铺$/);
    return bunk ? '0' + bunk[1].padStart(2, '0') + ('下中上'.indexOf(bunk[2]) + 1) : '';
  }
  return /^\d{1,3}$/.test(seat) && Number(seat) ? '0' + seat.padStart(3, '0') : '';
}

export function createRailTicketQR(record) {
  if (record.type !== 'rail' || record.deleted || record.ticketCode || !supportsGeneratedRailQR(record.template)) return '';
  const sale = String(record.saleCode || '').trim().toUpperCase().match(/^(\d{10})(\d{2})(\d{2})([A-Z]\d{6})$/);
  const serial = String(record.ticketNumber || '').trim().toUpperCase();
  const service = String(record.service || '').trim().toUpperCase().match(/^([A-Z]{0,3})(\d{1,5})$/);
  const fare = String(record.price || '').trim().match(/^(\d{1,4})(?:\.([05])0?)?$/);
  const time = record.departureTime || '';
  const date = calendarDate(record.departureDate);
  if (!sale || (serial && serial !== sale[4]) || !service || !Number(service[2]) || !fare ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) || date.length !== 10 || date < '2009-12-10') return '';
  const anonymous = isAnonymousRedTemplate(record.template);
  const identity = anonymous ? '' : String(record.identity || '').trim().toUpperCase();
  const name = anonymous ? '' : String(record.passenger || '').trim();
  const idType = anonymous ? 31 : /^\d{17}[\dX]$/.test(identity) ? 1 : /^\d{15}$/.test(identity) ? 2 : 0;
  if (!idType || !anonymous && (!/[1-9]/.test(identity) || !/^[\p{L}\p{M} .·'’-]+$/u.test(name))) return '';
  const from = resolvePlace(record, 'origin'), to = resolvePlace(record, 'destination');
  if (from.status !== 'matched' || to.status !== 'matched') return '';
  const coach = encodeCoach(String(record.carriage || '').trim());
  const seatClass = SEAT_CLASSES.indexOf(record.seatClass);
  const seat = encodeSeat(record);
  if (coach < 0 || coach >= 64 || seatClass < 0 || !record.seatClass || record.seatClass === '无座' || !seat) return '';

  const [year, month, day] = date.split('-');
  const departureDay = Number(month) * 31 + Number(day), saleDay = Number(sale[2]) * 31 + Number(sale[3]);
  const saleYear = Number(year) - Number(saleDay > departureDay && 371 - saleDay + departureDay <= 300);
  const saleDate = `${saleYear}-${sale[2]}-${sale[3]}`;
  if (saleDate > date || saleDay < departureDay && 371 + saleDay - departureDay < 31) return '';
  try { journeyDate(saleDate); } catch { return ''; }

  const header = sale[4] + from.code + to.code + 'AAA' + service[1].padStart(3, ' ') + service[2].padStart(5, '0') +
    String(coach).padStart(2, '0') + seatClass.toString(36).toUpperCase() + '00' + seat +
    fare[1].padStart(4, '0') + (fare[2] || '0') + year + month + day + '0A00' + sale[1] + saleYear + sale[2] + sale[3];
  const payload = encodeRailQR(header, { identity, idType, name, time });
  if (!payload) return '';
  return { version: 1, format: 'QRCode', rawBytes: btoa(payload), symbologyIdentifier: ']Q1', gs1: false, eci: [],
    parameters: { errorCorrectionLevel: 'M' } };
}
