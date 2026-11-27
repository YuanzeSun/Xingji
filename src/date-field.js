import { escape as e } from './html.js';
import {journeyDate,calendarDate,monthDay,dateFromMonthDay} from './journey-date.js';
import {fieldSourceBadge,railBarcodeFieldLocked,railImportFieldLocked} from './field-sources.js';
import {ticketRequiredMark} from './ticket-form.js';
import { RAIL_QR_YEAR_PERIOD } from './rail-qr-codec.js';

export const barcodeDateDay=(record,key)=>key==='departureDate'&&record.type==='flight'&&record.boardingCodeSource==='original' &&
  record.fieldSources?.departureDate === 'barcode' ? journeyDate(record.departureDate)?.dayOfYear : null;
const dateFromBarcodeYear = (value, dayOfYear) => journeyDate({ year: value ? Number(value) : null, dayOfYear });
const options=(count,current,unit)=>'<option value="">'+unit+'</option>'+Array.from({length:count},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}" ${Number(current)===i+1?'selected':''}>${i+1}${unit}</option>`).join('');
const railQRYear = (record, key) => key === 'departureDate' && railBarcodeFieldLocked(record, key) ? journeyDate(record[key])?.year : null;
const yearMinimum = qrYear => qrYear ? 1800 + (qrYear - 1800) % RAIL_QR_YEAR_PERIOD : 1800;
export function ticketDateField(key,record,{label,required=false}={}) {
  const date=journeyDate(record[key]),md=monthDay(date),ordinal=barcodeDateDay(record,key),locked=!!ordinal||railBarcodeFieldLocked(record,key)||railImportFieldLocked(record,key);
  const qrYear = railQRYear(record, key);
  return `<fieldset class="field journey-date-field" data-journey-date="${key}"><legend>${e(label)}${ticketRequiredMark(record, key, required)}</legend><input type="hidden" name="${key}" ${required?'required':''} value="${e(calendarDate(date))}"/><div class="ticket-date-parts"><label><span>年份${fieldSourceBadge(key+'Year',record)}</span><input name="${key}Year" type="number" inputmode="numeric" min="${yearMinimum(qrYear)}" max="2200" step="${qrYear ? RAIL_QR_YEAR_PERIOD : 1}" placeholder="年份" value="${date?.year??''}" aria-label="${e(label)}年份"/></label><div class="month-day-part"><span>月日${fieldSourceBadge(key,record)}</span><div class="month-day-selects"><select name="${key}Month" aria-label="${e(label)}月份" ${locked?'disabled':''}>${options(12,md.slice(0,2),'月')}</select><select name="${key}Day" aria-label="${e(label)}日" ${locked?'disabled':''}>${options(31,md.slice(3),'日')}</select></div></div></div></fieldset>`;
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
    if(strict&&(month.value||day.value)&&(!month.value||!day.value))throw new Error('请填写完整月日');
    return dateFromMonthDay(year.value,month.value&&day.value?`${month.value}-${day.value}`:'');
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
  wrapper.querySelector(`[name="${key}Month"]`).value=md.slice(0,2);
  wrapper.querySelector(`[name="${key}Day"]`).value=md.slice(3);
  wrapper.querySelector(`[name="${key}"]`).value=calendarDate(date);
}
export function refreshTicketDateLocks(root,record) {
  for(const wrapper of root.querySelectorAll('[data-journey-date]')){
    const key=wrapper.dataset.journeyDate,ordinal=barcodeDateDay(record,key);
    const fullyLocked=railImportFieldLocked(record,key),railLocked=railBarcodeFieldLocked(record,key),locked=!!ordinal||railLocked||fullyLocked;
    const year=wrapper.querySelector('input[type="number"]');
    const qrYear = railQRYear(record, key);
    year.min = String(yearMinimum(qrYear));
    year.step = qrYear ? String(RAIL_QR_YEAR_PERIOD) : '1';
    year.readOnly=fullyLocked;
    year.closest('.field').toggleAttribute('data-barcode-locked',fullyLocked);
    year.parentElement.querySelector('[data-field-source]')?.toggleAttribute('data-source-locked',fullyLocked);
    if(fullyLocked)writeTicketDate(root,key,record[key]);
    else if(railLocked){
      const md=monthDay(record[key]);
      wrapper.querySelector('select[name$="Month"]').value=md.slice(0,2);
      wrapper.querySelector('select[name$="Day"]').value=md.slice(3);
    }
    wrapper.querySelectorAll('select').forEach(input=>{input.disabled=locked;input.toggleAttribute('data-barcode-lock',locked);});
    const part=wrapper.querySelector('.month-day-part');part.toggleAttribute('data-barcode-locked',locked);
    const badge=part.querySelector('[data-field-source]');badge?.toggleAttribute('data-source-locked',locked);
    if (record.type === 'flight' && key === 'departureDate' && !ordinal) year.setCustomValidity('');
  }
}
export function bindTicketDates(form,getRecord) {
  form.addEventListener('input',event=>{
    const wrapper=event.target.closest('[data-journey-date]');if(!wrapper)return;
    const key=wrapper.dataset.journeyDate,record=getRecord(),year=form.elements[key+'Year'],month=form.elements[key+'Month'],day=form.elements[key+'Day'],ordinal=barcodeDateDay(record,key);
    if(railImportFieldLocked(record,key)){writeTicketDate(form,key,record[key]);return;}
    if(event.target.name===key&&!ordinal){try{writeTicketDate(form,key,event.target.value);}catch{year.value='';month.value='';day.value='';}}
    if(railBarcodeFieldLocked(record,key)){
      try{readTicketDate(form,key,record,{strict:true});year.setCustomValidity('');}
      catch(error){year.setCustomValidity(error.message);}
    }else if(ordinal){
      try{const date=dateFromBarcodeYear(year.value,ordinal),md=monthDay(date);month.value=md.slice(0,2);day.value=md.slice(3);year.setCustomValidity('');}
      catch(error){month.value='';day.value='';year.setCustomValidity(error.message);}
    }else if(event.target===month||event.target===year){
      const previous=day.value,count=month.value ? new Date(Date.UTC(Number(year.value)||2000,Number(month.value),0)).getUTCDate() : 31;
      day.innerHTML=options(count,previous,'日');
    }
    const date=readTicketDate(form,key,record);form.elements[key].value=calendarDate(date);
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
