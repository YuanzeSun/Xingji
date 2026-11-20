import {calendarDate} from './journey-date.js';
import { railTrainRectangle, railFareRectangle, parsePrintedRailTicket, railStationFromRegion, printedRailNumber, railSeatFromLine, railIssuerFromLine, railFareFromLine } from './rail-ticket.js';
import { printedRailTemplate } from './rail-template.js';
import { marksFromRailRegion } from './ticket-marks.js';

export async function refineRailFields(worker, image, data, paperColor) {
  const { width, height } = image;
  if (!height || width / height < 1.1 || width / height > 2.3) return {};
  const record = parsePrintedRailTicket(data.text, 'OCR', { layout: data.tsv, paperColor });
  if (record === false || (!record && !paperColor)) return {};
  const fields = {};
  const read = (x, y, w, h) => worker.recognize(image, { rectangle: {
    left: Math.floor(x * width), top: Math.floor(y * height),
    width: Math.floor(w * width), height: Math.floor(h * height)
  } }).then(result => result.data);
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '6' });
    for (const [side, x] of [['origin', .04], ['destination', .59]]) {
      if (record?.[side]) continue;
      const { text, confidence } = await read(x, .135, .37, .215);
      const station = confidence >= 38 && railStationFromRegion(text);
      if (station && station !== (fields.origin || record?.origin) &&
        station !== record?.destination) fields[side] = station;
    }
    if (record && !record.seat && !record.railStanding) {
      const { text, confidence } = await read(.52, .23, .46, .33);
      const rows = text.split('\n').map(railSeatFromLine).filter(seat => seat?.carriage && (seat.seat || seat.railStanding));
      if (confidence >= 58 && rows.length === 1 && (!record.carriage || record.carriage === rows[0].carriage)) {
        Object.assign(fields, rows[0]);
      }
    }
    if (record && !record.issuer) {
      const { text, confidence } = record.template === 'rail-red-classic'
        ? await read(.57, .01, .41, .16) : await read(.41, .84, .55, .15);
      const names = new Set(text.split('\n').map(railIssuerFromLine).filter(Boolean));
      if (confidence >= 58 && names.size === 1) fields.issuer = names.values().next().value;
    }
    if (!record?.ticketMarks?.length) {
      const { text } = await read(.37, .355, .26, .23);
      let marks = marksFromRailRegion(text);
      if (!marks.length) {
        await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '网学孩惠折赠支微团残兑()（）' });
        const isolated = await read(.43, .397, .17, .133);
        if (isolated.confidence >= 62) marks = marksFromRailRegion(isolated.text);
      }
      if (marks.length) fields.ticketMarks = marks;
    }
    if (!record?.ticketNumber || !record?.saleCode) {
      await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' });
      for (const [key, footer, x, y, w, h] of [
        ['ticketNumber', false, .025, .01, .43, .16],
        ['saleCode', true, .017, .86, .68, .13]
      ]) {
        if (record?.[key]) continue;
        const { text, confidence } = await read(x, y, w, h);
        const number = confidence >= 55 && printedRailNumber(text, footer);
        if (number) fields[key] = number;
      }
    }
  } catch { /* A failed field read must not discard the rest of the ticket. */ }
  finally { await worker.setParameters({ tessedit_pageseg_mode: '3', tessedit_char_whitelist: '' }); }
  return fields;
}

export async function refineRailTemplate(worker, image, data, paperColor) {
  if (paperColor === 'red' || printedRailTemplate(data.text) || !parsePrintedRailTicket(data.text, 'OCR', { layout: data.tsv })) return;
  // A blue ticket can be either type. Re-read the printed notices beneath the route.
  const rectangle = {
    left: 0, top: Math.floor(image.height * .38),
    width: Math.floor(image.width * .78), height: Math.floor(image.height * .57)
  };
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const { data: notice } = await worker.recognize(image, { rectangle });
    if (notice.confidence < 40) return;
    const template = printedRailTemplate(notice.text);
    if (template === 'rail-refund-receipt') data.text += '\n退票费';
    else if (template === 'rail-receipt') data.text += '\n报销凭证';
  } catch { /* Use the text and colour already collected. */ }
  finally { await worker.setParameters({ tessedit_pageseg_mode: '3' }); }
}

export function railReadScore(data) {
  const record = parsePrintedRailTicket(data.text, 'OCR', { layout: data.tsv });
  if (!record) return 0;
  return Number(!!record.service) * 4 + Number(!!record.origin) * 2 + Number(!!record.destination) * 2 + Number(calendarDate(record.departureDate).length === 10) * 2 + Number(!!record.departureTime) + Number(!!record.seatClass);
}

export function preferEnhancedRailRead(original, enhanced) {
  const before = parsePrintedRailTicket(original.text, 'OCR', { layout: original.tsv });
  const after = parsePrintedRailTicket(enhanced.text, 'OCR', { layout: enhanced.tsv });
  const agrees = !before?.service || !after?.service || before.service === after.service;
  return agrees && railReadScore(enhanced) > railReadScore(original);
}

export async function refineRailService(worker, image, data) {
  const record = parsePrintedRailTicket(data.text, 'OCR', { layout: data.tsv });
  if (record === null) return;
  const region = railTrainRectangle(data.text, data.tsv);
  if (!region) return;
  if (!region.text && record?.service) return;
  if (region.code && region.confidence >= 65) { data.text = `车次：${region.code}\n` + data.text; return; }
  try {
    await worker.setParameters({ tessedit_char_whitelist: 'GDCZTKYLS0123456789', tessedit_pageseg_mode: '7' });
    const refined = await worker.recognize(image, { rectangle: region.rectangle });
    const service = refined.data.text.replace(/\s/g, '');
    if (refined.data.confidence >= Math.max(65, region.confidence + 10) && /^(?:[GDCZTKYLS]\d{1,5}|\d{3,4})$/.test(service) && /[1-9]/.test(service)) data.text = `车次：${service}\n` + data.text;
  } catch { /* Keep uncertain characters available for manual review. */ }
  finally { await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' }); }
}

export async function refineRailReceipt(worker, image, data) {
  const record = parsePrintedRailTicket(data.text, 'OCR', { layout:data.tsv });
  if (!record || (record.template === 'rail-refund-receipt' && record.price) || (record.price && record.template !== 'rail-receipt')) return;
  const rectangle = railFareRectangle(data.text, data.tsv);
  if (!rectangle) return;
  try {
    await worker.setParameters({ tessedit_char_whitelist:'', tessedit_pageseg_mode:'6' });
    const { data:refined } = await worker.recognize(image, { rectangle });
    if (refined.confidence < 60) return;
    const fee = /退票(?:手续)?费/.test(refined.text.replace(/\s/g, ''));
    const prices = new Set(refined.text.split('\n').map(line => railFareFromLine(line, { regional: true })).filter(Boolean));
    const price = prices.size === 1 ? prices.values().next().value : '';
    if (!record.price && price) data.text = `￥${price}元\n` + data.text;
    if (fee && record.template === 'rail-receipt') data.text += '\n退票费';
  } catch { /* Leave the original read available when this region is unclear. */ }
  finally { await worker.setParameters({ tessedit_char_whitelist:'', tessedit_pageseg_mode:'3' }); }
}
