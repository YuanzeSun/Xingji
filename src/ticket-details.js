import { escape as e } from './html.js';
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
import { isRefundReceipt } from './record-kind.js';
import { ticketFieldLabel } from './ticket-form.js';
import { fieldSourceBadge, RAILGO_REFERENCE_SOURCE } from './field-sources.js';
import { flightStopsText } from './flight-stops.js';

const values = (record, ...keys) => keys.map(key => [key, record[key]]);

function flightSections(record) {
  const metadata = boardingMetadataDetails(record);
  return [
    ['actual-times', '实际登机与起降', ACTUAL_FLIGHT_FIELDS.map(key =>
      [key, record[key] && (key.endsWith('Date') ? formatDate(record[key]) : record[key])])],
    ['aircraft', '航司与飞机', [
      ...values(record, 'airline'),
      ...metadata.filter(([key]) => key === 'marketingCarrier'),
      ...values(record, 'aircraft', 'aircraftRegistration')
    ]],
    ['baggage', '行李与常旅客', metadata.filter(([key]) => key !== 'marketingCarrier')],
    ['booking', '票务与条码', [
      ['flightStatus', FLIGHT_STATUSES[record.flightStatus || 'normal']],
      ['price', record.price && `¥${record.price}`],
      ...values(record, 'pnr', 'orderNumber', 'ticketNumber'),
      ['boardingCode', record.boardingCode ? '已保存条码数据' : '未收录']
    ]]
  ];
}

function railSections(record, hasRenderedCode) {
  return [
    ['train', '列车资料', [
      ...values(record, 'railBureau', 'railModel'),
      ['railTrainsets', railTrainsetIds(record).join(' / ')],
      ...values(record, 'railPowerSupply', 'railRunner', 'railCarOwner')
    ]],
    ['booking', '票务与凭证', [
      ['price', record.price && `¥${record.price}`],
      ...values(record, 'orderNumber', 'ticketNumber', 'issuer', 'saleCode'),
      ...railInvoiceDetails(record.railInvoice),
      ...(record.template === 'rail-supplement' ? values(record, ...Object.keys(SUPPLEMENT_FIELDS)) : []),
      ['ticketMarks', record.ticketMarks?.length && describeMarks(record.ticketMarks)],
      ['ticketCode', record.ticketCode ? '已收录原码数据' : hasRenderedCode ? '票面有二维码' : '未收录']
    ]]
  ];
}

function detailLabel(record, key, labels) {
  if (key === 'flightStops') return '经停情况';
  if (key === 'price' && isRefundReceipt(record)) return '退票费（元）';
  if (key === 'seat' && record.type === 'flight') return '座位 / 舱位';
  if (key === 'issuer' && record.template === 'rail-supplement') return '出票客运段';
  return ticketFieldLabel(key, record.type, labels[key]);
}

export function ticketDetailsMarkup(record, labels, hasRenderedCode) {
  const flight = record.type === 'flight';
  const passenger = flight
    ? flightPassengerName(record, readBoardingCode(record.boardingCode, record.boardingLegIndex) || {})
    : record.passenger;
  const seat = [
    !flight && record.carriage && record.carriage + '车',
    record.railStanding ? '无座' : record.seat,
    record.seatClass
  ].filter(Boolean).join(' · ');
  const sections = [
    ['journey', '行程安排', [
      ['originCity', cityLabel(record, 'origin') || '待补充'],
      ['destinationCity', cityLabel(record, 'destination') || '待补充'],
      ['departureDate', formatDate(record.departureDate)],
      ['departureTime', flight && record.departureTime],
      ['arrivalDate', record.arrivalDate && formatDate(record.arrivalDate)],
      ...values(record, 'arrivalTime', flight ? 'flightDistance' : 'railMileage'),
      ['flightStops', flight && flightStopsText(record.flightStops)]
    ]],
    ['passenger', flight ? '旅客与登机' : '旅客与乘车', [
      ['passenger', passenger],
      ['identity', maskIdentity(record.identity)],
      ...values(record, flight ? 'terminal' : 'railPlatform', 'gate'),
      ['boardingTime', flight && record.boardingTime],
      ['seat', seat]
    ]],
    ...(flight ? flightSections(record) : railSections(record, hasRenderedCode))
  ];
  return `<div class="ticket-detail-groups">${sections.map(([name, title, rows]) => {
    const fields = rows.filter(([, value]) => value);
    if (!fields.length) return '';
    const heading = `ticket-detail-${name}`;
    return `<section class="ticket-detail-group" data-ticket-detail="${name}" aria-labelledby="${heading}">
      <h3 id="${heading}">${title}</h3>
      <dl class="detail-grid">${fields.map(([key, value]) => `<div data-detail-field="${e(key)}">` +
        `<dt>${e(detailLabel(record, key, labels))}${record.fieldSources?.[key] === RAILGO_REFERENCE_SOURCE ? fieldSourceBadge(key, record) : ''}</dt>` +
        `<dd>${e(value)}</dd></div>`).join('')}</dl>
    </section>`;
  }).join('')}</div>`;
}
