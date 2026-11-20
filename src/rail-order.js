import { createRecord, now, validDate } from './model.js';
import { STATIONS } from './data/location-reference.js';
import { railTimeWords, railRouteAreas } from './ocr-layout.js';
import { marksFromText } from './ticket-marks.js';
import { railTemplateFromText } from './rail-template.js';
import { readRailSeatClasses } from './seat-classes.js';

const stationNames = new Set(STATIONS.map(row => row[0]));
const stationPattern = new RegExp([...stationNames].sort((a, b) => b.length - a.length).join('|'), 'g');
const datePattern = /((?:19|20)\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})日?/g;
const trainPattern = /(?<![A-Z0-9])([GDCZTKYL]\s*[0-9OIl]{1,5})(?![A-Z0-9])/gi;
const timePattern = /(?<!\d)([0-2]?\d:[0-5]\d)(?!\d)/g;
const normal = text => String(text || '').normalize('NFKC').replace(/\r/g, '').replace(/[：﹕]/g, ':').replace(/(?<=[\u3400-\u9fff])[ \t]+(?=[\u3400-\u9fff])/g, '').replace(/([0-2]?\d)[ \t]*:[ \t]*(\d{2})/g, '$1:$2');
const trainCode = value => { const code = value.replace(/\s/g, '').toUpperCase(); return code[0] + code.slice(1).replace(/O/g, '0').replace(/[IL]/g, '1'); };
const unique = values => [...new Set(values.filter(Boolean))];
const only = values => unique(values).length === 1 ? unique(values)[0] : '';
const times = text => [...text.matchAll(timePattern)].map(match => +match[1].split(':')[0] < 24 ? match[1].padStart(5, '0') : '').filter(Boolean);
function dates(text) {
  return [...text.matchAll(datePattern)].map(match => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`).filter(validDate);
}
function labelled(text, labels) {
  const match = new RegExp(`(?:${labels})\\s*:?\\s*([^\\n]*(?:\\n[^\\n]+)?)`).exec(text);
  return match ? match[1].split(/\n/).slice(0, match[1].split('\n')[0].trim() ? 1 : 2).join('\n') : '';
}
function stationValue(text, labels) {
  const value = labelled(text, labels).split(/到达站|出发站|发站|到站|车次|开车|到达时间|出发时间|日期|时间/)[0].trim();
  const word = value.match(/^[\u3400-\u9fff]{2,16}/)?.[0] || '';
  if (stationNames.has(word)) return word;
  if (stationNames.has(word.replace(/站$/, ''))) return word.replace(/站$/, '');
  return word && !/旅客|车票|订单|信息|身份证|乘车人/.test(word) ? word.replace(/站$/, '') : '';
}
export function isRailOrderText(raw) {
  const text = normal(raw);
  return /订单详情|订单[号编]|购票详细信息|购票信息|车票详情|本人车票/.test(text) && /车次|发车时间|乘车|出发站|席别|二等座|一等座|软卧|硬卧|\d\s*车/.test(text) && (new RegExp(trainPattern.source, 'i').test(text) || /车次\s*:?\s*\d{3,5}\b/.test(text));
}
export function railOrderService(raw) {
  const text = normal(raw).split(/\n\s*(?:预订酒店|更多服务|温馨提示|推荐酒店|猜你喜欢|广告)/)[0];
  const codes = unique([...text.matchAll(trainPattern)].map(match => trainCode(match[1])));
  return codes.length === 1 ? codes[0] : codes.length === 0 ? text.match(/车次\s*:?\s*(\d{3,5})\b/)?.[1] || '' : '';
}
function passengerFields(text) {
  const seatMatches = [...text.matchAll(/(?:^|[^\d])(\d{1,2})\s*车(?:厢)?\s*(\d{1,3}\s*[A-F]|\d{1,3}\s*号?\s*[上中下]铺?|\d{1,3}(?=\s*号))(?:号)?/gi)];
  let carriage = only(seatMatches.map(match => match[1])), seat = only(seatMatches.map(match => match[2].replace(/\s|号/g, '').toUpperCase()));
  carriage ||= only([...text.matchAll(/车厢(?:号)?\s*:?\s*(\d{1,2})/g)].map(match => match[1]));
  carriage ||= only([...text.matchAll(/(\d{1,2})\s*车(?:厢)?/g)].map(match => match[1]));
  seat ||= only([...text.matchAll(/(?:座位(?:号)?|座号|铺位)\s*:?\s*(\d{1,3}[A-F]|\d{1,3}号?\s*[上中下]铺?|\d{1,3}号)/gi)].map(match => match[1].replace(/\s|号/g, '').toUpperCase()));
  const classes = readRailSeatClasses(text);
  let passenger = labelled(text, '乘车人(?:姓名)?|旅客姓名|姓名').split(/身份证|中国居民|证件|成人票|儿童票|学生票|席别|座位|车厢|票价|\n/)[0].trim();
  if (!passenger) passenger = text.match(/(?:^|\n)\s*([\u3400-\u9fff·*＊]{2,12}?)(?=中国居民身份证|居民身份证|身份证|成人票|学生票|儿童票)/)?.[1] || '';
  if (!/^[\u3400-\u9fffA-Za-z·.*＊ -]{2,50}$/.test(passenger)) passenger = '';
  const identity = labelled(text, '证件号码|证件号|身份证号|身份证').match(/[0-9*＊Xx]{8,18}/)?.[0] || text.match(/\b\d{4,6}[*＊]{3,12}\d{2,4}\b/)?.[0] || '';
  const fareText = text.split('\n').filter(line => !/合计|总计|订单金额|支付总额|实付总额|保险|酒店|手续费/.test(line)).join('\n');
  const ticketPrice = labelled(fareText, '票价|票面价').match(/(?:[¥￥]\s*)?(\d+(?:\.\d{1,2})?)/)?.[1];
  const amounts = [...fareText.matchAll(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/g)].map(match => match[1]);
  const ticketNumber = labelled(text, '电子客票号|客票号|票号').match(/[A-Z0-9-]{6,30}/i)?.[0] || '';
  return { passenger, identity, carriage, seat, seatClass: classes.length === 1 ? classes[0] : '', railStanding: /无\s*座|站票/.test(text), price: ticketPrice || only(amounts), ticketNumber, ticketMarks: marksFromText(text) };
}
function passengerBlocks(text) {
  const nameStarts = [...text.matchAll(/(?:^|\n)\s*(?:(?:乘车人(?:姓名)?|旅客姓名|姓名)\s*:?|[\u3400-\u9fff·*＊]{2,12}?(?=中国居民身份证|居民身份证|身份证|成人票|学生票|儿童票))/g)];
  if (nameStarts.length > 1) return nameStarts.map((match, i) => text.slice(match.index, nameStarts[i + 1]?.index));
  const paid = text.split(/\n[^\n]*(?:已支付|未支付|已完成|已退票|已改签)[^\n]*(?:\n|$)/).filter(block => readRailSeatClasses(block).length || /\d\s*车|乘车人|旅客姓名|无座/.test(block));
  return paid.length > 1 ? paid : [text];
}
// Returns null for other documents so that the existing paper-ticket and flight parsers still apply.
export function parseRailOrder(raw, sourceKind = 'scan', label = '12306截图', { layout = '' } = {}) {
  if (!isRailOrderText(raw)) return null;
  const text = normal(raw).split(/\n\s*(?:预订酒店|更多服务|温馨提示|推荐酒店|猜你喜欢|广告)/)[0];
  const service = railOrderService(text);
  if (!service) return null;
  const lines = text.split('\n').filter(line => line.trim());
  const serviceIndex = lines.findIndex(line => [...line.matchAll(trainPattern)].some(match => trainCode(match[1]) === service) || new RegExp(`车次\\s*:?\\s*${service}(?![A-Z0-9])`, 'i').test(line));
  const routeArea = lines.slice(Math.max(0, serviceIndex - 2), serviceIndex + 4).filter(line => !/下单|订单[号编]|订票|购票时间|支付时间|出票时间|订单时间|创建时间|证件|乘车人|姓名|\d\s*车/.test(line)).join('\n');
  let origin = stationValue(text, '出发站|乘车站|发站|始发站'), destination = stationValue(text, '到达站|到站|终到站');
  const areas = railRouteAreas(layout, service);
  if (areas) { origin ||= only([...areas.origin.matchAll(stationPattern)].map(match => match[0])); destination ||= only([...areas.destination.matchAll(stationPattern)].map(match => match[0])); }
  if (!origin || !destination) {
    const stations = [...routeArea.matchAll(stationPattern)].map(match => match[0]);
    const names = unique(stations);
    if (names.length === 2) { origin ||= destination ? names.find(name => name !== destination) : names[0]; destination ||= names.find(name => name !== origin); }
  }
  const explicitDate = dates(labelled(text, '乘车日期|乘车时间|出发日期|出发时间|发车日期|发车时间|开车日期|开车时间'));
  const departureDate = only(explicitDate) || only(dates(routeArea));
  let departureTime = only(times(labelled(text, '开车时间|发车时间|出发时间'))), arrivalTime = only(times(labelled(text, '到达时间|抵达时间')));
  const visualTimes = railTimeWords(layout, service).map(word => times(word.text)[0]).filter(Boolean);
  const pair = visualTimes.length === 2 ? visualTimes : times(routeArea);
  if (pair.length === 2) { departureTime ||= pair[0]; arrivalTime ||= pair[1]; }
  const duration = routeArea.match(/(?:历时|运行时间|全程)\s*:?\s*(?:(\d+)天)?\s*(?:(\d+)(?:小时|时|h))?\s*(?:(\d+)(?:分钟|分|m))?/);
  let arrivalDate = only(dates(labelled(text, '到达日期|到达时间|抵达时间')));
  if (duration && departureTime && arrivalTime) {
    const minutes = (+duration[1] || 0) * 1440 + (+duration[2] || 0) * 60 + (+duration[3] || 0), toMinutes = time => +time.slice(0, 2) * 60 + +time.slice(3);
    if (minutes > 0) {
      if ((toMinutes(departureTime) + minutes) % 1440 !== toMinutes(arrivalTime)) arrivalTime = '';
      else if (!arrivalDate && departureDate) { const date = new Date(departureDate + 'T00:00:00Z'); date.setUTCDate(date.getUTCDate() + Math.floor((toMinutes(departureTime) + minutes) / 1440)); arrivalDate = date.toISOString().slice(0, 10); }
    }
  }
  const gate = labelled(text, '检票口').match(/^[\u3400-\u9fffA-Za-z0-9、或\-/]{1,30}/)?.[0] || '';
  const orderNumber = only([...text.matchAll(/(?:电子订单号|订单编号|订单号)\s*:?\s*([A-Z0-9]{6,30})/gi)].map(match => match[1].toUpperCase()));
  const shared = { type: 'rail', template: railTemplateFromText(text), service, origin, destination, departureDate, departureTime, arrivalDate, arrivalTime, gate, orderNumber, sources: [{ kind: sourceKind, label, at: now() }], provenance: sourceKind === 'scan' ? 'reconstruction' : 'commemorative' };
  return passengerBlocks(text).map(block => createRecord({ ...shared, ...passengerFields(block) }));
}
