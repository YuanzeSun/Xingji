import { escape as e } from './html.js';
import { formatDate } from './model.js';
import { cityLabel } from './locations.js';
import { resolvePlace } from './places.js';
import { maskIdentity } from './identity.js';
import { describeMarks } from './ticket-marks.js';
import { railTrainsetIds } from './rail-journey.js';
import { readBoardingCode } from './bcbp.js';
import { barcodePayloadMarkup } from './barcode-payload.js';
import { flightPassengerName } from './flight-passenger.js';
import { ACTUAL_FLIGHT_FIELDS, flightTimeZoneLabel } from './flight-times.js';
import { FLIGHT_STATUSES } from './flight-status.js';
import { boardingMetadataDetails } from './boarding-details.js';
import { railInvoiceDetails } from './rail-invoice.js';
import { SUPPLEMENT_FIELDS } from './rail-template.js';
import { isRefundReceipt } from './record-kind.js';
import { ticketFieldLabel } from './ticket-form.js';
import { fieldSourceBadge, isRailLookupSource } from './field-sources.js';
import { flightStopText } from './flight-stop.js';
import { flightTimeComparison } from './flight-time-comparison.js';

const values = (record, ...keys) => keys.map(key => [key, record[key]]);

function flightAirport(record, side, terminal) {
  const place = resolvePlace(record, side);
  const name = place.chineseFullName || place.fullName || record[side] || record[side + 'Code'];
  const code = place.code || record[side + 'Code'];
  const airport = name && code && name !== code ? `${name}（${code}）` : name;
  return [airport || '待补充', terminal].filter(Boolean).join(' · ');
}

function flightSections(record) {
  const metadata = boardingMetadataDetails(record);
  const codeshare = key => key === 'marketingCarrier' || key === 'marketingFlightNumber';
  return [
    ['aircraft', '航司与飞机', [
      ...values(record, 'airline', 'boardingCodeOperatingFlight'),
      ...metadata.filter(([key]) => codeshare(key)),
      ...values(record, 'aircraft', 'aircraftRegistration')
    ]],
    ['baggage', '行李与常旅客', metadata.filter(([key]) => !codeshare(key))],
    ['booking', '票务与条码', [
      ['flightStatus', FLIGHT_STATUSES[record.flightStatus || 'normal']],
      ['price', record.price && `¥${record.price}`],
      ...values(record, 'pnr', 'ticketNumber'),
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
  if (key === 'price' && isRefundReceipt(record)) return '退票费（元）';
  if (key === 'seat' && record.type === 'flight') return '座位 / 舱位';
  if (key === 'issuer' && record.template === 'rail-supplement') return '出票客运段';
  return ticketFieldLabel(key, record.type, labels[key]);
}

export function ticketDetailsMarkup(record, labels, hasRenderedCode) {
  const flight = record.type === 'flight';
  const comparison = flight && flightTimeComparison(record);
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
      ...(flight ? [
        ['origin', flightAirport(record, 'origin', record.departureTerminal)],
        ['destination', flightAirport(record, 'destination', record.arrivalTerminal)]
      ] : [
        ['originCity', cityLabel(record, 'origin') || '待补充'],
        ['destinationCity', cityLabel(record, 'destination') || '待补充']
      ]),
      ['departureDate', !comparison && formatDate(record.departureDate)],
      ['departureTime', !comparison && (flight || isRailLookupSource(record.fieldSources?.departureTime)) && record.departureTime],
      ['arrivalDate', !comparison && record.arrivalDate && formatDate(record.arrivalDate)],
      ['arrivalTime', !comparison && record.arrivalTime],
      ...values(record, flight ? 'flightDistance' : 'railMileage'),
      ['flightStop', flight && flightStopText(record.flightStop)]
    ]],
    ...(flight ? [['actual-times', comparison ? '计划与实际起降' : '实际起降',
      comparison ? [] : ACTUAL_FLIGHT_FIELDS.map(key =>
        [key, record[key] && (key.endsWith('Date') ? formatDate(record[key]) : record[key])]), comparison]] : []),
    ['passenger', flight ? '旅客与登机' : '旅客与乘车', [
      ['passenger', passenger],
      ['identity', maskIdentity(record.identity)],
      ...values(record, ...(flight ? ['gate'] : ['railPlatform', 'gate'])),
      ['boardingTime', flight && record.boardingTime],
      ['seat', seat]
    ]],
    ...(flight ? flightSections(record) : railSections(record, hasRenderedCode))
  ];
  return `<div class="ticket-detail-groups">${sections.map(([name, title, rows, comparison]) => {
    const fields = rows.filter(([, value]) => value);
    if (!fields.length && !comparison) return '';
    const heading = `ticket-detail-${name}`;
    return `<section class="ticket-detail-group" data-ticket-detail="${name}" aria-labelledby="${heading}">
      <h3 id="${heading}">${title}</h3>${comparison || ''}
      ${fields.length ? `<dl class="detail-grid">${fields.map(([key, value]) => {
        const timeZone = flight && flightTimeZoneLabel(key);
        const payload = key === 'boardingCode' ? barcodePayloadMarkup(record.boardingCode) : '';
        return `<div data-detail-field="${e(key)}"${payload ? ' class="full-field"' : ''}><dt>${e(detailLabel(record, key, labels))}${detailSourceBadge(key, record)}</dt>` +
          `<dd>${e(value)}${timeZone ? ` <small class="flight-local-time">${e(timeZone)}</small>` : ''}${payload}</dd></div>`;
      }).join('')}</dl>` : ''}
    </section>`;
  }).join('')}</div>`;
}

function detailSourceBadge(key, record) {
  const source = record.fieldSources?.[key];
  return source && (key === 'flightStop' || isRailLookupSource(source))
    ? fieldSourceBadge(key, record) : '';
}
