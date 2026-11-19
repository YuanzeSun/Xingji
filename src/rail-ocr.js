import {calendarDate} from './journey-date.js';
import { railTrainRectangle, railFareRectangle, parsePrintedRailTicket } from './rail-ticket.js';
import { printedRailTemplate } from './rail-template.js';

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
    else if (/限乘|当次车/.test(notice.text.replace(/\s/g, ''))) data.text += '\n限乘当日当次车';
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
    const price = refined.text.match(/[¥￥Y]\s*(\d{1,4}(?:\s*\.\s*\d{1,2})?)(?:元|%|\s|$)/)?.[1]?.replace(/\s/g, '');
    if (!record.price && price) data.text = `￥${price}元\n` + data.text;
    if (fee && record.template === 'rail-receipt') data.text += '\n退票费';
  } catch { /* Leave the original read available when this region is unclear. */ }
  finally { await worker.setParameters({ tessedit_char_whitelist:'', tessedit_pageseg_mode:'3' }); }
}
