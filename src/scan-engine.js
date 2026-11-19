import {calendarDate} from './journey-date.js';
import { parseText, parseSingleTicket } from './importers.js';
import { STATIONS, AIRPORTS } from './data/location-reference.js';
import { parseRailOrder } from './rail-order.js';
import { parseFlightScreenshot } from './flight-screenshot.js';
import { parsePrintedRailTicket } from './rail-ticket.js';
import { parsePrintedBoardingPass } from './boarding-pass.js';
import {markFieldSources} from './field-sources.js';

const pinyinStations = new Map();
const airports = new Map(AIRPORTS.map(row => [row[0], row]));
function airportName(code) {
  const explicit = { PKX: '北京大兴', TFU: '成都天府', CAN: '广州白云' };
  const chinese = airports.get(code)?.[4].split('|').find(value => /机场$/.test(value));
  return explicit[code] || (chinese ? chinese.replace(/(?:国际)?机场$/, '') : code);
}
const pinyinKey = value => value.toLowerCase().replace(/['’]/g, '');
for (const row of STATIONS) { const key = pinyinKey(row[3]); if (!pinyinStations.has(key)) pinyinStations.set(key, new Map()); pinyinStations.get(key).set(row[0], row); }
export function parseScanText(raw, label = '相机自动扫描', { singleTicket = false, layout = '', supplementalText = '', boardingReadings = [], boardingPayloads = [], boardingCodes = [] } = {}) {
  const text = raw.replace(/\b([A-Z]{2}|[A-Z]\d|\d[A-Z])([0-9O@Il]{2,5})\b/g, (all, prefix, number) => (number.match(/\d/g) || []).length >= 2 ? prefix + number.replace(/[O@]/g, '0').replace(/[Il]/g, '1') : all).replace(/\b(\d{1,2}):(\d{2})\b/g, (all, hour, minute) => +hour <= 23 && +minute <= 59 ? all : '');
  if(boardingCodes.length || boardingPayloads.length){
    const boarding=parsePrintedBoardingPass(raw,label,{layout,boardingReadings,boardingPayloads,boardingCodes});
    if(boarding!==null)return boarding;
  }
  const order = parseRailOrder(text, 'scan', label, { layout }) || parseFlightScreenshot(text, 'scan', label, { layout, supplementalText });
  if (order) return singleTicket && order.length !== 1 ? [] : order;
  const boarding = parsePrintedBoardingPass(raw, label, { layout, boardingReadings, boardingPayloads });
  if (boarding !== null) return boarding;
  const printedRail = parsePrintedRailTicket(text, label, { layout });
  if (printedRail !== null) return printedRail ? [printedRail] : [];
  let records = parseText(text, 'scan', label);
  if (singleTicket) records = [parseSingleTicket(text, 'scan', label)].filter(Boolean);
  if (records.length === 1 && records[0].type === 'flight' && /航空|登机|BOARDING/i.test(text)) {
    records[0].airline ||= text.match(/[\p{Script=Han}]{2,20}航空/u)?.[0] || '';
    const pairs = new Map();
    for (const match of text.matchAll(/\b([A-Z]{3})\s*(?:→|->|—|-)\s*([A-Z]{3})\b/g)) if (airports.has(match[1]) && airports.has(match[2])) pairs.set(match[1] + match[2], [match[1], match[2]]);
    if (pairs.size === 1) {
      const [origin, destination] = [...pairs.values()][0], record = records[0];
      record.originCode = origin; record.destinationCode = destination;
      if (!record.origin || record.origin === origin) record.origin = airportName(origin);
      if (!record.destination || record.destination === destination) record.destination = airportName(destination);
    }
    const lines = raw.split('\n').filter(line => line.trim());
    for (let i = 1; i < lines.length; i++) {
      const header = lines[i - 1], boarding = header.search(/BOARDING|登机时间/i), departure = header.search(/DEPARTURE|起飞时间/i);
      if(/实际|预计|ACTUAL|ESTIMATED/i.test(header))continue;
      if (!records[0].passenger && /NAME|姓名/i.test(header) && /FLIGHT|航班/i.test(header)) records[0].passenger = lines[i].match(new RegExp('^\\s*([\\u3400-\\u9fff]{2,20})\\s+' + records[0].service + '\\b'))?.[1] || '';
      const times = [...lines[i].matchAll(/\b\d{1,2}:\d{2}\b/g)].map(match => match[0]);
      if (boarding < 0 || departure < 0 || times.length < 2) continue;
      const validTime = value => /^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value) ? value.padStart(5, '0') : '';
      records[0].boardingTime = validTime(times[boarding < departure ? 0 : 1]);
      records[0].departureTime = validTime(times[boarding < departure ? 1 : 0]); break;
    }
  }
  if (records.length === 1 && records[0].type === 'rail') {
    const record = records[0], stations = [];
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
  }
  for(const record of records)markFieldSources(record,['airline','origin','originCode','destination','destinationCode','passenger','identity','boardingTime','departureTime','carriage','seat','ticketNumber'].filter(key=>record[key] && !record.fieldSources?.[key]),'ocr');
  return records;
}

export function videoCrop(videoWidth, videoHeight, display, guide) {
  if (![videoWidth, videoHeight, display.width, display.height, guide.width, guide.height].every(n => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.max(display.width / videoWidth, display.height / videoHeight);
  const x = Math.max(0, (guide.left - display.left + (videoWidth * scale - display.width) / 2) / scale);
  const y = Math.max(0, (guide.top - display.top + (videoHeight * scale - display.height) / 2) / scale);
  return { x, y, width: Math.min(guide.width / scale, videoWidth - x), height: Math.min(guide.height / scale, videoHeight - y) };
}

export function frameMetrics(image) {
  const { width, height, data } = image;
  const gray = new Float32Array(width * height); let sum = 0, squares = 0, edges = 0;
  for (let i = 0; i < gray.length; i++) { const value = data[i * 4] * .299 + data[i * 4 + 1] * .587 + data[i * 4 + 2] * .114; gray[i] = value; sum += value; squares += value * value; }
  for (let y = 1; y < height; y++) for (let x = 1; x < width; x++) { const i = y * width + x; edges += Math.abs(gray[i] - gray[i - 1]) + Math.abs(gray[i] - gray[i - width]); }
  const mean = sum / gray.length, contrast = Math.sqrt(Math.max(0, squares / gray.length - mean * mean));
  const fingerprint = [];
  for (let gy = 0; gy < 16; gy++) for (let gx = 0; gx < 24; gx++) {
    let total = 0, count = 0;
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) { const x = Math.min(width - 1, Math.floor((gx + (dx + .5) / 3) * width / 24)), y = Math.min(height - 1, Math.floor((gy + (dy + .5) / 3) * height / 16)); total += gray[y * width + x]; count++; }
    fingerprint.push(total / count);
  }
  return { mean, contrast, sharpness: edges / gray.length, fingerprint };
}
export const frameMotion = (a, b) => !a || a.length !== b.length ? Infinity : a.reduce((n, value, i) => n + Math.abs(value - b[i]), 0) / a.length;
export function frameQuality(metrics) {
  if (metrics.mean < 22) return '光线有些暗，移到明亮处';
  if (metrics.mean > 246) return '避开反光，让字迹更清楚';
  if (metrics.contrast < 16 || metrics.sharpness < 4) return '让票面放满框内，等待对焦';
  return '';
}
export function scanCandidate(text, confidence, expectedType, {
  layout = '', boardingReadings = [], boardingPayloads = [], boardingCodes = [], allowPartial = false
} = {}) {
  if (!Number.isFinite(confidence) || confidence < 40) return null;
  const records = parseScanText(text, allowPartial ? '相机拍照' : '相机自动扫描', {
    singleTicket: true, layout, boardingReadings, boardingPayloads, boardingCodes
  }).filter(record => {
    if (expectedType !== 'auto' && record.type !== expectedType) return false;
    if (allowPartial) return true;
    return record.service && (record.origin && record.destination ||
      calendarDate(record.departureDate).length === 10 && (record.origin || record.destination || record.departureTime || record.seatClass));
  });
  if(records.length===1)return records[0];
  if(records.length>1&&records[0].boardingCode&&records.every(record=>record.boardingCode?.rawBytes===records[0].boardingCode.rawBytes))return {...records[0],boardingCandidates:records};
  return null;
}
export function createScanConsensus() {
  let previous = '', count = 0, best = null, bestConfidence = 0;
  return {
    reset() { previous = ''; count = 0; best = null; bestConfidence = 0; },
    observe(record, confidence) {
      if (!record) { this.reset(); return null; }
      const signature = [record.type, record.service.toUpperCase(), JSON.stringify(record.departureDate), record.origin, record.destination,record.boardingCode?.rawBytes || ''].join('|');
      if (signature !== previous) { previous = signature; count = 0; best = null; bestConfidence = 0; }
      count++; if (confidence >= bestConfidence) { best = record; bestConfidence = confidence; }
      return count >= 2 ? best : null;
    }
  };
}
