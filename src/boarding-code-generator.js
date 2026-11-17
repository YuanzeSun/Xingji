import {journeyDate} from './journey-date.js';
import {operatingFlight} from './boarding-code-state.js';
import {escape as e} from './html.js';
import {boardingCodeDefaults,createBoardingCode,BCBP_FORMATS} from './bcbp.js';
import {hasChineseName} from './flight-passenger.js';
import {fieldSourceBadge} from './field-sources.js';

const requiredMark='<b class="required-mark barcode-required-mark" aria-label="生成条码必填">*</b>';
function generatorBadge(key,values,record,profile) {
  const kind=record.boardingCode ? record.boardingCodeSource==='generated' ? 'generated' : 'barcode' : key==='passenger' && profile && values.passenger ? 'profile' : ['format','electronic'].includes(key) ? 'default' : '';
  const field='bcbp:'+key;
  return fieldSourceBadge(field,{[field]:key==='electronic' ? values[key] || '无' : values[key],fieldSources:{[field]:kind}});
}
const englishPassengerField=(values,record,{profile}={})=>`<label class="field" data-bcbp-passenger-field><span>条码英文姓名${requiredMark}${generatorBadge('passenger',values,record,profile)}</span><input data-bcbp="passenger" value="${e(values.passenger || '')}" maxlength="20" placeholder="姓/名，如：ZHANG/SAN" autocomplete="off" spellcheck="false" aria-required="true" /></label>`;
export function boardingGeneratorMarkup(record,{profile}={}) {
  if(record.type!=='flight')return '';
  const values=boardingGeneratorValues(record,{profile});

  const select=(key,label,options,required=false)=>`<label class="field"><span>${label}${required?requiredMark:''}${generatorBadge(key,values,record,profile)}</span><select data-bcbp="${key}" ${required?'aria-required="true"':''}>${options.map(([value,text])=>`<option value="${e(value)}" ${values[key]===value?'selected':''}>${e(text)}</option>`).join('')}</select></label>`;
  const input=(key,label,max,placeholder,required=false)=>`<label class="field"><span>${label}${required?requiredMark:''}${generatorBadge(key,values,record,profile)}</span><input data-bcbp="${key}" value="${e(values[key]||'')}" maxlength="${max}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" ${required?'aria-required="true"':''} ${key==='status'?'inputmode="numeric"':''}/></label>`;
  return `<div class="boarding-generator" data-bcbp-generator><h4>填写信息生成条码<span class="barcode-required-legend">蓝色 * 为生成条码必填</span></h4><fieldset data-bcbp-fields${record.boardingCode && record.boardingCodeSource!=='generated' ? ' disabled' : ''}><div class="form-grid">${hasChineseName(record.passenger)?englishPassengerField(values,record,{profile}):''}${input('sequence','值机序号（SEQ）',5,'如：25',true)}${input('status','打印时旅客状态',1,'如：1（已值机）',true)}${select('format','条码格式',BCBP_FORMATS.map(format=>[format,format==='PDF417'?'PDF417（纸质登机牌常用）':format==='QRCode'?'QR Code':format]),true)}${select('electronic','电子客票标记',[['','无'],['E','E · 电子客票']])}${input('operatingFlight','实际承运航班（代码共享时填写）',9,'如：CA1234')}</div><button type="button" class="button small primary" data-bcbp-generate>生成并使用</button></fieldset><p class="form-error" role="alert" data-bcbp-error></p></div>`;
}

export function bindBoardingGenerator(section,draft,onUse,onError,onStart,{profile}={}) {
  const panel=section.querySelector('[data-bcbp-generator]');if(!panel)return ()=>{};
  const form=section.closest('form');
  const sharedFields=['passenger','pnr','origin','destination','originCode','destinationCode','service','departureDate','seat','seatClass'];
  const edit=event=>{
    const input=event.target;if(!input.matches('[data-bcbp]'))return;
    if(input.tagName==='INPUT'){
      const start=input.selectionStart,end=input.selectionEnd;input.value=input.value.toUpperCase();
      if(start!==null)input.setSelectionRange(start,end);
    }
    const field='bcbp:'+input.dataset.bcbp,badge=input.closest('.field').querySelector('[data-field-source]');
    if(badge)badge.outerHTML=fieldSourceBadge(field,{[field]:input.value || (input.dataset.bcbp==='electronic' ? '无' : ''),fieldSources:{[field]:'manual'}});
  };
  const click=event=>{
    if(!event.target.closest('[data-bcbp-generate]') || (draft.boardingCode && draft.boardingCodeSource!=='generated'))return;
    try{
      const record={...draft};
      for(const key of sharedFields)if(form?.elements[key])record[key]=form.elements[key].value;
      const values={...boardingCodeDefaults(record,{useSaved:false,profile}),...Object.fromEntries([...panel.querySelectorAll('[data-bcbp]')].map(input=>[input.dataset.bcbp,input.value]))};
      Object.assign(values,operatingFlight(values.operatingFlight));
      const checks=[['passenger',values.passenger,/^[A-Z][A-Z .'-]*\/[A-Z .'-]+$/,'请在旅客姓名中按“姓/名”填写英文姓名'],['pnr',values.pnr,/^[A-Z0-9]{1,7}$/i,'请填写订座编号 PNR'],['departureDate',journeyDate(values.date)?.dayOfYear || '',/^\d+$/,'请填写航班月日']];
      for(const [key,value,pattern,message]of checks)if(!pattern.test(value)){(panel.querySelector(`[data-bcbp="${key}"]`) || form?.elements[key])?.focus();throw new Error(key==='passenger' ? '请按“姓/名”填写条码英文姓名' : message);}
      const code=createBoardingCode(values,values.format);onStart();onUse({format:values.format,data:code},true,{operatingFlight:values.operatingFlight.trim().toUpperCase().replace(/\s/g,'')});
    }catch(error){onError(error.message);}
  };
  panel.addEventListener('input',edit);panel.addEventListener('change',edit);panel.addEventListener('click',click);
  return ()=>{panel.removeEventListener('input',edit);panel.removeEventListener('change',edit);panel.removeEventListener('click',click);};
}

export function boardingGeneratorValues(record,{profile}={}) {
  const values=boardingCodeDefaults(record,{profile}),current=boardingCodeDefaults(record,{useSaved:false,profile});
  values.operatingFlight='';
  if(record.boardingCodeSource==='generated')values.operatingFlight=record.boardingCodeOperatingFlight || '';
  else if(values.carrier && current.carrier && values.carrier+values.flightNumber!==current.carrier+current.flightNumber)values.operatingFlight=values.carrier+values.flightNumber;
  return values;
}
export function refreshBoardingPassenger(section,record,{profile}={}) {
  const panel=section.querySelector('[data-bcbp-generator]');if(!panel)return;
  const previous=panel.querySelector('[data-bcbp-passenger-field]');
  if(!hasChineseName(record.passenger)){previous?.remove();return;}
  const values=boardingGeneratorValues(record,{profile});
  if(previous)previous.querySelector('input').value=values.passenger || '';
  else panel.querySelector('.form-grid').insertAdjacentHTML('afterbegin',englishPassengerField(values,record,{profile}));
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
  const button=section.querySelector('[data-bcbp-generate]');if(button){button.disabled=disabled;button.textContent=disabled ? '已使用原条码' : '生成并使用';}
}
