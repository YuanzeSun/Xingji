import {operatingFlight} from './boarding-code-state.js';
import {escape as e} from './html.js';
import {boardingCodeDefaults,createBoardingCode,BCBP_FORMATS} from './bcbp.js';
import {hasChineseName} from './flight-passenger.js';
import {fieldSourceBadge} from './field-sources.js';
import {barcodeRequiredMark} from './ticket-form.js';

function generatorBadge(key,values,record,profile) {
  const kind=record.boardingCode ? record.boardingCodeSource==='generated' ? 'generated' : 'barcode' : key==='passenger' && profile && values.passenger ? 'profile' : ['format','electronic','status'].includes(key) ? 'default' : '';
  const field='bcbp:'+key;
  return fieldSourceBadge(field,{[field]:key==='electronic' ? values[key] || '无' : values[key],fieldSources:{[field]:kind}});
}
const englishPassengerField=(values,record,{profile}={})=>`<label class="field" data-bcbp-passenger-field><span>条码英文姓名${barcodeRequiredMark}${generatorBadge('passenger',values,record,profile)}</span><input data-bcbp="passenger" value="${e(values.passenger || '')}" maxlength="20" placeholder="姓/名，如：ZHANG/SAN" autocomplete="off" spellcheck="false" /></label>`;
export function boardingGeneratorMarkup(record,{profile,settings}={}) {
  if(record.type!=='flight')return '';
  const values={...boardingGeneratorValues(record,{profile}),...settings};
  const scanned=!!record.boardingCode && record.boardingCodeSource!=='generated';

  const select=(key,label,options,required=false)=>`<label class="field"><span>${label}${required?barcodeRequiredMark:''}${generatorBadge(key,values,record,profile)}</span><select data-bcbp="${key}">${options.map(([value,text])=>`<option value="${e(value)}" ${values[key]===value?'selected':''}>${e(text)}</option>`).join('')}</select></label>`;
  const input=(key,label,max,placeholder,required=false)=>`<label class="field"><span>${label}${required?barcodeRequiredMark:''}${generatorBadge(key,values,record,profile)}</span><input data-bcbp="${key}" value="${e(values[key]||'')}" maxlength="${max}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" ${key==='status'?'inputmode="numeric"':''}/></label>`;
  return `<div class="boarding-generator" data-bcbp-generator><h4>登机牌条码信息</h4><fieldset data-bcbp-fields${scanned ? ' disabled' : ''}><div class="form-grid">${hasChineseName(record.passenger)?englishPassengerField(values,record,{profile}):''}${input('sequence','值机序号（SEQ）',5,'如：25',true)}${input('status','打印时旅客状态',1,'如：1（已值机）',true)}${select('format','条码格式',BCBP_FORMATS.map(format=>[format,format==='PDF417'?'PDF417':format==='QRCode'?'QR Code':format]),true)}${select('electronic','电子客票标记',[['','无'],['E','E · 电子客票']])}${input('operatingFlight','实际承运航班（代码共享时填写）',9,'如：CA1234')}</div></fieldset></div>`;
}

export function readBoardingGenerator(section) {
  return Object.fromEntries([...section.querySelectorAll('[data-bcbp]')].map(input=>[input.dataset.bcbp,input.value]));
}

export function automaticBoardingCode(record,settings,{profile}={}) {
  try {
    const values={...boardingCodeDefaults(record,{useSaved:false,profile}),operatingFlight:'',...settings};
    Object.assign(values,operatingFlight(values.operatingFlight));
    return {
      code:createBoardingCode(values,values.format),
      operatingFlight:values.operatingFlight.trim().toUpperCase().replace(/\s/g,''),
    };
  } catch {
    return null;
  }
}

export function editBoardingGeneratorField(input) {
  if(input.tagName==='INPUT' && input.value!==input.value.toUpperCase()){
    const start=input.selectionStart,end=input.selectionEnd;
    input.value=input.value.toUpperCase();
    if(start!==null)input.setSelectionRange(start,end);
  }
  const field='bcbp:'+input.dataset.bcbp,badge=input.closest('.field').querySelector('[data-field-source]');
  if(badge)badge.outerHTML=fieldSourceBadge(field,{[field]:input.value || (input.dataset.bcbp==='electronic' ? '无' : ''),fieldSources:{[field]:'manual'}});
}

export function boardingGeneratorValues(record,{profile}={}) {
  const values=boardingCodeDefaults(record,{profile}),current=boardingCodeDefaults(record,{useSaved:false,profile});
  values.operatingFlight='';
  if(record.boardingCodeSource==='generated')values.operatingFlight=record.boardingCodeOperatingFlight || '';
  else if(values.carrier && current.carrier && values.carrier+values.flightNumber!==current.carrier+current.flightNumber)values.operatingFlight=values.carrier+values.flightNumber;
  return values;
}
export function refreshBoardingPassenger(section,record,{profile,resetName=false}={}) {
  const panel=section.querySelector('[data-bcbp-generator]');if(!panel)return;
  const previous=panel.querySelector('[data-bcbp-passenger-field]');
  if(!hasChineseName(record.passenger)){previous?.remove();return;}
  const values=boardingGeneratorValues(resetName ? {...record,boardingCode:''} : record,{profile});
  if(resetName && previous)previous.remove();
  if(resetName || !previous)panel.querySelector('.form-grid').insertAdjacentHTML('afterbegin',englishPassengerField(values,record,{profile}));
  setBoardingGeneratorAvailability(section,record);
}
export function refreshBoardingGenerator(section,record,{profile}={}) {
  refreshBoardingPassenger(section,record,{profile});
  const values=boardingGeneratorValues(record,{profile});
  for(const input of section.querySelectorAll('[data-bcbp]')){
    const value=values[input.dataset.bcbp] || '';
    input.value=value;
    const badge=input.closest('.field').querySelector('[data-field-source]');if(badge)badge.outerHTML=generatorBadge(input.dataset.bcbp,values,record,profile);
  }
  setBoardingGeneratorAvailability(section,record);
}

export function setBoardingGeneratorAvailability(section,record) {
  const disabled=!!record.boardingCode && record.boardingCodeSource!=='generated';
  const fields=section.querySelector('[data-bcbp-fields]');if(fields)fields.disabled=disabled;
  for(const input of section.querySelectorAll('[data-bcbp]'))input.disabled=disabled;
}
