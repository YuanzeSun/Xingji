import { createRecord, now } from './model.js';
import { parseRailInvoicePage } from './rail-invoice.js';

export function mapFlightResult(payload) {
  // Intentionally conservative: only this documented intermediate shape is accepted.
  // Raw provider responses stay in the review screen until a provider mapping is verified.
  const items = Array.isArray(payload) ? payload : payload?.flights;
  if (!Array.isArray(items)) throw new Error('尚未识别飞常准接口返回结构');
  return items.map(item => createRecord({ type: 'flight', template: 'air-boarding-pass', service: String(item.flightNumber || ''), origin: String(item.origin || ''), destination: String(item.destination || ''), originCity: String(item.originCity || ''), destinationCity: String(item.destinationCity || ''), originCode: String(item.originCode || ''), destinationCode: String(item.destinationCode || ''), departureDate: item.departureDate || '', departureTime: String(item.departureTime || ''), arrivalDate: item.arrivalDate || '', arrivalTime: String(item.arrivalTime || ''), actualDepartureDate: item.actualDepartureDate || '', actualDepartureTime: String(item.actualDepartureTime || ''), actualArrivalDate: item.actualArrivalDate || '', actualArrivalTime: String(item.actualArrivalTime || ''), flightDistance: String(item.flightDistance || ''), departureZone: String(item.departureZone || ''), arrivalZone: String(item.arrivalZone || ''), passenger: String(item.passenger || ''), seat: String(item.seat || ''), airline: String(item.airline || ''), flightStatus: String(item.flightStatus || ''), aircraft: String(item.aircraft || ''), aircraftRegistration: String(item.aircraftRegistration || ''), sources: [{ kind: 'flight-lookup', label: '飞常准历史行程', at: now() }] }));
}
export async function readRailInvoicePDF(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', location.href).href;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, useSystemFonts: true, cMapUrl: new URL('./vendor/cmaps/', location.href).href, cMapPacked: true, standardFontDataUrl: new URL('./vendor/standard_fonts/', location.href).href }).promise;
  if (doc.numPages > 50) { await doc.destroy(); throw new Error('请按50页以内拆分PDF'); }
  let invoice;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const { items } = await page.getTextContent();
      const values = parseRailInvoicePage({ view: page.view, items });
      if (!values) continue;
      if (invoice) throw new Error('识别到多段行程，请逐段录入');
      invoice = values;
    }
  } finally { await doc.destroy(); }
  if (!invoice) throw new Error('未识别到铁路电子发票，请选择 12306 下载的 PDF');
  return createRecord({ ...invoice, sources: [{ kind: 'pdf', label: '电子报销凭证', at: now() }] });
}
