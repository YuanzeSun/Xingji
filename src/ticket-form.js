import {FLIGHT_TIME_LABELS,validateFlightTimeDifferences} from './flight-times.js';
import {JOURNEY_DATE_FIELDS,journeyDate} from './journey-date.js';
import { requireCompleteIdentity } from './identity.js';
import { isAnonymousRedTemplate } from './rail-template.js';
import { railQRNeedsField } from './rail-ticket-qr.js';
import { isRailPointsRecord } from './field-sources.js';

export const barcodeRequiredMark = '<b class="required-mark barcode-required-mark" aria-label="生成条码必填">*</b>';

export function ticketRequiredMark(record, key, required) {
  if (required) return '<b class="required-mark" aria-label="必填">*</b>';
  if (railQRNeedsField(record, key)) {
    return `<b class="required-mark barcode-required-mark" data-rail-qr-mark${record.ticketCode ? ' hidden' : ''} aria-label="生成二维码必填">*</b>`;
  }
  return record.type === 'flight' && key === 'pnr' ? barcodeRequiredMark : '';
}

export function refreshRailQRMarks(root, record) {
  for (const mark of root.querySelectorAll('[data-rail-qr-mark]')) {
    mark.hidden = Boolean(record.ticketCode);
  }
}

const journeyFields = ['origin', 'destination', 'service', 'departureDate'];
const passengerFields = ['passenger', 'seat', 'seatClass'];
const flightFields = [...journeyFields, ...passengerFields];
const railFields = [...journeyFields, 'departureTime', ...passengerFields];
export function requiredTicketFields(type, template, flightStatus = 'normal', railStanding = false) {
  if (type === 'flight') return ['open', 'invalid'].includes(flightStatus) ? ['origin', 'destination', 'passenger'] : flightFields;
  if (template === 'rail-supplement') return ['origin', 'destination', 'service', 'departureDate'];
  const fields = template === 'rail-refund-receipt'
    ? ['origin', 'destination', 'service', 'departureDate', 'passenger', 'price']
    : railStanding ? railFields.filter(key => key !== 'seat') : [...railFields, 'carriage'];
  return isAnonymousRedTemplate(template) ? fields.filter(key => key !== 'passenger') : fields;
}

export function requiredRecordFields(record) {
  if (record.template !== 'rail-refund-receipt' && isRailPointsRecord(record)) {
    return ['origin', 'destination', 'service', 'departureDate'];
  }
  return requiredTicketFields(record.type, record.template, record.flightStatus, record.railStanding);
}

export function ticketFieldLabel(key, type, fallback = key) {
  const flight = type === 'flight';
  if (flight && FLIGHT_TIME_LABELS[key]) return FLIGHT_TIME_LABELS[key];
  if (flight && key === 'boardingCodeOperatingFlight') return '实际承运航班';
  return ({ origin: flight ? '出发机场' : '出发站', destination: flight ? '到达机场' : '到达站', service: flight ? '航班号' : '车次', seat: flight ? '座位号' : '座位 / 铺位', seatClass: flight ? '舱位代码' : '席别', gate: flight ? '登机口' : '检票口', carriage: '车厢', passenger: '旅客姓名', identity: '证件号', departureDate: '出发日期', departureTime: '出发时间' })[key] || fallback;
}

const datePresent=value=>{try{return !!journeyDate(value)?.dayOfYear;}catch{return false;}};
export const missingTicketFields = record => requiredRecordFields(record).filter(key => JOURNEY_DATE_FIELDS.includes(key) ? !datePresent(record[key]) : !record[key]?.trim());

export function validateTicketForm(record) {
  requireCompleteIdentity(record.identity);
  const fields = missingTicketFields(record);
  if (!fields.length) return validateFlightTimeDifferences(record);
  const key = fields[0], error = new Error('请填写' + (key === 'price' && record.template === 'rail-refund-receipt' ? '退票费' : ticketFieldLabel(key, record.type)));
  error.fields = fields;
  throw error;
}

export function ticketFormFeedback(form, getRecord) {
  const summary = form.querySelector('#editor-error');
  let submitted = false,invalidFields=[];
  function refresh() {
    const record = getRecord(), missing = submitted ? [...new Set([...missingTicketFields(record),...invalidFields])] : [];
    for (const field of form.querySelectorAll('.field')) {
      const key = [...field.querySelectorAll('[name]')].find(input => missing.includes(input.name))?.name;
      const invalid = missing.includes(key);
      field.classList.toggle('field-invalid', invalid);
      for (const input of field.querySelectorAll('input,select')) {
        const describedBy = new Set((input.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
        if (invalid) { input.setAttribute('aria-invalid', 'true'); describedBy.add(summary.id); }
        else { input.removeAttribute('aria-invalid'); describedBy.delete(summary.id); }
        if (describedBy.size) input.setAttribute('aria-describedby', [...describedBy].join(' '));
        else input.removeAttribute('aria-describedby');
      }
    }
    summary.textContent = missing.length ? `还有 ${missing.length} 项必填信息未填写：${missing.slice(0, 3).map(key => key === 'price' && record.template === 'rail-refund-receipt' ? '退票费' : ticketFieldLabel(key, record.type)).join('、')}${missing.length > 3 ? '等' : ''}。请补全红框中的信息。` : '';
    summary.hidden = !summary.textContent;
  }
  form.addEventListener('input', () => { invalidFields=[];if (submitted) refresh(); });
  return error => {
    submitted = !!error.fields;
    invalidFields=error.fields || [];
    refresh();
    if (!submitted || !missingTicketFields(getRecord()).length) { summary.textContent = error.message; summary.hidden = false; }
    const field = form.querySelector('.field-invalid');
    const section = field?.closest('details');
    if (section) section.open = true;
    const target = field ? field.querySelector('input:not([type="hidden"]):not([hidden]),select:not([hidden])') : summary;
    target?.scrollIntoView?.({ block:'center' });
    target?.focus({ preventScroll:true });
  };
}
