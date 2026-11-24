import {calendarDate} from './journey-date.js';
import { STATIONS } from './data/location-reference.js';
import { isRailOrderText, parseRailOrder } from './rail-order.js';
import { parsePrintedRailTicket, printedRailNumber } from './rail-ticket.js';
import { detectedRailTemplate, SUPPLEMENT_FIELDS } from './rail-template.js';
import { createRecord, validDate } from './model.js';
import {markFieldSources} from './field-sources.js';
import { readRailSeatClasses } from './seat-classes.js';
import { marksFromText } from './ticket-marks.js';

const pinyinStations = new Map();
const photoFields = ['origin','originCode','destination','destinationCode','service','departureDate',
  'departureTime','passenger','carriage','seatClass','seat','railStanding','price','gate','ticketNumber','saleCode','issuer','ticketMarks', ...Object.keys(SUPPLEMENT_FIELDS)];

export function railPhotoChanges(draft, record) {
  if (!record) return {};
  const present = value => Array.isArray(value) ? value.length > 0 : !!value;
  const editable = key => !draft.lockedFields.includes(key) && draft.fieldSources[key] !== 'manual';
  const changes = Object.fromEntries(photoFields.filter(key => {
    const source = draft.fieldSources[key];
    return present(record[key]) && editable(key) &&
      (!present(draft[key]) || source === 'profile' || source === 'ocr');
  }).map(key => [key, record[key]]));
  if (record.template !== draft.template && record.fieldSources.template === 'ocr') changes.template = record.template;
  if (changes.origin && !changes.originCode) changes.originCode = '';
  if (changes.destination && !changes.destinationCode) changes.destinationCode = '';
  if (draft.carriage && record.carriage && draft.carriage !== record.carriage && !changes.carriage) {
    delete changes.seat;
    delete changes.railStanding;
  }
  if (changes.railStanding && draft.seat) {
    if (draft.fieldSources.seat === 'ocr' && editable('seat')) changes.seat = '';
    else delete changes.railStanding;
  }
  if (changes.seat && draft.railStanding) {
    if (draft.fieldSources.railStanding === 'ocr' && editable('railStanding')) changes.railStanding = false;
    else delete changes.seat;
  }
  return changes;
}

const pinyinKey = value => value.toLowerCase().replace(/['’]/g, '');
for (const row of STATIONS) { const key = pinyinKey(row[3]); if (!pinyinStations.has(key)) pinyinStations.set(key, new Map()); pinyinStations.get(key).set(row[0], row); }

export function isFlightPhotoText(raw) {
  const text = raw.normalize('NFKC').replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '');
  return /BOARDING\s*(?:PASS|CARD)|登[机機]牌|航班(?:号)?[:\s]*[A-Z]{2}\s*\d|\bFLIGHT\b|航旅[纵织]横|UMETRIP|航班详情|航空公司|订座编号|客票已使用/i.test(text) ||
    (!isRailOrderText(text) && /行程全记录|历史行程|行程详情|行程服务/.test(text));
}

function readRailPhotoFields(text, label) {
  const capture = pattern => text.match(pattern)?.[1]?.trim() || '';
  const service = (capture(/(?<![A-Z0-9])([GDCZTKYL]\d{1,5})(?![A-Z0-9])/i) || capture(/(?:车次|列车)\s*[:：]?\s*(\d{1,5})/)).toUpperCase();
  const date = text.match(/((?:19|20)\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})日?/);
  const departureDate = date ? date[1] + '-' + date[2].padStart(2, '0') + '-' + date[3].padStart(2, '0') : '';
  const departureTime = capture(/(?:开车|出发时间|发车时间|时间|出发)\s*[:：]?\s*(\d{1,2}:\d{2})/) || capture(/(\d{2}:\d{2})/);
  let origin = capture(/(?:出发站|发站|始发站|出发地|出发|FROM)\s*[:：]\s*([^\s,，;；→—]+)/i);
  let destination = capture(/(?:到达站|到站|终到站|目的地|到达|TO)\s*[:：]\s*([^\s,，;；→—]+)/i);
  const route = text.match(/([\u3400-\u9fffA-Z]{2,20})\s*(?:→|->|—|至|到)\s*([\u3400-\u9fffA-Z]{2,20})/i);
  origin ||= route?.[1] || '';
  destination ||= route?.[2] || '';
  if (service && (!origin || !destination)) {
    const routeRow = text.match(new RegExp('([\\u3400-\\u9fff]{2,12})站?\\s*' + service + '\\s*([\\u3400-\\u9fff]{2,12})站?'));
    origin ||= routeRow?.[1] || '';
    destination ||= routeRow?.[2] || '';
  }
  if (!service && !departureDate && !origin && !destination) return null;

  const seat = text.match(/(?:座位|座号|SEAT|\d{1,2}\s*车(?:厢)?)\s*[:：]?\s*([\dA-Z\-]{1,8})(?:\s*号)?(?:\s*([上中下])\s*铺)?/i);
  return createRecord({
    service, origin, destination, departureDate: validDate(departureDate) ? departureDate : '',
    departureTime: departureTime ? departureTime.padStart(5, '0') : '',
    passenger: capture(/(?:乘车人|旅客|姓名|PASSENGER)\s*[:：]\s*([^,，;；\n]{1,50})/i),
    carriage: capture(/(\d{1,2})\s*车(?:厢)?/),
    seat: seat ? seat[1] + (seat[2] ? '号' + seat[2] + '铺' : '') : '',
    seatClass: readRailSeatClasses(text)[0] || '', railStanding: /无\s*座|站票/.test(text),
    price: capture(/(?:票价|价格|金额|CNY|RMB|￥|¥)\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/i),
    gate: capture(/(?:检票(?:口)?|GATE)\s*[:：]?\s*([A-Z0-9][A-Z0-9/\-]{0,15})(?![A-Z0-9])/i),
    orderNumber: capture(/(?:电子订单号|订单编号|订单号)\s*[:：]?\s*([A-Z0-9]{6,30})/i).toUpperCase(),
    ticketNumber: capture(/(?:电子客票号|客票号|票号|TICKET)\s*[:：]?\s*([A-Z0-9-]{6,30})/i),
    ticketMarks: marksFromText(text), sources: [{ kind: 'scan', label }], provenance: 'reconstruction'
  });
}

export function parseScanText(raw, label = '相机自动扫描', {
  singleTicket = false, layout = '', paperColor = '', flightImage = false, railFields = {}, route = null
} = {}) {
  if (flightImage || isFlightPhotoText(raw)) return [];
  const text = raw.replace(/\b(\d{1,2}):(\d{2})\b/g, (all, hour, minute) => +hour <= 23 && +minute <= 59 ? all : '');
  const order = parseRailOrder(text, label, { layout });
  if (order) {
    for (const record of order) markFieldSources(record, ['template'], detectedRailTemplate(text) ? 'ocr' : 'default');
    return singleTicket && order.length !== 1 ? [] : order;
  }
  const printed = parsePrintedRailTicket(text, label, { layout, paperColor, route });
  if (printed) return [createRecord({ ...printed, ...railFields, fieldSources: {
    ...printed.fieldSources, ...Object.fromEntries(Object.keys(railFields).map(key => [key, 'ocr']))
  } })];
  if (printed === false) return [];
  const record = readRailPhotoFields(text, label);
  if (!record) {
    if (!paperColor || !Object.keys(railFields).length) return [];
    const template = detectedRailTemplate(text, { paperColor });
    return [createRecord({ ...(template && { template }), ...railFields, sources: [{ kind:'scan', label }] })];
  }
  const template = detectedRailTemplate(text, { paperColor, departureDate: calendarDate(record.departureDate) });
  if (template) record.template = template;
  markFieldSources(record, ['template'], template ? 'ocr' : 'default');
  const stations = [];
  for (const match of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
    const rows = pinyinStations.get(pinyinKey(match[0]));
    if (rows?.size === 1) stations.push([...rows.values()][0]);
  }
  if (stations.length >= 2) {
    [record.origin, record.originCode] = [stations[0][0], stations[0][3]];
    [record.destination, record.destinationCode] = [stations[1][0], stations[1][3]];
  }
  record.passenger ||= text.match(/\d{6,14}[*xX]{2,8}\d{2,4}\s+([\p{Script=Han}]{2,8})/u)?.[1] || '';
  const timeRow = text.split('\n').find(line => /\d{1,2}:\d{2}/.test(line)) || '';
  const seat = timeRow.replace(/^.*?\d{1,2}:\d{2}/, '').match(/(\d{1,2})[车#]\s*(\d{1,3}[A-F]|\d{1,3}[上下中]铺?)[号#]?/);
  if (seat) { record.carriage ||= seat[1]; record.seat ||= seat[2]; }
  record.ticketNumber ||= printedRailNumber(text.split('\n').slice(0, 3).join('\n'));
  Object.assign(record, railFields);
  markFieldSources(record, ['origin','originCode','destination','destinationCode','passenger','carriage','seat','ticketNumber', ...Object.keys(railFields)], 'ocr');
  return [record];
}
