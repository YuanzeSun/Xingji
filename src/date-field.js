import { escape as e } from './html.js';
import {journeyDate,calendarDate,monthDay,dateFromMonthDay} from './journey-date.js';
import {readBoardingCode} from './bcbp.js';
import {fieldSourceBadge} from './field-sources.js';

export const barcodeDateDay=(record,key)=>key==='departureDate'&&record.type==='flight'&&record.boardingCodeSource==='original' ? readBoardingCode(record.boardingCode,record.boardingLegIndex)?.dayOfYear : null;
const options=(count,current,unit)=>'<option value="">'+unit+'</option>'+Array.from({length:count},(_,i)=>`<option value="${String(i+1).padStart(2,'0')}" ${Number(current)===i+1?'selected':''}>${i+1}${unit}</option>`).join('');
export function ticketDateField(key,record,{label,required=false}={}) {
  const date=journeyDate(record[key]),md=monthDay(date),locked=!!barcodeDateDay(record,key);
  return `<fieldset class="field journey-date-field" data-journey-date="${key}"><legend>${e(label)}${required?' <span class="required-mark">*</span>':''}</legend><input type="hidden" name="${key}" ${required?'required':''} value="${e(calendarDate(date))}"/><div class="ticket-date-parts"><label><span>年份${fieldSourceBadge(key+'Year',record)}</span><input name="${key}Year" type="number" inputmode="numeric" min="1800" max="2200" step="1" placeholder="年份" value="${date?.year??''}" aria-label="${e(label)}年份"/></label><div class="month-day-part"><span>月日${fieldSourceBadge(key,record)}</span><div class="month-day-selects"><select name="${key}Month" aria-label="${e(label)}月份" ${locked?'disabled':''}>${options(12,md.slice(0,2),'月')}</select><select name="${key}Day" aria-label="${e(label)}日" ${locked?'disabled':''}>${options(31,md.slice(3),'日')}</select></div></div></div><small class="date-ordinal-note" data-date-note ${locked&&!date?.year?'':'hidden'}>${locked?`条码记录：第 ${barcodeDateDay(record,key)} 天，请补充年份以显示月日`:''}</small></fieldset>`;
}
export function readTicketDate(form,key,record,{strict=false}={}) {
  const year=form.elements[key+'Year'],month=form.elements[key+'Month'],day=form.elements[key+'Day'];
  if(!year)return journeyDate(form.elements[key] ? form.elements[key].value : record[key]);
  try{
    const ordinal=barcodeDateDay(record,key);
    if(ordinal)return journeyDate({year:year.value?Number(year.value):null,dayOfYear:ordinal});
    if(strict&&(month.value||day.value)&&(!month.value||!day.value))throw new Error('请填写完整月日');
    return dateFromMonthDay(year.value,month.value&&day.value?`${month.value}-${day.value}`:'');
  }catch(error){if(strict)throw error;return '';}
}
export function writeTicketDate(root,key,value) {
  const wrapper=root.querySelector(`[data-journey-date="${key}"]`);if(!wrapper)return;
  const date=journeyDate(value),md=monthDay(date);
  wrapper.querySelector(`[name="${key}Year"]`).value=date?.year??'';
  wrapper.querySelector(`[name="${key}Month"]`).value=md.slice(0,2);
  wrapper.querySelector(`[name="${key}Day"]`).value=md.slice(3);
  wrapper.querySelector(`[name="${key}"]`).value=calendarDate(date);
}
export function refreshTicketDateLocks(root,record) {
  for(const wrapper of root.querySelectorAll('[data-journey-date]')){
    const key=wrapper.dataset.journeyDate,ordinal=barcodeDateDay(record,key),locked=!!ordinal;
    wrapper.querySelectorAll('select').forEach(input=>{input.disabled=locked;input.toggleAttribute('data-barcode-lock',locked);});
    const part=wrapper.querySelector('.month-day-part');part.toggleAttribute('data-barcode-locked',locked);
    const badge=part.querySelector('[data-field-source]');badge?.toggleAttribute('data-source-locked',locked);
    const note=wrapper.querySelector('[data-date-note]');note.hidden=!locked||!!journeyDate(record[key])?.year;
    if(locked)note.textContent=`条码记录：第 ${ordinal} 天，请补充年份以显示月日`;
  }
}
export function bindTicketDates(form,getRecord) {
  form.addEventListener('input',event=>{
    const wrapper=event.target.closest('[data-journey-date]');if(!wrapper)return;
    const key=wrapper.dataset.journeyDate,record=getRecord(),year=form.elements[key+'Year'],month=form.elements[key+'Month'],day=form.elements[key+'Day'],ordinal=barcodeDateDay(record,key);
    if(event.target.name===key){try{writeTicketDate(form,key,event.target.value);}catch{year.value='';month.value='';day.value='';}}
    if(ordinal){
      try{const date=journeyDate({year:year.value?Number(year.value):null,dayOfYear:ordinal}),md=monthDay(date);month.value=md.slice(0,2);day.value=md.slice(3);year.setCustomValidity('');}
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
