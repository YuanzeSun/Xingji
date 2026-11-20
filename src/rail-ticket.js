import { createRecord, validDate } from './model.js';
import { STATIONS } from './data/location-reference.js';
import { ocrWords, railRouteAreas } from './ocr-layout.js';
import { marksFromText } from './ticket-marks.js';
import { railTemplateFromText } from './rail-template.js';

const key = value => value.toLowerCase().replace(/['’\s]/g, '');
const stations = new Map();
const stationNames = new Set(STATIONS.map(row => row[0]));
for (const row of STATIONS) {
  const code = key(row[3]);
  if (!stations.has(code)) stations.set(code, new Map());
  stations.get(code).set(row[0], row);
}
function stationFor(value, raw, fuzzy = true) {
  if (value.length < 4) return null;
  const code = key(value), exact = stations.get(code);
  const choose = rows => rows.size === 1 ? [...rows.values()][0] : [...rows.values()].find(row => raw.replace(/\s/g, '').includes(row[0] + '站')) || null;
  if (exact) return choose(exact);
  if (!fuzzy || code.length < 6) return null;
  const matches = new Map();
  for (const [candidate, rows] of stations) {
    if (candidate.length !== code.length || !choose(rows)) continue;
    let differences = 0;
    for (let i=0; i<code.length && differences<=1; i++) if (code[i] !== candidate[i]) differences++;
    if (differences === 1) {
      const row = choose(rows); matches.set(row[0], row);
    }
  }
  return matches.size === 1 ? [...matches.values()][0] : null;
}

export function railStationFromRegion(text, { fuzzy = true } = {}) {
  const names = new Set();
  for (const line of text.normalize('NFKC').split('\n')) {
    const region = line.trim();
    if (/^[\p{Script=Han}\s]{1,22}$/u.test(region)) {
      const name = region.replace(/\s/g, '').replace(/站$/, '');
      if (stationNames.has(name)) names.add(name);
    } else if (/^[A-Za-z'’\s]{4,30}$/.test(region)) {
      const station = stationFor(region, text, fuzzy);
      if (station) names.add(station[0]);
    }
  }
  return names.size === 1 ? [...names][0] : '';
}

export function printedRailNumber(text, footer = false) {
  const candidates = new Set();
  for (const line of text.normalize('NFKC').toUpperCase().split('\n')) {
    const words = line.trim().replace(/^(?:票号|底部售票码|售票码)\s*[:：]\s*/, '').split(/\s+/);
    const pattern = footer ? /^(?=.{17,25}$)\d{5,}[A-Z]?\d{8,}[A-Z]?\d{0,7}$/ : /^(?:[A-Z]\d{5,10}|\d{1,3}[A-Z]\d{5,9}|[A-Z]\d{3}[A-Z]\d{6})$/;
    for (const token of [words[0], words.join('')]) {
      const value = token.match(/^[A-Z0-9]+/)?.[0] || '';
      if (pattern.test(value)) candidates.add(value);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : '';
}
const trainCode = (value, route = false) => {
  const code = value.replace(/\s|次/g, '').toUpperCase();
  const match = code.match(route ? /^([GDCZTKYLSP]?)([0-9OIL]{1,5})$/ : /^([GDCZTKYLS])([0-9OIL]{1,5})$/);
  if (!match || !Number(match[2].replace(/O/g, '0').replace(/[IL]/g, '1')) || (!match[1] && (match[2].length < 3 || /^[0O]/.test(match[2])))) return '';
  const digits = match[2].replace(/O/g, '0').replace(/[IL]/g, '1');
  if (['12306', '95306'].includes(digits)) return '';
  return (match[1] === 'P' ? 'D' : match[1]) + digits;
};

export function railTrainRectangle(raw, layout) {
  const words = ocrWords(layout), page = layout?.split('\n').map(line => line.split('\t')).find(row => row[0] === '1');
  const width = +page?.[8];
  if (!width || /BOARDING|\bFLIGHT\b|航班|航空公司/i.test(raw)) return null;
  const anchors = words.filter(word => stationFor(word.text, raw));
  if (!anchors.length) return null;
  const top = Math.min(...anchors.map(word => word.top)), height = Math.max(...anchors.map(word => word.height));
  const candidates = words.filter(word => /^[A-Za-z0-9]{2,8}(?:次)?$/.test(word.text) && !stationFor(word.text, raw) && word.height >= height * .7 && word.top > top - height * 4 && word.top < top + height * .3 && word.left > width * .3 && word.left + word.width < width * .72)
    .sort((a,b) => Math.abs(a.left + a.width / 2 - width / 2) - Math.abs(b.left + b.width / 2 - width / 2));
  const word = candidates[0];
  if (!word) {
    const [from, to] = [...anchors].sort((a, b) => a.left - b.left);
    if (anchors.length !== 2 || Math.abs(from.top - to.top) > height || to.left - from.left < width * .3) return null;
    const left = Math.max(from.left + from.width * .8, width * .28);
    const right = Math.min(to.left + to.width * .15, width * .72);
    const cropTop = Math.max(0, top - height * 3);
    if (right <= left) return null;
    return { rectangle: { left: Math.floor(left), top: cropTop, width: Math.floor(right - left), height: Math.floor(top - cropTop + height / 4) }, confidence: 0 };
  }
  const pad = Math.max(4, Math.round(word.height * .16));
  return { rectangle: { left: Math.max(0, word.left-pad), top: Math.max(0, word.top-pad), width: Math.min(width-word.left+pad, word.width+pad*2), height: word.height+pad*2 }, text: word.text, confidence: word.confidence, code: trainCode(word.text, true) };
}

export function railFareRectangle(raw, layout) {
  const page = layout?.split('\n').map(line => line.split('\t')).find(row => row[0] === '1');
  const width = +page?.[8], height = +page?.[9];
  const anchors = ocrWords(layout).filter(word => stationFor(word.text, raw)).sort((a, b) => a.left - b.left);
  if (!width || !height || anchors.length !== 2 || anchors[0].left > width * .4 || anchors[1].left < width * .55) return null;
  const anchor = anchors[0], left = Math.max(0, Math.round(anchor.left - anchor.height * .6));
  const top = Math.round(anchor.top + anchor.height * 2.5);
  const box = { left, top, width:Math.floor(Math.min(width * .52, anchors[1].left - left)), height:Math.floor(Math.min(anchor.height * 4, height - top)) };
  return top < height * .8 && box.width >= 100 && box.height >= 40 ? box : null;
}

// Printed tickets put the train between the station names. A serial number
// elsewhere on the paper must never turn a railway ticket into a flight.
export function parsePrintedRailTicket(raw, label, { layout = '', paperColor = '', route = null } = {}) {
  if (/BOARDING|\bFLIGHT\b|航班|航空公司|订座编号/i.test(raw)) return null;
  const printed = /限乘|当日当次|仅供报销|报销凭证|退票费|买票请到|中国铁路|检票/.test(raw.replace(/\s/g, ''));
  const hits = [...raw.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)*/g)].map(match => ({ text: match[0], row: stationFor(match[0], raw), index: match.index })).filter(hit => hit.row);
  const unique = hits.filter((hit, i) => !i || hit.row[0] !== hits[i - 1].row[0]);
  if (unique.length > 2 && !route) return false; // Separate a collage before recognizing a single ticket.
  const probableRail = unique.length === 1 && /[¥￥]\s*\d/.test(raw) && /(?:19|20)\d{2}.{0,16}\d{1,2}[:：]/.test(raw);
  if (!route && !printed && !probableRail && unique.length !== 2) return null;
  const words = ocrWords(layout), pair = unique.length === 2 ? unique : [];
  const anchorFor = hit => words.find(word => key(word.text) === key(hit.text));
  if (pair.length === 2 && pair.every(anchorFor)) pair.sort((a,b) => anchorFor(a).left - anchorFor(b).left);
  const anchors = pair.map(anchorFor);
  let service = route?.service || trainCode(raw.match(/车次\s*[:：]\s*([A-Z]?\d{1,5})/)?.[1] || '', true);
  service ||= [...raw.matchAll(/\b[GDCZTKYLS]\s*[0-9OIl]{1,5}(?:次)?\b/g)].map(match => trainCode(match[0])).find(Boolean) || '';
  if (anchors.length === 2 && anchors.every(Boolean)) {
    const [from, to] = anchors;
    const candidates = words.filter(word => word.left > from.left + from.width * .5 && word.left + word.width < to.left + to.width * .5 && word.top + word.height * .5 < Math.max(from.top, to.top) + Math.max(from.height, to.height) * .3 && word.top > Math.min(from.top, to.top) - Math.max(from.height, to.height) * 4)
      .map(word => ({ word, code: trainCode(word.text, true) })).filter(item => item.code)
      .sort((a, b) => Math.abs(a.word.top + a.word.height - from.top) - Math.abs(b.word.top + b.word.height - from.top));
    service ||= candidates[0]?.code || '';
  }
  service ||= [...raw.matchAll(/\b[GDCZTKYLS][0-9OIl]{1,5}(?:次)?\b/g)].map(match => trainCode(match[0])).find(Boolean) || '';
  if (!pair.length && !service) return false;
  const compact = raw.replace(/(?<=\d)\s*[:：]\s*(?=\d)/g, ':');
  const date = compact.match(/((?:19|20)\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})(?:日|目)?/);
  const departureDate = date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : '';
  const time = compact.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const seatRow = time ? compact.slice(time.index + time[0].length).split('\n')[0] : '';
  const seat = seatRow.match(/([0-9OIl]{1,2})\s*[车#%*]\s*[*#]?\s*([0-9OIl]{1,3}[A-F]?)(?:[号#%]\s*|\s+|(?=[上中下]\s*铺)|$)(?:([上中下])\s*铺)?/i);
  const digits = value => value.replace(/O/gi, '0').replace(/[Il]/g, '1');
  const price = compact.match(/[¥￥Y]\s*(\d{1,4}(?:\s*\.\s*\d{1,2})?)(?:元|%|\s|$)/);
  const seatClass = compact.match(/商务座|特等座|一等座|二等座|高级软卧|软卧|硬卧|软座|硬座/)?.[0] || '';
  const identity = raw.match(/(\d{6,14}[*xX]{2,8}\d{2,4})\s+([\p{Script=Han}]{2,8})/u);
  let origin = route?.origin || pair[0]?.row[0] || '', destination = route?.destination || pair[1]?.row[0] || '';
  for (const side of route ? [] : ['origin', 'destination']) {
    const explicit = raw.match(new RegExp((side === 'origin' ? '出发站' : '到达站') + '[：:]\\s*([^\\n]+)'));
    const name = explicit && railStationFromRegion(explicit[1]);
    if (name && side === 'origin') origin = name;
    else if (name) destination = name;
  }
  if (!route && !pair.length && unique.length === 1) {
    const word = anchorFor(unique[0]), page = layout.split('\n').map(line=>line.split('\t')).find(row=>row[0]==='1');
    const width = +page?.[8];
    if (word && width) {
      if (word.left + word.width < width * .45) origin = unique[0].row[0];
      else if (word.left > width * .55) destination = unique[0].row[0];
    }
  }
  if ((!origin || !destination) && service) {
    const areas = railRouteAreas(layout, service);
    const chinaStation = value => {
      const name = value?.replace(/站$/, '');
      return stationNames.has(name) ? name : '';
    };
    origin ||= chinaStation(areas?.origin);
    destination ||= chinaStation(areas?.destination);
    if (!origin || !destination) {
      const route = compact.match(new RegExp('([\\u3400-\\u9fff][\\u3400-\\u9fff \\t]{1,18})\\s*' + service + '(?:次)?\\s*([\\u3400-\\u9fff][\\u3400-\\u9fff \\t]{1,18})'));
      if (route) {
        origin ||= railStationFromRegion(route[1]);
        destination ||= railStationFromRegion(route[2]);
      }
    }
  }
  const record = createRecord({ type: 'rail', template: railTemplateFromText(raw, { paperColor, departureDate }), origin, destination,
    originCode: pair[0]?.row[0] === origin ? pair[0].row[3] : '', destinationCode: pair[1]?.row[0] === destination ? pair[1].row[3] : '', service,
    departureDate: validDate(departureDate) ? departureDate : '', departureTime: time ? `${time[1].padStart(2, '0')}:${time[2]}` : '',
    carriage: seat ? digits(seat[1]) : '', seat: seat ? digits(seat[2]).toUpperCase() + (seat[3] ? '号' + seat[3] + '铺' : '') : '', seatClass, railStanding: /无\s*座|站票/.test(seatRow) || /(?:席别|座位)[：:\s]*无\s*座|(?:商务座|一等座|二等座|硬座|软座)[：:\s]*无\s*座|^\s*无\s*座\s*$/m.test(compact), price: price ? price[1].replace(/\s/g, '') : '', identity: identity?.[1] || '', passenger: identity?.[2] || '',
    ticketNumber: printedRailNumber(raw.split('\n').slice(0, 3).join('\n')),
    saleCode: printedRailNumber(raw.split('\n').filter(line => line.trim()).slice(-3).join('\n'), true),
    gate: raw.match(/检票(?:口)?\s*[:：]?\s*([A-Z]?\d+[A-Z]?)/)?.[1] || '', ticketMarks: marksFromText(raw),
    sources: [{ kind: 'scan', label }], provenance: 'reconstruction' });
  return record;
}
