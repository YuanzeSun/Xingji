import { journeyDate } from './journey-date.js';
import { readRailSeatClasses } from './seat-classes.js';

const compact = value => value.normalize('NFKC').replace(/\s+/g, '');

export function normalizeRailInvoice(value) {
  if (!value) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('铁路电子发票资料格式不正确');
  const { electronicTicketNumber = '' } = value;
  if (electronicTicketNumber === '') return undefined;
  if (typeof electronicTicketNumber !== 'string' || !/^\d{25}$/.test(electronicTicketNumber)) {
    throw new Error('铁路电子发票资料格式不正确');
  }
  return { electronicTicketNumber };
}

export function railInvoiceDetails(invoice) {
  return invoice?.electronicTicketNumber ? [['电子客票号', invoice.electronicTicketNumber]] : [];
}

export function parseRailInvoicePage({ view: [left, bottom, right, top], items }) {
  // PDF content-stream order can differ from what is displayed. Read the printed
  // regions in page coordinates, then sort the fragments inside each region.
  const cells = items.filter(item => item.str?.trim()).map(({ str, transform, height }) => ({
    str, x: (transform[4] - left) / (right - left),
    y: (transform[5] - bottom) / (top - bottom), height: height / (top - bottom)
  }));
  const text = (low, high, from = 0, to = 1, minHeight = 0) => cells
    .filter(cell => cell.y >= low && cell.y < high && cell.x >= from && cell.x < to && cell.height >= minHeight)
    .sort((a, b) => a.x - b.x)
    .map(cell => cell.str).join('').normalize('NFKC').trim();

  if (compact(text(.89, 1, .15, .85, .04)) !== '电子发票(铁路电子客票)') return null;
  const origin = compact(text(.725, .79, 0, .4)).replace(/站$/, '');
  const destination = compact(text(.725, .79, .6)).replace(/站$/, '');
  const service = compact(text(.725, .79, .4, .6)).toUpperCase();
  const originCode = compact(text(.68, .724, 0, .4));
  const destinationCode = compact(text(.68, .724, .6));
  const date = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(compact(text(.61, .675, 0, .19)));
  const time = /^([01]?\d|2[0-3]):([0-5]\d)开$/.exec(compact(text(.61, .675, .19, .34)));
  const seatText = compact(text(.61, .675, .34, .6));
  const carriage = /^(\d{1,3})车/.exec(seatText)?.[1] || '';
  const railStanding = seatText.includes('无座') || compact(text(.61, .675, .6)).includes('无座');
  const seat = railStanding ? '' : /^(\d{1,3}[A-Z]?)(?:号)?([上中下]铺?)?$/i
    .exec(seatText.replace(/^\d{1,3}车/, ''))?.slice(1).filter(Boolean).join('号') || '';
  const [seatClass = ''] = readRailSeatClasses(text(.61, .675, .6));
  const price = /^票价:?[¥￥]?([\d,]+(?:\.\d{1,2})?)$/.exec(compact(text(.52, .59, 0, .5)))?.[1]?.replaceAll(',', '') || '';
  const passenger = text(.39, .45, .28, .66);
  const identityHint = compact(text(.39, .45, 0, .28));
  const electronicTicketNumber = /^电子客票号:(\d{25})$/.exec(compact(text(.24, .30, 0, .64)))?.[1] || '';

  if (!/^\p{Script=Han}+$/u.test(origin) || !/^\p{Script=Han}+$/u.test(destination) ||
      !/^[A-Z]?\d{1,5}$/.test(service) || !date || !time || !price || !passenger || !electronicTicketNumber ||
      (!railStanding && (!carriage || !seat || !seatClass))) {
    throw new Error('铁路电子发票的行程字段不完整，请核对 PDF');
  }

  const [, year, month, day] = date;
  const departureDate = journeyDate(year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0'));
  return {
    type: 'rail', origin, destination, originCode, destinationCode, service, departureDate,
    departureTime: time[1].padStart(2, '0') + ':' + time[2], carriage, seat, seatClass, railStanding,
    price, passenger: passenger.includes('*') ? '' : passenger, identityHint, railInvoice: { electronicTicketNumber }
  };
}
