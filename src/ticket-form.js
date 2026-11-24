import {FLIGHT_TIME_LABELS} from './flight-times.js';
import {JOURNEY_DATE_FIELDS,journeyDate} from './journey-date.js';
import { requireCompleteIdentity } from './identity.js';
import { isAnonymousRedTemplate } from './rail-template.js';
const common = ['origin', 'destination', 'service', 'departureDate', 'departureTime', 'passenger', 'identity', 'seat', 'seatClass'];
export function requiredTicketFields(type, template, flightStatus = 'normal', railStanding = false, fromRailInvoice = false) {
  if (type === 'flight') return ['open', 'invalid'].includes(flightStatus) ? ['origin', 'destination', 'passenger'] : common;
  if (template === 'rail-supplement') return ['origin', 'destination', 'service', 'departureDate'];
  const fields = template === 'rail-refund-receipt'
    ? ['origin', 'destination', 'service', 'departureDate', 'passenger', 'identity', 'price']
    : railStanding ? common.filter(key => key !== 'seat') : [...common, 'carriage'];
  if (isAnonymousRedTemplate(template)) return fields.filter(key => key !== 'passenger' && key !== 'identity');
  return fromRailInvoice ? fields.filter(key => key !== 'identity') : fields;
}

export function ticketFieldLabel(key, type, fallback = key) {
  const flight = type === 'flight';
  if (flight && FLIGHT_TIME_LABELS[key]) return FLIGHT_TIME_LABELS[key];
  return ({ origin: flight ? '出发机场' : '出发站', destination: flight ? '到达机场' : '到达站', service: flight ? '航班号' : '车次', seat: flight ? '座位号' : '座位 / 铺位', seatClass: flight ? '舱位代码' : '席别', gate: flight ? '登机口' : '检票口', carriage: '车厢', passenger: '旅客姓名', identity: '证件号', departureDate: '出发日期', departureTime: '出发时间' })[key] || fallback;
}

const datePresent=value=>{try{return !!journeyDate(value)?.dayOfYear;}catch{return false;}};
export const missingTicketFields = record => requiredTicketFields(record.type, record.template, record.flightStatus, record.railStanding, !!record.railInvoice?.electronicTicketNumber).filter(key => JOURNEY_DATE_FIELDS.includes(key) ? !datePresent(record[key]) : !record[key]?.trim());

export function validateTicketForm(record) {
  requireCompleteIdentity(record.identity);
  const fields = missingTicketFields(record);
  if (!fields.length) return;
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
    const target = field ? field.querySelector('input:not([type="hidden"]):not([hidden]),select:not([hidden])') : summary;
    target?.scrollIntoView?.({ block:'center' });
    target?.focus({ preventScroll:true });
  };
}
