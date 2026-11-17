import {JOURNEY_DATE_FIELDS} from './journey-date.js';
import { createRecord, now, validDate, DEFAULT_RAIL_TEMPLATE } from './model.js';
import { railTemplateFromText } from './rail-template.js';
import { marksFromText } from './ticket-marks.js';
import { parseRailOrder } from './rail-order.js';
import { parseFlightScreenshot } from './flight-screenshot.js';
import { flightStatusFromText } from './flight-status.js';
import { aircraftMentions, extractAircraft } from './aircraft.js';
import {labelledFlightTimes} from './flight-times.js';

export function decodeMail(raw) {
  const split = raw.search(/\r?\n\r?\n/);
  if (split === -1) return htmlText(raw);
  const header = raw.slice(0, split);
  const body = raw.slice(split).trim();
  const boundary = header.match(/boundary\s*=\s*"?([^"\s;]+)/i)?.[1];
  if (boundary) {
    const parts = body.split('--' + boundary).slice(1).filter(p => !/^--/.test(p.trim()));
    const preferred = parts.filter(p => /Content-Type:\s*text\/plain/i.test(p));
    return (preferred.length ? preferred : parts.filter(p => /Content-Type:\s*(text\/html|multipart\/)/i.test(p))).map(decodeMail).join('\n');
  }
  let decoded = body;
  if (/Content-Transfer-Encoding:\s*base64/i.test(header)) {
    try { decoded = new TextDecoder(/charset\s*=\s*"?(gbk|gb2312|gb18030)/i.test(header) ? 'gb18030' : 'utf-8').decode(Uint8Array.from(atob(body.replace(/\s/g, '')), c => c.charCodeAt(0))); } catch { throw new Error('邮件内容无法解码，请复制正文导入'); }
  } else if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(header)) {
    const text = body.replace(/=\r?\n/g, '');
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '=' && /^[A-Fa-f0-9]{2}$/.test(text.slice(i + 1, i + 3))) { bytes.push(parseInt(text.slice(i + 1, i + 3), 16)); i += 2; }
      else bytes.push(...new TextEncoder().encode(text[i]));
    }
    decoded = new TextDecoder(/charset\s*=\s*"?(gbk|gb2312|gb18030)/i.test(header) ? 'gb18030' : 'utf-8').decode(new Uint8Array(bytes));
  }
  return htmlText(decoded);
}
export function htmlText(value) {
  // Never insert imported HTML into the DOM or load external email resources.
  return value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<(br|\/p|\/div|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ');
}
const capture = (text, re) => text.match(re)?.[1]?.trim() || '';
function parseOne(text, sourceKind, label) {
  const planes = aircraftMentions(text);
  const flight = [...text.matchAll(/(?<![A-Z0-9])([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,5})(?![A-Z0-9-])/gi)].find(match =>
    !planes.some(plane => match.index < plane.end && match.index + match[0].length > plane.index) || /(?:航班(?:号|编号)?|FLIGHT(?:\s*NO\.?)?|航空)\s*[:：#]?\s*$/i.test(text.slice(0, match.index)));
  const train = text.match(/(?<![A-Z0-9])([GDCZTKYL]\d{1,5})(?!\d)/i);
  const flightStatus = flightStatusFromText(text);
  const type = train && !/(航班|机场|航空|FLIGHT)/i.test(text) ? 'rail' : flight || flightStatus ? 'flight' : 'rail';
  const service = type === 'flight' ? flight ? (flight[1] + flight[2]).toUpperCase() : '' : train?.[1]?.toUpperCase() || capture(text, /(?:车次|列车)\s*[:：]?\s*(\d{1,5})/);
  const flightTimes = type === 'flight' ? labelledFlightTimes(text) : {};
  const schedule = type === 'flight' ? text.split(/\r?\n/).filter(line=>!/实际|预计|登机时间|ACTUAL|ESTIMATED|BOARDING\s+TIME|\bATD\b|\bATA\b|\bETD\b|\bETA\b/i.test(line)).join('\n') : text;
  const date = schedule.match(/((?:19|20)\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})日?/);
  const departureDate = flightTimes.departureDate || (date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : '');
  const departureTime = flightTimes.departureTime || capture(schedule, /(?:开车|出发时间|起飞时间|发车时间|时间|出发)\s*[:：]?\s*(\d{1,2}:\d{2})/) || capture(schedule, /(\d{2}:\d{2})/);
  let origin = capture(text, /(?:出发站|发站|始发站|出发机场|出发地|出发|FROM)\s*[:：]\s*([^\s,，;；\n→—]+)/i);
  let destination = capture(text, /(?:到达站|到站|终到站|到达机场|目的地|到达|TO)\s*[:：]\s*([^\s,，;；\n→—]+)/i);
  const route = text.match(/([\u3400-\u9fffA-Z]{2,20})\s*(?:→|->|—|至|到)\s*([\u3400-\u9fffA-Z]{2,20})/i);
  if (route) { origin ||= route[1]; destination ||= route[2]; }
  if (service && (!origin || !destination)) {
    const routeRow = text.match(new RegExp('([\\u3400-\\u9fff]{2,12})站?\\s*' + service + '\\s*([\\u3400-\\u9fff]{2,12})站?'));
    if (routeRow) { origin ||= routeRow[1]; destination ||= routeRow[2]; }
  }
  const passenger = capture(text, /(?:乘车人|乘机人|旅客|姓名|PASSENGER)\s*[:：]\s*([^,，;；\n]{1,50})/i);
  const carriage = capture(text, /(\d{1,2})\s*车(?:厢)?/);
  const seatMatch = text.match(/(?:座位|座号|SEAT)\s*[:：]?\s*([\dA-Z\-]{1,8})(?:\s*号)?(?:\s*([上中下])\s*铺)?/i) || text.match(/\d{1,2}\s*车(?:厢)?\s*([\dA-Z\-]{1,8})(?:\s*号)?(?:\s*([上中下])\s*铺)?/i);
  const seat = seatMatch ? seatMatch[1] + (seatMatch[2] ? '号' + seatMatch[2] + '铺' : '') : '';
  const cabinCode = type === 'flight' ? capture(text, /(?:舱位(?:代码)?|(?:BOOKING\s+)?CLASS)\s*[:：]?\s*([A-Z]\d{0,2})(?:\s*舱)?(?![A-Z0-9])/i) || capture(text, /(?<![A-Z0-9])([A-Z]\d{0,2})\s*舱(?!位)/i) : '';
  const seatClass = cabinCode || capture(text, /(商务座|特等座|一等座|二等座|软卧|硬卧|软座|硬座|无座|超级经济舱|经济舱|公务舱|商务舱|头等舱)/);
  const gate = capture(text, /(?:检票(?:口)?|登机口|GATE)\s*[:：]?\s*([A-Z0-9][A-Z0-9/\-]{0,15})(?![A-Z0-9])/i);
  const price = capture(text, /(?:票价|价格|金额|CNY|RMB|￥|¥)\s*[:：]?\s*(\d+(?:\.\d{1,2})?)/i);
  const aircraftField = capture(text, /(?:机型|飞机型号|AIRCRAFT(?:\s+TYPE)?|EQUIPMENT)\s*[:：]\s*([^,，;；\n]{2,80})/i);
  const aircraft = type === 'flight' ? aircraftField ? extractAircraft('机型: ' + aircraftField) || aircraftField : extractAircraft(text) : '';
  if (!service && !departureDate && !origin && !destination) return null;
  const record = createRecord({ type, template: type === 'flight' ? 'air-boarding-pass' : railTemplateFromText(text), service, origin, destination, originCode: type === 'flight' && /^[A-Z]{3}$/.test(origin) ? origin : '', destinationCode: type === 'flight' && /^[A-Z]{3}$/.test(destination) ? destination : '', departureDate: validDate(departureDate) ? departureDate : '', departureTime: departureTime ? departureTime.padStart(5, '0') : '', ...flightTimes, passenger, carriage, seat, seatClass, price, gate, flightStatus, ticketMarks: type === 'rail' ? marksFromText(text) : [], orderNumber: capture(text, /(?:电子订单号|订单编号|订单号)\s*[:：]?\s*([A-Z0-9]{6,30})/i).toUpperCase(), ticketNumber: capture(text, /(?:电子客票号|客票号|票号|TICKET)\s*[:：]?\s*([A-Z0-9-]{6,30})/i), aircraft, aircraftRegistration: capture(text, /(?:飞机编号|机身编号|注册号|机号|REGISTRATION)\s*[:：]?\s*([A-Z][A-Z0-9-]{2,11})/i), railBureau: type === 'rail' ? capture(text, /(?:担当路局|担当局)\s*[:：]\s*([^\s,，;；\n]+)/) : '', railModel: type === 'rail' ? capture(text, /(?:列车车型|车型)\s*[:：]\s*([^\s,，;；\n]+)/) : '', pnr: capture(text, /(?:订座编号|PNR)\s*[:：]\s*([A-Z0-9]{5,8})/i), sources: [{ kind: sourceKind, label, at: now() }], provenance: sourceKind === 'scan' ? 'reconstruction' : 'commemorative' });
  return record;
}
export function parseSingleTicket(text, sourceKind = 'text', label = '文字导入') { const order = parseRailOrder(text, sourceKind, label) || parseFlightScreenshot(text, sourceKind, label); return order ? order.length === 1 ? order[0] : null : parseOne(text, sourceKind, label); }
export function parseText(raw, sourceKind = 'text', label = '文字导入') {
  const order = parseRailOrder(raw, sourceKind, label) || parseFlightScreenshot(raw, sourceKind, label); if (order) return order;
  const text = raw.replace(/\r/g, '').replace(/：/g, '：');
  const chunks = text.split(/\n\s*\n|\n(?=\s*(?:旅程|行程)\s*\d+\s*[:：])/).filter(s => s.trim());
  const candidates = chunks.map(t => parseOne(t, sourceKind, label)).filter(Boolean);
  // A mail often splits one ticket into separate paragraphs: combine if only one service occurs.
  const planes = aircraftMentions(text);
  const services = [...text.matchAll(/(?<![A-Z0-9])(?:[GDCZTKYL]\d{1,5}|[A-Z]{2}\s?\d{2,5})(?!\d)/gi)].filter(match => !planes.some(plane => match.index < plane.end && match.index + match[0].length > plane.index));
  if (services.length <= 1) { const one = parseOne(text, sourceKind, label); return one ? [one] : []; }
  return candidates.filter(c => c.service);
}
export function mapFlightResult(payload) {
  // Intentionally conservative: only this documented intermediate shape is accepted.
  // Raw provider responses stay in the review screen until a provider mapping is verified.
  const items = Array.isArray(payload) ? payload : payload?.flights;
  if (!Array.isArray(items)) throw new Error('尚未识别接口返回结构，请使用导出文件或文本导入');
  return items.map(item => createRecord({ type: 'flight', template: 'air-boarding-pass', service: String(item.flightNumber || ''), origin: String(item.origin || ''), destination: String(item.destination || ''), originCity: String(item.originCity || ''), destinationCity: String(item.destinationCity || ''), originCode: String(item.originCode || ''), destinationCode: String(item.destinationCode || ''), departureDate: item.departureDate || '', departureTime: String(item.departureTime || ''), arrivalDate: item.arrivalDate || '', arrivalTime: String(item.arrivalTime || ''), actualDepartureDate: item.actualDepartureDate || '', actualDepartureTime: String(item.actualDepartureTime || ''), actualArrivalDate: item.actualArrivalDate || '', actualArrivalTime: String(item.actualArrivalTime || ''), flightDistance: String(item.flightDistance || ''), departureZone: String(item.departureZone || ''), arrivalZone: String(item.arrivalZone || ''), passenger: String(item.passenger || ''), seat: String(item.seat || ''), airline: String(item.airline || ''), flightStatus: String(item.flightStatus || ''), aircraft: String(item.aircraft || ''), aircraftRegistration: String(item.aircraftRegistration || ''), sources: [{ kind: 'flight-json', label: '航空JSON导入', at: now() }] }));
}
export function parseCSV(text) {
  const rows = []; let row = [], value = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(value); value = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && input[i + 1] === '\n') i++; row.push(value); if (row.some(Boolean)) rows.push(row); row = []; value = ''; }
    else value += c;
  }
  if (quoted) throw new Error('CSV引号不完整');
  row.push(value); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error('CSV没有可导入的数据');
  const alias = { 交通方式: 'type', 出发站: 'origin', 出发机场: 'origin', 到达站: 'destination', 出发城市: 'originCity', 到达城市: 'destinationCity', 到达机场: 'destination', 车次: 'service', 航班号: 'service', 日期: 'departureDate', 出发日期: 'departureDate', 出发时间: 'departureTime', 计划起飞日期: 'departureDate', 计划起飞时间: 'departureTime', 计划到达日期: 'arrivalDate', 计划到达时间: 'arrivalTime', 实际起飞日期: 'actualDepartureDate', 实际起飞时间: 'actualDepartureTime', 实际到达日期: 'actualArrivalDate', 实际到达时间: 'actualArrivalTime', 航程距离: 'flightDistance', '航程距离（km）': 'flightDistance', 姓名: 'passenger', 旅客: 'passenger', 座位: 'seat', 车厢: 'carriage', 票价: 'price', 席别: 'seatClass', 舱位: 'seatClass', 身份证号: 'identity', 证件号: 'identity', 检票口: 'gate', 登机口: 'gate', 机票状态: 'flightStatus', 票据状态: 'flightStatus', 机型: 'aircraft', 担当客运段:'railRunner', 客运担当单位:'railRunner', 车辆归属单位:'railCarOwner', 担当路局: 'railBureau', 担当局: 'railBureau', 车型: 'railModel', 列车车型: 'railModel', 飞机编号: 'aircraftRegistration', 注册号: 'aircraftRegistration', 票面标识: 'ticketMarks', 票面样式: 'template', 模板: 'template' };
  const headers = rows.shift().map(h => alias[h.trim()] || h.trim());
  const ownExport = headers[0] === 'id' && headers[1] === 'mergedIds' && headers.includes('boardingCode');
  return rows.filter(row => row.some(Boolean)).map(row => {
    const values = Object.fromEntries(headers.map((h, i) => [h, row[i] || '']));
    if (ownExport) for (const key of headers) if (/^'[=+\-@\t\r]/.test(values[key])) values[key] = values[key].slice(1);
    if (values.mergedIds) { try { values.mergedIds = JSON.parse(values.mergedIds); } catch { throw new Error('合并记录ID格式不正确'); } }
    for (const field of [...JOURNEY_DATE_FIELDS.filter(key=>values[key]?.startsWith('{')), 'ticketCode', 'boardingCode']) if (values[field]) { try { values[field] = JSON.parse(values[field]); } catch { throw new Error('条码重建数据格式不正确'); } }
    if (values.lookupValues) { try { values.lookupValues = JSON.parse(values.lookupValues); } catch { throw new Error('自动补全来源格式不正确'); } }
    if (values.fieldSources) { try { values.fieldSources = JSON.parse(values.fieldSources); } catch { throw new Error('字段来源格式不正确'); } }
    if (values.railRoute) { try { values.railRoute = JSON.parse(values.railRoute); } catch { throw new Error('铁路线路资料格式不正确'); } }
    if (values.railJourney) { try { values.railJourney = JSON.parse(values.railJourney); } catch { throw new Error('铁路行程资料格式不正确'); } }
    const type = ['flight', '机票', '飞机'].includes(values.type) || (!values.type && /^[A-Z]{2}\d+$/i.test(values.service)) ? 'flight' : 'rail';
    return createRecord({ ...values, type, template: values.template || (type === 'flight' ? 'air-boarding-pass' : DEFAULT_RAIL_TEMPLATE), sources: [{ kind: 'csv', label: 'CSV表格导入', at: now() }] });
  });
}
export async function extractPDF(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true, cMapUrl: new URL('./vendor/cmaps/', location.href).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/standard_fonts/', location.href).href }).promise;
  if (doc.numPages > 50) { await doc.destroy(); throw new Error('请按50页以内拆分PDF'); }
  let text = '';
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i); const content = await page.getTextContent();
      text += content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('') + '\n\n';
    }
  } finally { await doc.destroy(); }
  if (!text.trim()) throw new Error('这份PDF没有可提取的文字，请将票据页面保存为图片后扫描');
  return text;
}
