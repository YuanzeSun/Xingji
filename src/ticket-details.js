import { formatDate } from './model.js';
import { cityLabel } from './locations.js';
import { maskIdentity } from './identity.js';
import { describeMarks } from './ticket-marks.js';
import { railTrainsetIds } from './rail-journey.js';
import { readBoardingCode } from './bcbp.js';
import { flightPassengerName } from './flight-passenger.js';
import { ACTUAL_FLIGHT_FIELDS } from './flight-times.js';
import { FLIGHT_STATUSES } from './flight-status.js';
import { boardingMetadataDetails } from './boarding-details.js';
import { railInvoiceDetails } from './rail-invoice.js';
import { SUPPLEMENT_FIELDS } from './rail-template.js';
import { createRailTicketQR } from './rail-ticket-qr.js';

const populatedFields = (record, keys) => keys.filter(key => record[key]).map(key => [key, record[key]]);

export function ticketDetails(record) {
  const flight = record.type === 'flight';
  const passenger = flight ? flightPassengerName(record, readBoardingCode(record.boardingCode, record.boardingLegIndex) || {}) : record.passenger;
  const rows = [
    ['originCity', cityLabel(record, 'origin') || '待补充'],
    ['destinationCity', cityLabel(record, 'destination') || '待补充'],
    ['departureDate', formatDate(record.departureDate)],
    ...(flight ? [['departureTime', record.departureTime]] : []),
    ...(record.arrivalDate ? [['arrivalDate', formatDate(record.arrivalDate)]] : []),
    ...populatedFields(record, ['arrivalTime']),
    ['passenger', passenger],
    ...(record.identity ? [['identity', maskIdentity(record.identity)]] : []),
    ...populatedFields(record, ['gate', 'railPlatform']),
    ['seat', [record.type === 'rail' && record.carriage && record.carriage + '车', record.railStanding ? '无座' : record.seat, record.seatClass].filter(Boolean).join(' · ')],
    ['price', record.price ? `¥${record.price}` : ''],
    ...populatedFields(record, ['orderNumber']),
    ...(!record.railInvoice || record.ticketNumber ? [['ticketNumber', record.ticketNumber]] : [])
  ];
  if (record.type === 'rail') {
    const trainsets = railTrainsetIds(record);
    rows.push(
      ...populatedFields(record, ['railBureau', 'railModel']),
      ...(trainsets.length ? [['railTrainsets', trainsets.join(' / ')]] : []),
      ...populatedFields(record, ['railPowerSupply', 'railMileage', 'railRunner', 'railCarOwner', 'saleCode', 'issuer']),
      ...(record.template === 'rail-supplement' ? populatedFields(record, Object.keys(SUPPLEMENT_FIELDS)) : []),
      ['ticketMarks', describeMarks(record.ticketMarks)],
      ['ticketCode', record.ticketCode ? '已收录原码数据' : createRailTicketQR(record) ? '自动生成的二维码' : '未收录'],
      ...railInvoiceDetails(record.railInvoice)
    );
  }
  if (flight) rows.push(
    ...ACTUAL_FLIGHT_FIELDS.filter(key => record[key]).map(key => [key, key.endsWith('Date') ? formatDate(record[key]) : record[key]]),
    ...populatedFields(record, ['flightDistance']),
    ...boardingMetadataDetails(record),
    ...(record.marketingCarrier && record.airline ? [['airline', record.airline]] : []),
    ['flightStatus', FLIGHT_STATUSES[record.flightStatus || 'normal']],
    ['pnr', record.pnr],
    ['aircraft', record.aircraft],
    ...populatedFields(record, ['aircraftRegistration']),
    ['terminal', record.terminal],
    ['boardingTime', record.boardingTime],
    ['boardingCode', record.boardingCode ? '已保存条码数据' : '未收录']
  );
  return rows;
}
