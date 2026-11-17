import {BOARDING_SHARED_FIELDS,refreshGeneratedCode,boardingCodeDifferences} from './boarding-code-state.js';
import {JOURNEY_DATE_FIELDS,journeyDate,daysInYear} from './journey-date.js';
import {readTicketDate,writeTicketDate} from './date-field.js';
import {readBoardingCode} from './bcbp.js';
import {BOARDING_METADATA_FIELDS,boardingMetadataValues} from './boarding-metadata.js';
import {flightPassengerName} from './flight-passenger.js';
import {normalizePlaces} from './places.js';
import {markManualFields} from './lookup-values.js';
import {fieldSourceBadge,markFieldSources,refreshFieldSources} from './field-sources.js';
import {barcodeFieldLocked,refreshBarcodeFieldLocks} from './barcode-fields.js';
import { codeCameraMarkup, bindCodeCamera } from './code-camera.js';
import { renderCodeData } from './barcode-data.js';
import { normalizeTicketCode } from './ticket-code.js';
import { normalizeBoardingCode } from './boarding-code.js';
import {boardingGeneratorMarkup,bindBoardingGenerator,refreshBoardingGenerator,setBoardingGeneratorAvailability} from './boarding-code-generator.js';

const configuration = record => record.type === 'flight' ? { field: 'boardingCode', title: '登机牌条码或电子登机牌二维码', normalize: normalizeBoardingCode } : { field: 'ticketCode', title: '二维码', normalize: normalizeTicketCode };
const thumbnail = (code, title) => code ? `${renderCodeData(code)}<span>已收录</span>` : `<span class="fine-print">尚未收录${title}</span>`;
export function ticketCodeEditor(record, fromScan = false, prefix = '', {generator=true} = {}) {
  const { field, title, normalize } = configuration(record);
  const markup = `<section data-code-editor data-code-prefix="${prefix}" class="editor-extra" id="code-editor"><h3>${title}${fieldSourceBadge(field,record)}</h3><div class="saved-code" id="saved-code">${thumbnail(normalize(record[field]), title)}</div><div class="code-actions">${fromScan ? '<button type="button" class="button small secondary" id="code-use-scan">读取本次图片中的码</button>' : ''}<button type="button" class="button small secondary" data-code-start>相机扫描</button><label class="button small secondary">上传图片<input id="code-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden /></label><button type="button" class="button small secondary" id="code-remove" ${record[field] ? '' : 'hidden'}>移除</button></div>${codeCameraMarkup()}${generator ? boardingGeneratorMarkup(record) : ''}<p class="fine-print" id="code-status" role="status"></p><p id="code-consistency" class="code-consistency" role="status" hidden></p><div id="code-choices" class="code-choices" hidden></div><button type="button" class="text-button" id="code-cancel" hidden>取消选择</button><p class="form-error" id="code-error" role="alert"></p></section>`;
  return markup.replace(/id="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`);
}
export function bindTicketCodeEditor(form, draft, changed, { referenceURL = '', autoRead = false, profile, onMultiple, loadRebuilder = async () => (await import('./code-reader.js')).rebuildCodesFromImage, cameraOptions = {} } = {}) {
  const section = form.querySelector('[data-code-editor]'); if (!section) return () => {};
  const find = id => section.querySelector('#' + section.dataset.codePrefix + id);
  const { field, title, normalize } = configuration(draft), photo = find('code-photo'), status = find('code-status'), error = find('code-error'), choices = find('code-choices'), cancel = find('code-cancel');
  let generation = 0, disposed = false, loading = false, pending = false, updateTimer;
  const consistency=find('code-consistency');
  function reset() { generation++; loading = false; pending = false; choices.replaceChildren(); choices.hidden = true; cancel.hidden = true; photo.value = ''; }
  function showSaved() { find('saved-code').innerHTML = thumbnail(draft[field], title); find('code-remove').hidden = !draft[field]; }
  function currentRecord() {
    const record={...draft};
    for(const key of BOARDING_SHARED_FIELDS)if(form.elements[key] && !barcodeFieldLocked(draft,key))record[key]=JOURNEY_DATE_FIELDS.includes(key)?readTicketDate(form,key,draft):form.elements[key].value;
    return normalizePlaces(record);
  }
  function showDifferences(record=currentRecord()) {
    const differences=boardingCodeDifferences(record);
    consistency.textContent=differences.length ? '原码与票面信息不同：'+differences.join('、')+'。原码已保留，请核对。' : '';
    consistency.hidden=!consistency.textContent;
  }
  function clearGeneratedError() {
    if(error.dataset.generatedError){error.textContent='';delete error.dataset.generatedError;}
    const alert=form.querySelector('#editor-error');if(alert?.dataset.codeError){alert.textContent='';alert.hidden=true;delete alert.dataset.codeError;}
  }
  function updateGenerated(force=false) {
    clearTimeout(updateTimer);
    if(disposed || draft.type!=='flight')return true;
    if(draft.boardingCodeSource!=='generated'){showDifferences();return true;}
    try {
      const record=currentRecord(),updated=refreshGeneratedCode(record);
      if(updated){draft.boardingCode=record.boardingCode;showSaved();status.textContent='已随票面更新条码';changed({automatic:true});}
      consistency.hidden=true;
      clearGeneratedError();
      return true;
    }catch(failure){
      consistency.textContent='条码待更新，请补全或修正票据信息';consistency.hidden=false;
      if(force){
        error.textContent=failure.message;error.dataset.generatedError='true';
        const alert=form.querySelector('#editor-error');if(alert){alert.textContent=failure.message;alert.hidden=false;alert.dataset.codeError='true';}
        const input=form.elements[failure.fields?.[0]] || form.querySelector('[data-bcbp="operatingFlight"]');
        input?.scrollIntoView?.({block:'center'});input?.focus();
      }
      return false;
    }
  }
  function use(code,generated=false,settings={}) {
    const previousRecord={...draft};
    draft[field] = normalize(code.data);
    const filled=[];
    markManualFields(draft,[field]);
    markFieldSources(draft,[field],generated ? 'generated' : 'barcode');
    if(draft.type==='flight'){
      draft.boardingCodeSource=generated ? 'generated' : 'original';
      draft.boardingLegIndex=String(code.legIndex ?? 0);
      draft.boardingCodeOperatingFlight=generated ? settings.operatingFlight || '' : '';
      const read=!generated && readBoardingCode(draft.boardingCode,draft.boardingLegIndex);
      if(read){
        const year=read.legCount===1||previousRecord.service===read.service ? journeyDate(previousRecord.departureDate)?.year : null;
        draft.departureDate={year:year&&read.dayOfYear<=daysInYear(year)?year:null,dayOfYear:read.dayOfYear};
        markFieldSources(draft,['departureDate'],'barcode');writeTicketDate(form,'departureDate',draft.departureDate);
        const values={...Object.fromEntries([...BOARDING_METADATA_FIELDS,'actualBoardingTime'].map(key=>[key,undefined])),passenger:flightPassengerName({type:'flight',originCode:read.originCode,destinationCode:read.destinationCode},read),pnr:read.pnr,service:read.service,seat:read.seat,seatClass:read.cabin,airline:read.airline,ticketNumber:read.ticketNumber,gate:read.gate,...boardingMetadataValues(read)};
        for(const side of ['origin','destination']){values[side]=read[side+'Code'];values[side+'Code']=read[side+'Code'];}
        for(const [key,value] of Object.entries(values))if(!value && previousRecord.fieldSources?.[key]==='barcode'){draft[key]='';draft.fieldSources={...draft.fieldSources};delete draft.fieldSources[key];filled.push(key);}
        for(const [key,value] of Object.entries(values))if(value){draft[key]=value;markFieldSources(draft,[key],'barcode');draft.lockedFields=draft.lockedFields.filter(field=>field!==key);if(draft.lookupValues)delete draft.lookupValues[key];filled.push(key);}
        normalizePlaces(draft);
        for(const key of filled)if(form.elements[key])form.elements[key].value=draft[key];
        if(filled.includes('seatClass')){
          const preset=form.querySelector('[data-seat-preset]'),input=form.elements.seatClass;
          if(preset && input && [...preset.options].some(option=>option.value===draft.seatClass)){
            preset.value=draft.seatClass;input.hidden=true;input.required=false;
          }
        }
      }
      refreshBoardingGenerator(form,draft,{profile});
    }
    refreshFieldSources(form,draft);
    refreshBarcodeFieldLocks(form,draft);
    reset();clearGeneratedError();showSaved();showDifferences();status.textContent=generated ? '已生成并使用 '+code.format+' 基础 BCBP' : '已读取并重建 '+code.format+'，重新编码后信息已核对';error.textContent='';const generatorError=form.querySelector('[data-bcbp-error]');if(generatorError)generatorError.textContent='';changed({filled,previousRecord});
  }
  async function read(file, automatic = false) {
    reset(); const request = generation; loading = true; status.textContent = '正在读取并重建条码…'; error.textContent = '';
    try {
      const rebuild = await loadRebuilder(), result = await rebuild(file, draft.type);
      if (disposed || request !== generation || !section.isConnected) return;
      loading = false;
      if (!result.codes.length) { status.textContent = ''; if (!automatic || result.issues.length) {  error.textContent = result.issues[0] || '未识别到可重建的码，请选择显示完整二维码或条码的图片'; } return; }
      const first=draft.type==='flight'&&result.codes.length===1 ? readBoardingCode(result.codes[0].data) : null;
      if(first?.legCount>1&&onMultiple){onMultiple(result.codes[0].data,currentRecord());return true;}
      const available=result.codes.flatMap(code=>{
        const read=draft.type==='flight'&&readBoardingCode(code.data);
        return read?.legCount>1 ? read.legs.map((leg,index)=>({...code,legIndex:index,label:`第 ${index+1} 段 · ${leg.service} ${leg.origin} → ${leg.destination}`})) : [code];
      });
      if (available.length === 1 && (!automatic || !available[0].isLink)) { use(available[0]); return true; }
      pending = true; status.textContent = '请选择本张票据对应的码'; choices.hidden = false; cancel.hidden = false;
      for (const code of available) {
        const button = form.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'code-choice';
        button.innerHTML = renderCodeData(normalize(code.data));
        const label = form.ownerDocument.createElement('span'); label.textContent = code.label || code.format + ' · 使用此码'; button.append(label); button.addEventListener('click', () => use(code)); choices.append(button);
      }
      return true;
    } catch (failure) { if (!disposed && request === generation) { loading = false; status.textContent = ''; error.textContent = failure.message || '条码读取失败，请换一张清晰图片';  } }
  }
  async function readReference(automatic = false) {
    const request = generation; loading = true; status.textContent = '正在读取并重建条码…';
    try { const response = await fetch(referenceURL); if (!response.ok) throw new Error('本次图片无法读取'); const file = await response.blob(); if (!disposed && request === generation) await read(file, automatic); }
    catch (failure) { if (!disposed && request === generation) { loading = false; status.textContent = ''; error.textContent = failure.message;  } }
  }
  const camera = bindCodeCamera(section, file => read(file, true), { ...cameraOptions, onCancel: () => { reset(); status.textContent = ''; } });
  const generator=bindBoardingGenerator(form,draft,use,message=>{error.textContent=message;const target=form.querySelector('[data-bcbp-error]');if(target)target.textContent=message;},()=>{camera.stop();reset();},{profile});
  photo.addEventListener('change', () => { const file = photo.files?.[0]; if (file) { camera.stop(); read(file); } });
  find('code-use-scan')?.addEventListener('click', () => readReference());
  find('code-remove').addEventListener('click', () => { reset(); draft[field] = ''; if(draft.type==='flight'){draft.boardingCodeSource='';draft.boardingCodeOperatingFlight='';draft.boardingLegIndex='';}markManualFields(draft,[field]);consistency.hidden=true; clearGeneratedError();setBoardingGeneratorAvailability(form,draft); refreshFieldSources(form,draft);refreshBarcodeFieldLocks(form,draft); status.textContent = ''; error.textContent = ''; showSaved(); changed(); });
  cancel.addEventListener('click', () => { reset(); status.textContent = ''; error.textContent = ''; });
  const inputChanged=event=>{
    if(event.target.closest('[data-code-editor]'))return;
    if(barcodeFieldLocked(draft,event.target.name)){refreshBarcodeFieldLocks(form,draft);return;}
    if(BOARDING_SHARED_FIELDS.includes(event.target.closest('[data-journey-date]')?.dataset.journeyDate || event.target.name) || event.target.matches('[data-seat-number]')){
      clearTimeout(updateTimer);
      if(draft.boardingCodeSource==='generated'){consistency.textContent='条码待更新…';consistency.hidden=false;}
      updateTimer=setTimeout(()=>{if(section.isConnected)updateGenerated();},150);
    }
  };
  const submit=event=>{
    if(disposed)return;
    if(loading || pending){event.preventDefault();event.stopImmediatePropagation();error.textContent=loading ? '正在读取条码，请稍候' : '请先选择对应的码，或取消选择';}
    else if(!updateGenerated(true)){event.preventDefault();event.stopImmediatePropagation();}
  };
  form.addEventListener('input',inputChanged);form.addEventListener('submit',submit,true);
  if(draft.type==='flight'){refreshBoardingGenerator(form,draft,{profile});showDifferences();}
  refreshBarcodeFieldLocks(form,draft);
  if (autoRead && referenceURL && !draft[field]) readReference(true);
  return () => { disposed = true; clearTimeout(updateTimer);form.removeEventListener('input',inputChanged);form.removeEventListener('submit',submit,true);generator(); camera.dispose(); reset(); };
}
