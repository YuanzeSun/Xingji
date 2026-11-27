import { escape as e } from './html.js';
import {journeyDate,calendarDate,monthDay,dateFromMonthDay} from './journey-date.js';
import {fieldSourceBadge,railBarcodeFieldLocked,railImportFieldLocked} from './field-sources.js';
import {ticketRequiredMark} from './ticket-form.js';
import { RAIL_QR_YEAR_PERIOD } from './rail-qr-codec.js';
import { FLIGHT_DATE_DEFAULT_ATTR, OPTIONAL_FLIGHT_TIMES } from './flight-times.js';
import { hasOriginalBoardingCode } from './boarding-metadata.js';

export const barcodeDateDay=(record,key)=>key==='departureDate'&&record.type==='flight'&&hasOriginalBoardingCode(record) &&
  record.fieldSources?.departureDate === 'barcode' ? journeyDate(record.departureDate)?.dayOfYear : null;
const dateFromBarcodeYear = (value, dayOfYear) => journeyDate({ year: value ? Number(value) : null, dayOfYear });
const options=(count,current,unit)=>'<option value="">'+unit+'</option>'+Array.from({length:count},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}" ${Number(current)===i+1?'selected':''}>${i+1}${unit}</option>`).join('');
const daysInMonth = (year, month) => month ? new Date(Date.UTC(Number(year) || 2000, Number(month), 0)).getUTCDate() : 31;
const flightTimeForDate = (record, key) => record.type === 'flight' && OPTIONAL_FLIGHT_TIMES[key];
const monthDayControls = wrapper => wrapper.querySelectorAll('[name$="Month"], [name$="Day"]');
function writeMonthDay(year, month, day, value) {
  month.value = value.slice(0, 2);
  if (day.tagName === 'SELECT') day.innerHTML = options(daysInMonth(year, month.value), value.slice(3), '日');
  else day.value = value.slice(3);
}
function refreshFlightDateDefaults(form) {
  const departureYear = form?.elements.departureDateYear;
  if (!departureYear) return;
  const year = departureYear.validity.valid ? departureYear.value : '', month = form.elements.departureDateMonth.value;
  const departure = form.elements.departureDate.value;
  for (const wrapper of form.querySelectorAll('[data-optional-flight-date]')) {
    const hint = wrapper.querySelector('[data-flight-departure-reference]');
    hint.hidden = departure.length !== 10;
    hint.textContent = hint.hidden ? '' : `（注：计划起飞日期 ${departure}）`;
    const [monthInput, dayInput] = monthDayControls(wrapper), yearInput = wrapper.querySelector('input[type="number"]');
    if (dayInput.value) continue;
    if (yearInput.hasAttribute(FLIGHT_DATE_DEFAULT_ATTR)) yearInput.value = year;
    if (monthInput.hasAttribute(FLIGHT_DATE_DEFAULT_ATTR)) monthInput.value = month;
  }
}
const railQRYear = (record, key) => key === 'departureDate' && railBarcodeFieldLocked(record, key) ? journeyDate(record[key])?.year : null;
const yearMinimum = qrYear => qrYear ? 1800 + (qrYear - 1800) % RAIL_QR_YEAR_PERIOD : 1800;
export function ticketDateField(key,record,{label,required=false}={}) {
  const date=journeyDate(record[key]),md=monthDay(date),ordinal=barcodeDateDay(record,key),locked=!!ordinal||railBarcodeFieldLocked(record,key)||railImportFieldLocked(record,key);
  const qrYear = railQRYear(record, key);
  const optionalFlight = flightTimeForDate(record, key);
  const useDefault = optionalFlight && !date ? ` ${FLIGHT_DATE_DEFAULT_ATTR}` : '';
  const control = (part, unit, description, value, count, defaultAttr = '') => {
    const attrs = `name="${key + part}" aria-label="${e(label)}${description}"${locked ? ' disabled' : ''}${defaultAttr}`;
    return record.type === 'flight'
      ? `<input ${attrs} type="text" inputmode="numeric" pattern="[0-9]{1,2}" maxlength="2" placeholder="${unit}" value="${e(value)}"/>`
      : `<select ${attrs}>${options(count, value, unit)}</select>`;
  };
  return `<fieldset class="field journey-date-field" data-journey-date="${key}"${optionalFlight ? ' data-optional-flight-date' : ''}>
    <legend>${e(label)}${ticketRequiredMark(record, key, required)}${optionalFlight ? '<small class="ticket-date-reference" data-flight-departure-reference hidden></small>' : ''}</legend>
    <input type="hidden" name="${key}" ${required?'required':''} value="${e(calendarDate(date))}"/>
    <div class="ticket-date-parts">
      <label><span>年份${fieldSourceBadge(key+'Year',record)}</span><input name="${key}Year" type="number" inputmode="numeric" min="${yearMinimum(qrYear)}" max="2200" step="${qrYear ? RAIL_QR_YEAR_PERIOD : 1}" placeholder="年份" value="${date?.year??''}" aria-label="${e(label)}年份"${useDefault}/></label>
      <div class="month-day-part"><span>月日${fieldSourceBadge(key,record)}</span><div class="month-day-controls">
        ${control('Month', '月', '月份', md.slice(0, 2), 12, useDefault)}
        ${control('Day', '日', '日', md.slice(3), daysInMonth(date?.year, md.slice(0, 2)))}
      </div></div>
    </div>
  </fieldset>`;
}
export function readTicketDate(form,key,record,{strict=false}={}) {
  if(railImportFieldLocked(record,key))return record[key];
  const year=form.elements[key+'Year'],month=form.elements[key+'Month'],day=form.elements[key+'Day'];
  if(!year)return journeyDate(form.elements[key] ? form.elements[key].value : record[key]);
  const railLocked=railBarcodeFieldLocked(record,key);
  const ordinal=barcodeDateDay(record,key);
  try{
    if(railLocked){
      const date = dateFromMonthDay(year.value,monthDay(record[key]));
      const qrYear = railQRYear(record, key);
      if (qrYear && (date.year - qrYear) % RAIL_QR_YEAR_PERIOD) throw new Error('铁路二维码的出发年份只能按 7 年调整');
      return date;
    }
    if (ordinal) return dateFromBarcodeYear(year.value, ordinal);
    const timeKey = flightTimeForDate(record, key), hasMonthDay = month.value && day.value;
    if (timeKey) {
      const time = form.elements[timeKey];
      const entered = time?.value || time?.validity.badInput || day.value || [year, month].some(part => part.value && !part.hasAttribute(FLIGHT_DATE_DEFAULT_ATTR));
      if (!entered) return '';
      if (strict) {
        const fields = [];
        if (!year.value || !hasMonthDay) fields.push(key);
        if (!time?.value) fields.push(timeKey);
        if (fields.length) throw Object.assign(new Error('完整填写或清空全部'), { fields });
      }
      if (!hasMonthDay) return '';
    } else if (strict && !hasMonthDay && (month.value || day.value)) throw new Error('请填写完整月日');
    return dateFromMonthDay(year.value, hasMonthDay ? `${month.value.padStart(2, '0')}-${day.value.padStart(2, '0')}` : '');
  } catch (error) {
    if (strict) throw error;
    if (railLocked) return record[key];
    return ordinal ? { year: null, dayOfYear: ordinal } : '';
  }
}
export function writeTicketDate(root,key,value) {
  const wrapper=root.querySelector(`[data-journey-date="${key}"]`);if(!wrapper)return;
  const date=journeyDate(value),md=monthDay(date);
  const year=wrapper.querySelector(`[name="${key}Year"]`);
  year.value=date?.year??'';
  year.setCustomValidity('');
  const [month, day] = monthDayControls(wrapper);
  writeMonthDay(year.value, month, day, md);
  wrapper.querySelector(`[name="${key}"]`).value=calendarDate(date);
  const optionalFlight = wrapper.hasAttribute('data-optional-flight-date');
  if (optionalFlight) for (const part of [year, month]) part.toggleAttribute(FLIGHT_DATE_DEFAULT_ATTR, !date);
  if (key === 'departureDate' || (optionalFlight && !date)) refreshFlightDateDefaults(wrapper.closest('form'));
}
export function refreshTicketDateLocks(root,record) {
  for(const wrapper of root.querySelectorAll('[data-journey-date]')){
    const key=wrapper.dataset.journeyDate,ordinal=barcodeDateDay(record,key);
    const fullyLocked=railImportFieldLocked(record,key),railLocked=railBarcodeFieldLocked(record,key),locked=!!ordinal||railLocked||fullyLocked;
    const year=wrapper.querySelector('input[type="number"]');
    const parts = monthDayControls(wrapper);
    const qrYear = railQRYear(record, key);
    year.min = String(yearMinimum(qrYear));
    year.step = qrYear ? String(RAIL_QR_YEAR_PERIOD) : '1';
    year.readOnly=fullyLocked;
    wrapper.toggleAttribute('data-barcode-locked',fullyLocked);
    year.parentElement.querySelector('[data-field-source]')?.toggleAttribute('data-source-locked',fullyLocked);
    if(fullyLocked)writeTicketDate(root,key,record[key]);
    else if(railLocked){
      const md=monthDay(record[key]);
      parts[0].value=md.slice(0,2);
      parts[1].value=md.slice(3);
    }
    parts.forEach(input=>{input.disabled=locked;input.toggleAttribute('data-barcode-lock',locked);});
    const part=wrapper.querySelector('.month-day-part');part.toggleAttribute('data-barcode-locked',locked);
    const badge=part.querySelector('[data-field-source]');badge?.toggleAttribute('data-source-locked',locked);
    if (record.type === 'flight' && key === 'departureDate' && !ordinal) year.setCustomValidity('');
  }
}
export function bindTicketDates(form,getRecord) {
  refreshFlightDateDefaults(form);
  form.addEventListener('input',event=>{
    const wrapper=event.target.closest('[data-journey-date]');if(!wrapper)return;
    const key=wrapper.dataset.journeyDate,record=getRecord(),year=form.elements[key+'Year'],month=form.elements[key+'Month'],day=form.elements[key+'Day'],ordinal=barcodeDateDay(record,key);
    if(railImportFieldLocked(record,key)){writeTicketDate(form,key,record[key]);return;}
    if(event.target.name===key&&!ordinal){try{writeTicketDate(form,key,event.target.value);}catch{year.value='';month.value='';day.value='';}}
    if(railBarcodeFieldLocked(record,key)){
      try{readTicketDate(form,key,record,{strict:true});year.setCustomValidity('');}
      catch(error){year.setCustomValidity(error.message);}
    }else if(ordinal){
      try{writeMonthDay(year.value, month, day, monthDay(dateFromBarcodeYear(year.value,ordinal)));year.setCustomValidity('');}
      catch(error){month.value='';day.value='';year.setCustomValidity(error.message);}
    }else{
      const target = event.target;
      if ((target === month || target === day) && target.tagName === 'INPUT') {
        const digits = target.value.normalize('NFKC').replace(/[^0-9]/g, '').slice(0, 2);
        if (target.value !== digits) target.value = digits;
      }
      if (target === month || target === year) {
        target.removeAttribute(FLIGHT_DATE_DEFAULT_ATTR);
        if (day.tagName === 'SELECT') day.innerHTML = options(daysInMonth(year.value, month.value), day.value, '日');
      }
    }
    const date=readTicketDate(form,key,record);form.elements[key].value=calendarDate(date);
    if (key === 'departureDate') refreshFlightDateDefaults(form);
  },true);
}

export function dateControl(name, value = '', required = false, { id = '', searchField = '' } = {}) {
  const attrs = `name="${e(name)}"${id ? ` id="${e(id)}"` : ''}${searchField ? ` data-search-field="${e(searchField)}"` : ''} data-date-control${required ? ' required aria-required="true"' : ''}`;
  // Preserve the known precision of historical dates instead of inventing a day.
  if (/^\d{4}$/.test(value)) {
    return `<select ${attrs}>${Array.from({ length: 401 }, (_, index) => 2200 - index).map(year => `<option value="${year}"${String(year) === value ? ' selected' : ''}>${year}年</option>`).join('')}</select>`;
  }
  const month = /^\d{4}-\d{2}$/.test(value);
  return `<input ${attrs} type="${month ? 'month' : 'date'}" value="${e(value)}" min="${month ? '1800-01' : '1800-01-01'}" max="${month ? '2200-12' : '2200-12-31'}" />`;
}

export function bindDatePickers(root) {
  for (const input of root.querySelectorAll('[data-date-control], input[type="date"], input[type="month"], input[type="time"]')) {
    input.addEventListener('click', event => {
      if (input.disabled || input.readOnly || typeof input.showPicker !== 'function') return;
      try { input.showPicker(); event.preventDefault(); } catch {
        // Older WebViews can still use the browser's normal control.
      }
    });
    input.addEventListener('change', () => input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true })));
  }
}
