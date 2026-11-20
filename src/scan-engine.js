import {calendarDate} from './journey-date.js';
import { parseText, parseSingleTicket } from './importers.js';
import { STATIONS } from './data/location-reference.js';
import { parseRailOrder } from './rail-order.js';
import { parsePrintedRailTicket } from './rail-ticket.js';
import { detectedRailTemplate } from './rail-template.js';
import { createRecord } from './model.js';
import {markFieldSources} from './field-sources.js';

const pinyinStations = new Map();
const photoFields = ['origin','originCode','destination','destinationCode','service','departureDate',
  'departureTime','passenger','carriage','seatClass','seat','railStanding','price','gate','ticketNumber','saleCode','issuer','ticketMarks'];

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
export function parseScanText(raw, label = '相机自动扫描', {
  singleTicket = false, layout = '', paperColor = '', flightImage = false, railFields = {}, route = null
} = {}) {
  if (flightImage) return [];
  const text = raw.replace(/\b(\d{1,2}):(\d{2})\b/g, (all, hour, minute) => +hour <= 23 && +minute <= 59 ? all : '');
  const order = parseRailOrder(text, 'scan', label, { layout });
  if (order) {
    for (const record of order) markFieldSources(record, ['template'], detectedRailTemplate(text) ? 'ocr' : 'default');
    return singleTicket && order.length !== 1 ? [] : order;
  }
  const printed = parsePrintedRailTicket(text, label, { layout, paperColor, route });
  if (printed) return [createRecord({ ...printed, ...railFields, fieldSources: {
    ...printed.fieldSources, ...Object.fromEntries(Object.keys(railFields).map(key => [key, 'ocr']))
  } })];
  if (printed === false) return [];
  const records = (singleTicket ? [parseSingleTicket(text, 'scan', label)] : parseText(text, 'scan', label))
    .filter(record => record?.type === 'rail');
  if (!records.length && paperColor && Object.keys(railFields).length) {
    const template = detectedRailTemplate(text, { paperColor });
    return [createRecord({ ...(template && { template }), ...railFields, sources: [{ kind:'scan', label }] })];
  }
  if (records.length === 1 && records[0].type === 'rail') {
    const record = records[0], stations = [];
    const template = detectedRailTemplate(text, { paperColor, departureDate: calendarDate(record.departureDate) });
    if (template) record.template = template;
    markFieldSources(record, ['template'], template ? 'ocr' : 'default');
    for (const match of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)) {
      const rows = pinyinStations.get(pinyinKey(match[0])); if (rows?.size === 1) stations.push([...rows.values()][0]);
    }
    if (stations.length >= 2) {
      [record.origin, record.originCode] = [stations[0][0], stations[0][3]];
      [record.destination, record.destinationCode] = [stations[1][0], stations[1][3]];
    }
    const identity = text.match(/(\d{6,14}[*xX]{2,8}\d{2,4})\s+([\p{Script=Han}]{2,8})/u);
    if (identity) { record.identity ||= identity[1]; record.passenger ||= identity[2]; }
    const timeRow = text.split('\n').find(line => /\d{1,2}:\d{2}/.test(line)) || '';
    const seat = timeRow.replace(/^.*?\d{1,2}:\d{2}/, '').match(/(\d{1,2})[车#]\s*(\d{1,3}[A-F]|\d{1,3}[上下中]铺?)[号#]?/);
    if (seat) { record.carriage ||= seat[1]; record.seat ||= seat[2]; }
    record.ticketNumber ||= text.match(/^\s*([A-Z]\d{5,10})(?=\s|$)/m)?.[1] || '';
    Object.assign(record, railFields);
    markFieldSources(record, Object.keys(railFields), 'ocr');
  }
  for(const record of records)markFieldSources(record,['origin','originCode','destination','destinationCode','passenger','identity','departureTime','carriage','seat','ticketNumber'].filter(key=>record[key] && !record.fieldSources?.[key]),'ocr');
  return records;
}
