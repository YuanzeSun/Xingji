import {calendarDate} from './journey-date.js';
import { normalizeSeatClass } from './seat-classes.js';
import { normalizeAircraft } from './aircraft.js';
import { railwayStop } from './places.js';
import { boardingPresentation } from './boarding-language.js';
import { boardingBaggage } from './boarding-baggage.js';
import { maskRailIdentity } from './identity.js';
import { escape as esc } from './html.js';
// Coordinates follow the 12306 ticket specimens published on 2015-06-24.
// Each historical ticket stock has its own layout and dimensions.
import { renderMarks } from './ticket-marks.js';
import { isLinearTicketCode, renderTicketCode } from './ticket-code.js';
import { codeSize, renderCodeData } from './barcode-data.js';
import { uppercaseName } from './uppercase-input.js';
import { renderBoardingCode, boardingCodeSize } from './boarding-code.js';
import { airlineLogo } from './airline-logo.js';
import { isRefundReceipt } from './record-kind.js';
import { isInactiveFlight } from './flight-status.js';
import { isAnonymousRedTemplate, isOldRedTemplate, isRailReceiptTemplate } from './rail-template.js';
import { PINYIN_ADVANCES, PINYIN_TRACKING } from './data/rail-pinyin-metrics.js';
const text = (x, y, value, size = 30, family = 'TicketSong', attrs = '') => value ? `<text x="${x}" y="${y}" font-size="${size}" font-family="${family},TicketRailFallback,TicketSong,serif" ${attrs}>${esc(value)}</text>` : '';
const railBody = r => isRailReceiptTemplate(r.template) ? 'TicketFang' : 'TicketSong';
const softPaper = Object.freeze({ width: 900, height: 600 });
const dim = Object.freeze({
  'rail-red-barcode': softPaper,
  'rail-red-qr': softPaper,
  'rail-red-classic': softPaper,
  'rail-red': softPaper,
  'rail-supplement': softPaper,
  'rail-blue': Object.freeze({ width: 856, height: 540 }),
  'rail-receipt': Object.freeze({ width: 856, height: 540 }),
  'rail-refund-receipt': Object.freeze({ width: 856, height: 540 }),
  'air-boarding-pass': Object.freeze({ width: 1230, height: 500 })
});
const baggageOverhang = 171;
const boardingPassWithSticker = Object.freeze({ width: dim['air-boarding-pass'].width, height: dim['air-boarding-pass'].height + baggageOverhang });
export function layoutDimensions(template, record) {
  return template === 'air-boarding-pass' && record && boardingBaggage(record) ? boardingPassWithSticker : dim[template];
}

function paperPattern(id, red) {
  // Fine continuous guilloche for the ticket stock background.
  const paths = [];
  for (let k = -24; k < 108; k += 3) {
    let d = '';
    for (let y = -4; y <= 68; y += 2) {
      const x = k + y * .65 + Math.sin(y * .35 + k * .075) * 1.5;
      d += `${y === -4 ? 'M' : 'L'}${x.toFixed(2)} ${y}`;
    }
    paths.push(`<path d="${d}"/>`);
  }
  return `<pattern id="${id}" width="72" height="64" patternUnits="userSpaceOnUse"><g fill="none" stroke="${red ? '#c97983' : '#6eaec0'}" stroke-width="${red ? '.52' : '.35'}" opacity="${red ? '.54' : '.24'}">${paths.join('')}</g></pattern>`;
}
function station(name, x, y, width, { classic = false, thermal = false, red = false } = {}) {
  if (!name) return '';
  const main = name.replace(/站$/, '');
  const baseSize = classic ? 64 : red ? 62 : thermal ? 43 : 52;
  const family = 'TicketRailHei';
  const chars = [...main];
  const suffix = classic ? /站$/.test(name) : true;
  const mainWidth = width - (suffix ? 39 : 0);
  const size = Math.min(baseSize, mainWidth / chars.length);
  let result;
  if (chars.length <= 3) {
    const step = chars.length === 1 ? 0 : (mainWidth - size) / (chars.length - 1);
    result = chars.map((c, i) => text(x + i * step, y, c, size, family, 'stroke="#172226" stroke-width=".32" paint-order="stroke"')).join('');
  } else result = text(x, y, main, size, family);
  if (suffix) result += text(x + width - 35, y - 1, '站', Math.min(34, size * .75), family);
  return result;
}
function pinyin(value, center, y, width = 270, preferredSize = 38) {
  if (!value) return '';
  const chars = [...value];
  const units = chars.reduce((sum, char) => sum + (PINYIN_ADVANCES[char] ?? .4), 0) + (chars.length - 1) * PINYIN_TRACKING;
  const size = Math.min(preferredSize, width / Math.max(1, units));
  return text(center, y, value, size, 'TicketRailPinyin', `text-anchor="middle" letter-spacing="${size * PINYIN_TRACKING}" font-kerning="none" stroke="none" data-rail-pinyin="true"`);
}

const textUnits = value => [...value].reduce((total, char) => total + (/\p{M}/u.test(char) ? 0 : /[\p{Script=Latin}\x00-\x7f]/u.test(char) ? .65 : 1), 0);
function wrapText(value, maxUnits) {
  const lines = []; let line = '';
  for (const word of value.trim().split(/\s+/)) {
    if (line && textUnits(line + ' ' + word) > maxUnits) { lines.push(line); line = ''; }
    for (const char of (line ? ' ' : '') + word) {
      if (line && textUnits(line + char) > maxUnits) { lines.push(line.trimEnd()); line = ''; }
      line += char;
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines;
}
function airportHeading(value, x, width, preferredSize, maxLines) {
  const oneLineSize = Math.min(preferredSize, width / Math.max(1, textUnits(value)));
  let size = oneLineSize, lines = [value];
  if (oneLineSize < preferredSize * .8) {
    size = maxLines === 2 ? 21 : 14;
    do { lines = wrapText(value, width / size); if (lines.length <= maxLines) break; size -= .5; } while (size > 6);
  }
  const multiline = lines.length > 1, stub = maxLines === 3;
  const y = multiline ? (stub ? 15 : 22) : (stub ? 29 : 30);
  const attrs = `data-airport-heading="${stub ? 'stub' : 'main'}" aria-label="${esc(value)}"`;
  const markup = lines.map((line, i) => text(x, y + i * (stub ? 16.5 : 23), line, size, 'TicketHei,TicketLatin,TicketArabic', stub ? 'text-anchor="middle"' : '')).join(' ');
  return { markup: `<g ${attrs}>${markup}</g>`, multiline };
}
function departure(r, x, y, scale = 1) {
  if (!r.departureDate && !r.departureTime) return '';
  const date = calendarDate(r.departureDate).match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  const parts = [];
  let cursor = 0;
  if (date) {
    for (const [index, label] of [...'年月日'].entries()) {
      const value = date[index + 1];
      if (!value) continue;
      if (index) cursor += 3;
      const digits = railNumerals(value, cursor, 0, 36);
      parts.push(digits.markup, text(cursor + digits.width + 1, 0, label, 28, 'TicketDateLabel', 'stroke="none"'));
      cursor += digits.width + 29;
    }
  }
  if (r.departureTime) {
    cursor += 8;
    const digits = railNumerals(r.departureTime, cursor, 0, 36);
    parts.push(digits.markup, text(cursor + digits.width, 0, '开', 28, 'TicketDateLabel', 'stroke="none"'));
  }
  return `<g data-rail-departure="true" transform="translate(${x} ${y}) scale(${scale})">${parts.join('')}</g>`;
}
function railNumerals(value, x, y, size) {
  let cursor = x;
  const parts = [];
  for (const run of String(value).match(/\d+|:|[^\d:]+/gu) || []) {
    const numeric = /^[\d:]+$/.test(run);
    parts.push(text(cursor, y, run, size, numeric ? 'TicketDateNumber' : 'TicketOCR', 'stroke="none"'));
    cursor += [...run].reduce((width, char) => width + (char === ':' ? .35 : numeric ? .63 : .62) * size, 0);
  }
  return { markup: parts.join(''), width: cursor - x };
}
function seats(r, x, y, size = 36) {
  if (!r.carriage && !r.seat && !r.railStanding) return '';
  const match = r.seat?.match(/^([\dA-Za-z]+)(.*)$/);
  const number = match ? match[1] : r.seat || '';
  const ending = match?.[2] || (r.seat ? '号' : '');
  const parts = [];
  let cursor = x;
  if (r.carriage) {
    const digits = railNumerals(r.carriage, cursor, y, size);
    parts.push(digits.markup, text(cursor + digits.width, y, '车', size * .75, railBody(r)));
    cursor += digits.width + size * .75;
  }
  if (r.railStanding) parts.push(text(cursor + 3, y, '无座', size * .85, railBody(r)));
  else {
    const seat = railNumerals(number, cursor + 3, y, size);
    parts.push(seat.markup, text(cursor + 3 + seat.width, y, ending, size * .75, railBody(r)));
  }
  return `<g data-rail-seat="true">${parts.join('')}</g>`;
}
function fare(r, x, y, numberFamily = 'TicketOCR') {
  if (!r.price) return '';
  const classic = isOldRedTemplate(r.template);
  const scale = classic ? 1.35 : 1;
  const numberSize = classic ? 56 : isRailReceiptTemplate(r.template) ? 35 : 40;
  const symbol = `<path d="m3 -31 10 13 10-13m-10 13v19m-11-17h22m-22 7h22" transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#172226" stroke-width="1.8"/>`;
  const numberX = x + 32 * scale;
  // These numeral faces have fixed digit advances; the decimal has a half cell.
  // Keep the CJK unit in a separate text run so an SVG renderer cannot replace
  // the Latin face while resolving the mixed-script line.
  const numberWidth = [...String(r.price)].reduce((width, char) => width + (classic ? (char === '.' ? .25 : .5) : (char === '.' ? .28 : .62)) * numberSize, 0);
  return symbol + text(numberX, y, r.price, numberSize, numberFamily, 'stroke="none"') + text(numberX + numberWidth + 2, y, '元', classic ? 38 : 27, railBody(r));
}
function arrow(x, y, width = 147) {
  return `<path d="M${x} ${y}h${width}" fill="none" stroke="#172226" stroke-width="1.8"/><path d="m${x + width - 18} ${y - 6} 18 6-24 1z" fill="#172226"/>`;
}
function trainService(value, x, y, size, classic = false) {
  if (!value) return '';
  if (!classic) return text(x, y, value, size, 'TicketRailSerif', 'text-anchor="middle" stroke-width=".2"');
  const prefixes = { T: .611, K: .722, Z: .611, C: .667, D: .722, G: .722, S: .556, Y: .722, L: .611 };
  const width = [...value].reduce((total, char) => total + (/\d/.test(char) ? .5 : prefixes[char] || .667) * size, 0);
  const start = x - (width + 39) / 2;
  return text(start, y, value, size, 'TicketRailSerif', 'stroke-width=".2"') + text(start + width + 4, y, '次', 35, 'TicketSong');
}
function passenger(r, x, y, nameX) {
  const identity = maskRailIdentity(r.identity);
  const identitySize = Math.min(30, (nameX - x - 16) / Math.max(1, [...identity].length * .62));
  return text(x, y, identity, identitySize, 'TicketOCR', 'letter-spacing="0"') + text(nameX, y, r.passenger, 35, railBody(r));
}
function notice(x, y, width, receipt = false) {
  const family = receipt ? 'TicketFang' : 'TicketSong';
  return `<rect x="${x}" y="${y}" width="${width}" height="75" fill="none" stroke="#263332" stroke-width="1.2" stroke-dasharray="9 5"/>${text(x + width / 2, y + 29, receipt ? '报销凭证 遗失不补' : '买票请到12306 发货请到95306', 25, family, 'text-anchor="middle"')}${text(x + width / 2, y + 62, receipt ? '退票改签时须交回车站' : '中国铁路祝您旅途愉快', 28, family, 'text-anchor="middle"')}`;
}
function trainWatermark() {
  return `<g transform="translate(118 180)" opacity=".065" fill="#3c9db9" stroke="#3c9db9"><path d="M15 142Q42 43 128 11l56-7 83 29 424 131-8 18-459-72-39 43Q80 185 15 142z" stroke-width="2"/><path d="M34 112Q64 48 130 27l52-4 55 23-62 40-99 30z" fill="#f2f7f4" stroke-width="3"/><path d="m225 58 25 8-2 43-26-4zm43 13 22 7-1 38-22-3zm39 12 21 6v34l-22-3zm38 11 19 6v28l-20-3zm36 11 19 5v25l-20-3zm35 10 18 6v21l-18-3zm33 10 16 5v17l-16-2zm31 9 14 4v15l-14-2zm28 9 13 3v13l-13-2zm26 8 12 4v11l-12-2z" fill="#f2f7f4" stroke="none"/><path d="M19 143q82 25 166-4l35-28 464 70" fill="none" stroke-width="4"/><text x="239" y="142" font-family="TicketLatin" font-size="22" stroke="none" transform="rotate(13 239 142)">CRH</text></g>`;
}
function blue(r) {
  const thermal = isRailReceiptTemplate(r.template);
  const body = railBody(r);
  const origin = railwayStop(r, 'origin'), destination = railwayStop(r, 'destination');
  const pattern = `fine-${esc(r.id)}`;
  const issuer = r.issuer && (!thermal || r.railShowIssuer === true) ? r.issuer.replace(/站$/, '') + '站售' : '';
  const printed = `<g fill="#172226" stroke="#172226" stroke-width="${thermal ? '.5' : '.65'}" paint-order="stroke">
    ${text(48, 57, r.ticketNumber, 44, 'TicketOCR', 'fill="#c45766" letter-spacing="2" stroke="none"')}
    ${text(803, 52, r.gate ? `检票:${r.gate}` : '', 29, body, 'text-anchor="end"')}
    ${station(origin.name, 83, 128, 222, { thermal })}${station(destination.name, 551, 128, 227, { thermal })}
    ${pinyin(origin.pinyin, 192, 166)}${pinyin(destination.pinyin, 667, 166)}
    ${trainService(r.service, 433, 126, thermal ? 47 : 54)}${arrow(357, 145)}
    ${departure(r, 57, 213, thermal ? .92 : 1)}${seats(r, 546, 213, thermal ? 33.12 : 36)}
    ${fare(r, 59, 261)}${text(619, 254, r.seatClass, 34, body)}
    ${renderMarks(r, { x: 399, y: 244, radius: thermal ? 14 : 16 })}
    ${thermal ? (isRefundReceipt(r) ? text(59, 301, '退票费', 33, body, 'stroke-width=".2"') : '') : text(59, 301, '限乘当日当次车', 35, 'TicketRailHei', 'stroke-width=".2"')}
    ${thermal ? text(60, 352, '仅供报销使用', 29, body) : ''}
    ${passenger(r, 57, 390, 433)}${renderTicketCode(r, 669, 335, 141)}
    ${notice(99, 404, 497, thermal)}
    ${text(59, 519, r.saleCode, thermal ? 25 : 40, thermal ? 'TicketOCR' : 'TicketRailNarrow', 'letter-spacing=".5" stroke="none"')}${text(450, 519, issuer, 31, body)}
  </g>`;
  return `<defs>${paperPattern(pattern, false)}<clipPath id="cut-${esc(r.id)}"><rect width="856" height="540" rx="20"/></clipPath></defs><g clip-path="url(#cut-${esc(r.id)})"><rect width="856" height="540" fill="#c6e2e7"/><rect width="856" height="540" fill="url(#${pattern})"/>${trainWatermark()}<rect y="485" width="856" height="55" fill="#67b8d0"/><g fill="#91c5d1" font-family="TicketLatin" font-size="7">${Array.from({ length: 61 }, (_, i) => `<text x="${i * 14}" y="481">CR</text>`).join('')}</g>${printed}</g>`;
}
function red(r) {
  const classic = isOldRedTemplate(r.template);
  const linear = r.template === 'rail-red-barcode';
  const anonymous = isAnonymousRedTemplate(r.template);
  const origin = railwayStop(r, 'origin'), destination = railwayStop(r, 'destination');
  const pattern = `fine-${esc(r.id)}`;
  const oldIssuer = classic && r.issuer ? text(785, 79, r.issuer.replace(/[站售]+$/u, ''), 30, 'TicketRailHei', 'text-anchor="end"')
    + '<circle cx="811" cy="67" r="17" fill="none" stroke-width="2"/>' + text(811, 76, '售', 24, 'TicketRailHei', 'text-anchor="middle"') : '';
  const oldGate = r.gate ? text(660, 484, '检票口' + r.gate, 28, 'TicketSong', 'text-anchor="end"') : '';
  const barcode = { x: 44, y: 434, width: 811, height: 104 };
  let footerX = 57, footerWidth = linear ? 778 : classic ? 590 : 396;
  let footerSpacing = 'letter-spacing=".25"';
  if (linear && r.saleCode && isLinearTicketCode(r.ticketCode)) {
    const { width, quiet } = codeSize(r.ticketCode);
    const inset = barcode.width * quiet / width;
    footerX = barcode.x + inset;
    footerWidth = barcode.width - inset * 2;
    footerSpacing = `textLength="${footerWidth}" lengthAdjust="spacing"`;
  }
  const footer = text(footerX, 552, r.saleCode, Math.min(linear ? 29 : 37, footerWidth / Math.max(1, textUnits(r.saleCode || ''))), 'TicketRailNarrow', `${footerSpacing} stroke="none"`);
  const rider = classic
    ? text(56, 422, r.passenger, 33) + text(56, 473, maskRailIdentity(r.identity), 32, 'TicketOCR')
    : passenger(r, 56, 427, 440);
  return `<defs>${paperPattern(pattern, true)}</defs><rect width="900" height="600" fill="#f8f3e6"/><rect x="30" y="30" width="840" height="540" fill="#efd3ce"/><rect x="30" y="30" width="840" height="540" fill="url(#${pattern})"/>
  <g fill="#152022" stroke="#152022" stroke-width=".65" paint-order="stroke">
    ${text(59, 83, r.ticketNumber, 46, 'TicketOCR', 'fill="#b83c4d" letter-spacing="3" stroke="none"')}
    ${classic ? oldIssuer : text(822, 82, r.gate ? '检票口' + r.gate : '', 31, 'TicketSong', 'text-anchor="end"')}
    ${station(origin.name, 86, 153, 231, { classic, red: true })}${station(destination.name, 585, 153, 236, { classic, red: true })}
    ${pinyin(origin.pinyin, 197, 195, 270, classic ? 42 : 40)}${pinyin(destination.pinyin, 704, 195, 270, classic ? 42 : 40)}
    ${trainService(r.service, 455, 150, 54, classic)}${arrow(369, 173, 156)}
    ${departure(r, 55, 249)}${seats(r, 580, 249)}
    ${fare(r, 57, 304, classic ? 'TicketRailSerif' : 'TicketOCR')}${text(648, 306, r.seatClass, 35)}
    ${renderMarks(r, { x: 433, y: 289, radius: 17, gap: 48 })}
    ${text(59, 357, '限乘当日当次车', 35)}
    ${anonymous ? '' : rider}
    ${linear ? renderTicketCode(r, barcode.x, barcode.y, barcode.width, barcode.height) : renderTicketCode(r, 669, 374, 181)}
    ${classic ? (anonymous ? '' : oldGate) : notice(96, 445, 505)}
    ${footer}${!classic ? text(465, 552, r.issuer ? r.issuer.replace(/站$/, '') + '站售' : '', 31) : ''}
  </g>`;
}
function supplement(r) {
  const origin = railwayStop(r, 'origin'), destination = railwayStop(r, 'destination');
  const pattern = `fine-${esc(r.id)}`;
  const identity = maskRailIdentity(r.identity);
  const reason = r.railSupplementReason ? '事由:' + r.railSupplementReason : '';
  const charges = [
    r.railSupplementFee && '含手续费:' + r.railSupplementFee + '元',
    r.railSupplementSurcharge && '加收:' + r.railSupplementSurcharge + '元'
  ].filter(Boolean).join('　');
  const issuer = r.issuer && (r.issuer.endsWith('补') ? r.issuer : r.issuer + '补');
  return `<defs>${paperPattern(pattern, true)}</defs><rect width="900" height="600" fill="#f1eee2"/><rect x="34" y="26" width="834" height="548" fill="#e6d8cc"/><rect x="34" y="26" width="834" height="548" fill="url(#${pattern})" opacity=".55"/>
  <g fill="#242422" stroke="#242422" stroke-width=".25" paint-order="stroke">
    ${text(54, 85, r.ticketNumber, 48, 'TicketOCR', 'fill="#a74c4d" letter-spacing="4" stroke="none"')}
    ${station(origin.name, 121, 136, 218)}${station(destination.name, 617, 136, 223)}
    ${trainService(r.service, 455, 132, 50)}<path d="M360 145h190" fill="none" stroke-width="2"/>
    ${departure({ ...r, departureTime: '' }, 54, 204, .94)}${seats(r, 567, 204, 35)}
    ${fare(r, 55, 257)}${text(840, 261, r.seatClass, 30, 'TicketSong', 'text-anchor="end"')}
    ${renderMarks(r, { x: 436, y: 243, radius: 15 })}
    ${text(54, 313, '限乘当日当次车　中途下车失效', 31)}
    ${text(54, 365, identity, 36, 'TicketOCR')}${text(840, 365, reason, Math.min(30, 340 / Math.max(1, textUnits(reason))), 'TicketSong', 'text-anchor="end"')}
    ${text(54, 411, charges, Math.min(29, 630 / Math.max(1, textUnits(charges))), 'TicketSong')}
    ${text(54, 546, r.saleCode, Math.min(31, 356 / Math.max(1, textUnits(r.saleCode || ''))), 'TicketRailNarrow')}${text(425, 546, issuer, Math.min(31, 294 / Math.max(1, textUnits(issuer || ''))))}
    ${renderTicketCode(r, 724, 417, 132)}
  </g>`;
}
function boardingPenCircle(field, x, y, width, height, reverse = false) {
  const at = (u, v) => `${(x + width * (reverse ? 1 - u : u)).toFixed(1)} ${(y + height * v).toFixed(1)}`;
  const outline = `M${at(.79,.15)} C${at(.60,-.09)} ${at(.23,-.04)} ${at(.09,.20)} S${at(-.03,.78)} ${at(.16,.90)} C${at(.41,1.08)} ${at(.84,.98)} ${at(.96,.68)} S${at(.92,.12)} ${at(.71,.05)}`;
  return `<path data-boarding-pen="${field}" aria-hidden="true" d="${outline}" fill="none" stroke="#394b73" stroke-width="3" stroke-linecap="round" opacity=".79"/>`;
}

function baggageSticker(record, baggage, departureDate, presentation, mark) {
  const tags = baggage.baggageTagNumbers?.trim() || '';
  const barcodeTag = /\b\d{10}\b/.exec(tags)?.[0];
  const count = baggage.checkedBaggageCount?.trim().replace(/^0+(?=\d)/, '') || '';
  const weight = baggage.checkedBaggageWeight?.trim() || '';
  const to = baggage.to || record.destinationCode || presentation.destination;
  const via = baggage.via || '';
  const bag = count || weight ? `BAG: ${count && count.padStart(2, '0')}/${weight}` : '';
  const barcode = { x: 6, y: 153, width: 255, height: 29 };
  const code = barcodeTag && renderCodeData({
    version: 1, format: 'ITF', rawBytes: btoa(barcodeTag), symbologyIdentifier: ']I0',
    eci: [], gs1: false, parameters: {}
  }, { ...barcode, stretch: true, marker: 'baggage-tag-code' });
  const outline = 'M1 2H268V191L247 191L241 194L202 192L157 195L151 192L103 194L99 191L57 193L49 190L1 192Z';
  const number = barcodeTag || ([...tags].length > 36 ? [...tags].slice(0, 35).join('') + '…' : tags);
  const { carrierNames, passenger } = presentation;
  const carrier = carrierNames?.en?.toUpperCase() || record.airline || 'BAGGAGE CLAIM';
  const headerX = mark ? 55 : 14;
  const print = (x, y, value, width, size = 16, attrs = '') =>
    text(x, y, value, Math.min(size, width / Math.max(1, textUnits(value || ''))), 'TicketMono,TicketHei', attrs);
  const right = 'text-anchor="end"';
  return `<g data-boarding-baggage-sticker="true" transform="translate(570 8) rotate(177 135 98)" fill="#26282a">
    <title>${esc(['行李提取联', tags, count && `托运 ${count} 件`, weight && `总重 ${weight} kg`, to && `目的地 ${to}`, via && `经由 ${via}`].filter(Boolean).join(' · '))}</title>
    <path d="${outline}" transform="translate(-2 -3)" fill="#e2e4df" stroke="#bcc2bc"/>
    <path d="${outline}" fill="#f8f8f5" stroke="#cacdca"/>
    ${mark ? `<image data-baggage-airline-logo="true" x="13" y="8" width="33" height="32" preserveAspectRatio="xMidYMid meet" href="${mark.image}"/>` : ''}
    ${text(headerX, carrierNames?.zh ? 24 : 32, carrier, Math.min(24, (254 - headerX) / textUnits(carrier)), 'TicketLatin,TicketHei', 'font-weight="700"')}
    ${text(headerX, 40, carrierNames?.zh, 14, 'TicketHei')}
    ${print(14, 66, record.service, 127, 19)}
    ${print(254, 66, departureDate, 73, 17, right)}
    ${print(14, 83, passenger, 239, 14)}
    ${print(14, 104, `TO:${to ? ` ${to}` : ''}`, 129, 18)}
    ${print(254, 104, bag, 132, 16, right)}
    ${print(14, 123, `VIA:${via ? ` ${via}` : ''}`, 129, 16)}
    ${print(barcode.x + barcode.width / 2, 149, number, 237, 23, 'text-anchor="middle" font-weight="700" letter-spacing=".4"')}
    ${code || ''}
  </g>`;
}

function flight(r) {
  const presentation = boardingPresentation(r), words = presentation.words;
  const baggage = boardingBaggage(r);
  const inactive = isInactiveFlight(r), open = r.flightStatus === 'open';
  const statusLabel = presentation.language === 'zh' ? open ? 'OPEN / 未定航班' : 'VOID / 无效票' : open ? 'OPEN / UNDATED' : 'VOID / INVALID';
  const service = r.service || (open ? 'OPEN' : '');
  const label = (x, y, value) => text(x, y, value, 14, 'TicketHei', 'fill="#565c5c"');
  const printed = (x, y, value, size = 26, width = 320, family = 'TicketMono,TicketHei', attrs = '') => {
    const string = String(value || '—'), units = textUnits(string);
    return text(x, y, string, Math.min(size, width / Math.max(1, units)), family + ',TicketArabic', attrs);
  };
  const date = value => {
    value=calendarDate(value);
    const match = /^\d{4}(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value || '');
    if (!match?.[1]) return '';
    return `${match[2] || ''}${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][Number(match[1]) - 1]}`;
  };
  const departureAirport = presentation.airport;
  const logo = airlineLogo(r.airline), mark = logo?.icon;
  const headingX = mark ? 92 : 34;
  const mainHeading = airportHeading(departureAirport, headingX, 460, 25, 2);
  const headerAirline = printed(headingX, mainHeading.multiline ? 61 : 52, presentation.airline, mainHeading.multiline ? 9 : 12, 460, 'TicketHei,TicketLatin', 'fill="#415e6f"');
  const stubHeading = airportHeading(departureAirport, 1065, 275, 19, 3);
  const routeName = (value, x) => {
    const name = value || '—', units = textUnits(name);
    if (units * 16 <= 190) return { markup: printed(x, 293, name, 25, 190, 'TicketHei,TicketLatin'), width: Math.min(units * 25, 190), top: 264 };
    const lines = wrapText(name, 190 / 18);
    if (lines.length > 2) {
      const ending = [...lines.slice(1).join(' ')];
      while (textUnits(ending.join('') + '…') * 18 > 190) ending.pop();
      lines.splice(1, lines.length - 1, ending.join('') + '…');
    }
    return {
      markup: `<g aria-label="${esc(name)}">${lines.map((line, i) => text(x, 281 + i * 21, line, 18, 'TicketHei,TicketLatin,TicketArabic')).join(' ')}</g>`,
      width: Math.max(...lines.map(line => textUnits(line) * 18)), top: 251
    };
  };
  const originName = routeName(presentation.origin, 35), destinationName = routeName(presentation.destination, 265);
  const destinationWidth = Math.max(destinationName.width, textUnits(r.destinationCode || '') * 18);
  const destinationMark = presentation.destination || r.destinationCode
    ? boardingPenCircle('destination', 248, destinationName.top, Math.max(68, destinationWidth + 38), (r.destinationCode ? 332 : 307) - destinationName.top) : '';
  const departureMark = r.departureTime ? boardingPenCircle('departure', 695, 309, 131, 43, true) : '';
  const codeSize = r.boardingCode ? boardingCodeSize(r.boardingCode) : null;
  const portraitCode = codeSize && codeSize.height > codeSize.width * 1.5;
  const code = !codeSize ? '' : portraitCode
    ? `<g data-boarding-code-position="horizontal" transform="translate(35 432) rotate(-90)">${renderBoardingCode(r, 0, 0, 82, 394)}</g>`
    : `<g data-boarding-code-position="horizontal">${renderBoardingCode(r, 35, 350, 394, 82)}</g>`;
  return `<g data-boarding-language="${presentation.language}" lang="${presentation.language === 'zh' ? 'zh-CN' : 'en'}"><g${baggage ? ` transform="translate(0 ${baggageOverhang})"` : ''}><rect width="1230" height="500" rx="3" fill="#fffdf6"/>
  <path data-boarding-header-paper="true" d="M3 0h1224q3 0 3 3v61H0V3q0-3 3-3" fill="#e4f0f7"/>
  <path d="M0 64h1230" stroke="#cbdde6"/>
  ${mark ? `<metadata>Airline mark: ${esc(mark.source || 'Soaring Symbols 0.4.1 (https://github.com/soaring-symbols/soaring-symbols)')}. Marks belong to their respective airlines.</metadata><svg data-airline-watermark="${logo.code}" x="0" y="65" width="1230" height="435" overflow="hidden" aria-hidden="true"><image x="475" y="-150" width="748" height="730" preserveAspectRatio="xMidYMid meet" opacity=".12" href="${mark.image}"/></svg>` : ''}
  <path d="M900 66v426" stroke="#a2a49b" stroke-dasharray="3 5" stroke-width="1"/>
  <g fill="#203b49" data-boarding-header="true">
    ${mark ? `<g data-airline-logo="${logo.code}" role="img" aria-label="${esc(logo.name)} 标志"><title>${esc(logo.name)}</title><image x="32" y="11" width="42" height="42" preserveAspectRatio="xMidYMid meet" href="${mark.image}"/></g>` : ''}
    ${mainHeading.markup}${headerAirline}${text(869, 42, words.title, 20, 'TicketHei', 'text-anchor="end"')}${stubHeading.markup}${text(1065, stubHeading.multiline ? 61 : 49, words.title, stubHeading.multiline ? 9 : 12, 'TicketHei', 'text-anchor="middle"')}</g>
  <g fill="#1a2022">
    <g data-boarding-section="main">
      ${label(35, 100, words.name)}${printed(35, 135, presentation.passenger, 28, 410)}
      ${label(35, 181, words.flight)}${printed(35, 215, service, 29, 165)}
      ${label(233, 181, words.date)}${printed(233, 215, date(r.departureDate) || (open ? 'OPEN' : ''), 25, 212)}
      ${label(35, 260, words.from)}${label(265, 260, words.to)}
      ${originName.markup}${destinationName.markup}
      ${printed(35, 321, r.originCode, 18, 190)}${printed(265, 321, r.destinationCode, 18, 183)}
      <g data-route-plane="right" transform="translate(238 285) scale(.24)"><path d="M30 0C30-2 26-3 20-3H6L-10-23H-17L-9-3H-22L-29-10H-34L-29 0L-34 10H-29L-22 3H-9L-17 23H-10L6 3H20C26 3 30 2 30 0Z" fill="#4a5557"/></g>
      ${label(510, 100, words.gate)}${printed(510, 147, r.gate, 39, 155)}
      ${label(710, 100, words.seat)}${printed(710, 150, r.seat, 47, 155)}
      ${label(510, 202, words.boarding)}${printed(510, 244, r.boardingTime, 35, 170)}
      ${label(710, 202, words.cabin)}${printed(710, 242, normalizeSeatClass(r.seatClass, 'flight').replace(/舱$/, ''), 28, 155, 'TicketMono,TicketHei')}
      ${label(510, 300, words.terminal)}${printed(510, 339, r.terminal, 29, 170)}
      ${label(710, 300, words.departure)}${printed(710, 339, r.departureTime, 31, 155)}
      ${code}
      ${r.aircraft || r.aircraftRegistration ? `<g data-boarding-aircraft="true">${r.aircraft ? label(510, 383, words.aircraft) + printed(610, 383, r.aircraft, 18, 255) : ''}${r.aircraftRegistration ? label(510, r.aircraft ? 416 : 383, words.registration) + printed(610, r.aircraft ? 416 : 383, r.aircraftRegistration, 20, 255) : ''}</g>` : ''}
      ${inactive ? `<g data-flight-status="${r.flightStatus}" aria-label="${statusLabel}" fill="#a04039"><rect x="510" y="429" width="355" height="29" rx="2" fill="none" stroke="#a04039" stroke-width="1.5"/>${text(687, 450, statusLabel, 21, 'TicketMono,TicketHei', 'text-anchor="middle"')}</g>` : ''}
      ${r.ticketNumber ? printed(35, 475, words.ticket + ' ' + r.ticketNumber, 17, 410) : ''}
      ${r.pnr ? printed(510, 475, words.pnr + ' ' + r.pnr, 17, 355) : ''}
      ${destinationMark}${departureMark}
    </g>
    <g data-boarding-section="stub">
      ${label(930, 100, words.name)}${printed(930, 133, presentation.passenger, 22, 270)}
      ${label(930, 181, words.flight)}${label(1084, 181, words.date)}${printed(930, 215, service, 26, 140)}${printed(1084, 215, date(r.departureDate) || (open ? 'OPEN' : ''), 21, 120)}
      ${label(930, 264, words.route)}${printed(930, 297, [r.originCode, r.destinationCode].filter(Boolean).join(' - ') || [presentation.origin, presentation.destination].filter(Boolean).join(' - '), 27, 270)}
      ${inactive ? `<g data-flight-status="${r.flightStatus}" aria-label="${statusLabel}" fill="#a04039"><rect x="930" y="310" width="270" height="25" rx="2" fill="none" stroke="#a04039" stroke-width="1.5"/>${text(1065, 328, statusLabel, 18, 'TicketMono,TicketHei', 'text-anchor="middle"')}</g>` : ''}
      ${label(930, 351, words.gate)}${label(1084, 351, words.seat)}${printed(930, 398, r.gate, 35, 125)}${printed(1084, 401, r.seat, 43, 120)}
      ${label(930, 444, words.boarding)}${label(1084, 444, words.terminal)}${printed(930, 477, r.boardingTime, 26, 140)}${printed(1084, 477, r.terminal, 25, 120)}
    </g>
  </g></g>${baggage ? baggageSticker(r, baggage, date(r.departureDate), presentation, mark) : ''}</g>`;
}

export function renderTicket(record) {
  if (!dim[record.template]) throw new Error('Unsupported ticket layout');
  if (record.template === 'air-boarding-pass') {
    return flight({ ...record, passenger: uppercaseName(record.passenger), aircraft: normalizeAircraft(record.aircraft) });
  }
  if (record.template.startsWith('rail-red')) return red(record);
  if (record.template === 'rail-supplement') return supplement(record);
  return blue(record);
}
export function layoutFontFiles(template) {
  if (template === 'air-boarding-pass') return [['TicketHei', 'ticket-hei.woff2', '500'], ['TicketLatin', 'ticket-latin.woff2', '400'], ['TicketMono', 'ticket-mono.woff2', '400'], ['TicketArabic', 'ticket-arabic.woff2', '400']];
  const fonts = [
    ['TicketRailFallback', 'ticket-rail-fallback.woff2', '400'],
    ['TicketDateNumber', 'ticket-date-numbers.woff2', '400'],
    ['TicketDateLabel', 'ticket-date-labels.woff2', '400'],
    ['TicketOCR', 'ticket-ocr-v2.woff2', '400'],
    ['TicketSong', 'ticket-song.woff2', '400'],
    ['TicketRailHei', 'ticket-rail-hei.woff2', '400'],
    ['TicketRailSerif', 'ticket-rail-serif.woff2', '400'],
    ['TicketRailNarrow', 'ticket-rail-narrow.woff2', '400'],
    ['TicketRailPinyin', 'ticket-rail-pinyin.woff2', '400'],
    ['TicketLatin', 'ticket-latin.woff2', '400']
  ];
  if (isRailReceiptTemplate(template)) fonts.push(['TicketFang', 'ticket-fang.woff2', '400']);
  return fonts;
}
