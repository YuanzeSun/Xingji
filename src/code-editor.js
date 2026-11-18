import {BOARDING_FIELDS,BOARDING_SHARED_FIELDS,boardingCodeDifferences,clearGeneratedCode} from './boarding-code-state.js';
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
import {boardingGeneratorMarkup,automaticBoardingCode,editBoardingGeneratorField,readBoardingGenerator,refreshBoardingGenerator,setBoardingGeneratorAvailability} from './boarding-code-generator.js';

const configuration = record => record.type === 'flight' ? { field: 'boardingCode', title: '登机牌条码或电子登机牌二维码', normalize: normalizeBoardingCode } : { field: 'ticketCode', title: '二维码', normalize: normalizeTicketCode };
const removable = (record,field) => !!record[field] && record.boardingCodeSource!=='generated';
const thumbnail = (code, title) => code ? `${renderCodeData(code)}<span>已收录</span>` : `<span class="fine-print">尚未收录${title}</span>`;
export function ticketCodeEditor(record, fromScan = false, prefix = '', {generator=true} = {}) {
  const { field, title, normalize } = configuration(record);
  const markup = `<section data-code-editor data-code-prefix="${prefix}" class="editor-extra" id="code-editor"><h3>${title}${fieldSourceBadge(field,record)}</h3><div class="saved-code" id="saved-code">${thumbnail(normalize(record[field]), title)}</div><div class="code-actions">${fromScan ? '<button type="button" class="button small secondary" id="code-use-scan">读取本次图片中的码</button>' : ''}<button type="button" class="button small secondary" data-code-start>相机扫描</button><label class="button small secondary">上传图片<input id="code-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden /></label><button type="button" class="button small secondary" id="code-remove" ${removable(record,field) ? '' : 'hidden'}>移除</button></div>${codeCameraMarkup()}${generator ? boardingGeneratorMarkup(record) : ''}<p class="fine-print" id="code-status" role="status"></p><p id="code-consistency" class="code-consistency" role="status" hidden></p><div id="code-choices" class="code-choices" hidden></div><button type="button" class="text-button" id="code-cancel" hidden>取消选择</button><p class="form-error" id="code-error" role="alert"></p></section>`;
  return markup.replace(/id="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`);
}
export function bindTicketCodeEditor(form, draft, changed, { referenceURL = '', autoRead = false, profile, preserveGenerator = false, onMultiple, loadRebuilder = async () => (await import('./code-reader.js')).rebuildCodesFromImage, cameraOptions = {} } = {}) {
  const section = form.querySelector('[data-code-editor]'); if (!section) return () => {};
  const find = id => section.querySelector('#' + section.dataset.codePrefix + id);
  const { field, title, normalize } = configuration(draft), photo = find('code-photo'), status = find('code-status'), error = find('code-error'), choices = find('code-choices'), cancel = find('code-cancel');
  let generation = 0, disposed = false, loading = false, pending = false, updateTimer;
  const consistency=find('code-consistency');
  function reset() { generation++; loading = false; pending = false; choices.replaceChildren(); choices.hidden = true; cancel.hidden = true; photo.value = ''; }
  function showSaved() { find('saved-code').innerHTML = thumbnail(draft[field], title); find('code-remove').hidden = !removable(draft,field); }
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
  function updateGenerated() {
    clearTimeout(updateTimer);
    if(disposed || draft.type!=='flight' || loading || pending)return;
    if(draft.boardingCode && draft.boardingCodeSource!=='generated'){
      showDifferences();
      return;
    }
    if(!form.querySelector('[data-bcbp-fields]'))return;
    let result;
    try { result=automaticBoardingCode(currentRecord(),readBoardingGenerator(form),{profile}); }
    catch { result=null; }
    const previous=draft.boardingCodeSource==='generated' ? draft.boardingCode : null;
    if(result && (previous?.rawBytes!==result.code.rawBytes || previous?.format!==result.code.format || draft.boardingCodeOperatingFlight!==result.operatingFlight)){
      draft.boardingCode=result.code;
      draft.boardingCodeSource='generated';
      draft.boardingLegIndex='0';
      draft.boardingCodeOperatingFlight=result.operatingFlight;
      markFieldSources(draft,[field],'generated');
    } else if(!result && previous){
      clearGeneratedCode(draft);
    } else {
      return;
    }
    showSaved();
    status.textContent=result ? '条码已自动生成' : '';
    changed({automatic:true});
  }
  function use(code) {
    const previousRecord={...draft};
    draft[field] = normalize(code.data);
    const filled=[];
    markManualFields(draft,[field]);
    markFieldSources(draft,[field],'barcode');
    if(draft.type==='flight'){
      draft.boardingCodeSource='original';
      draft.boardingLegIndex=String(code.legIndex ?? 0);
      draft.boardingCodeOperatingFlight='';
      const read=readBoardingCode(draft.boardingCode,draft.boardingLegIndex);
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
    reset();showSaved();showDifferences();status.textContent='已读取并重建 '+code.format+'，重新编码后信息已核对';error.textContent='';changed({filled,previousRecord});
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
  const camera = bindCodeCamera(section, image => read(image, true), { asCanvas: draft.type === 'flight', ...cameraOptions, onCancel: () => { reset(); status.textContent = ''; } });
  photo.addEventListener('change', () => { const file = photo.files?.[0]; if (file) { camera.stop(); read(file); } });
  find('code-use-scan')?.addEventListener('click', () => readReference());
  find('code-remove').addEventListener('click', () => {
    if(!removable(draft,field))return;
    reset();
    draft[field]='';
    if(draft.type==='flight'){
      for(const key of BOARDING_FIELDS)draft[key]='';
      refreshBoardingGenerator(form,draft,{profile});
    }
    markManualFields(draft,[field]);
    consistency.hidden=true;
    refreshFieldSources(form,draft);refreshBarcodeFieldLocks(form,draft);
    status.textContent='';error.textContent='';showSaved();changed();
  });
  cancel.addEventListener('click', () => { reset(); status.textContent = ''; error.textContent = ''; updateGenerated(); });
  const inputChanged=event=>{
    if(draft.type!=='flight')return;
    const input=event.target, extra=input.matches('[data-bcbp]');
    if(extra){
      if(input.disabled)return;
      editBoardingGeneratorField(input);
    } else {
      if(input.closest('[data-code-editor]'))return;
      if(barcodeFieldLocked(draft,input.name)){refreshBarcodeFieldLocks(form,draft);return;}
      if(!BOARDING_SHARED_FIELDS.includes(input.closest('[data-journey-date]')?.dataset.journeyDate || input.name) && !input.matches('[data-seat-preset]'))return;
    }
    clearTimeout(updateTimer);
    updateTimer=setTimeout(()=>{if(section.isConnected)updateGenerated();},150);
  };
  const submit=event=>{
    if(disposed)return;
    if(loading || pending){event.preventDefault();event.stopImmediatePropagation();error.textContent=loading ? '正在读取条码，请稍候' : '请先选择对应的码，或取消选择';}
    else updateGenerated();
  };
  form.addEventListener('input',inputChanged);form.addEventListener('change',inputChanged);form.addEventListener('submit',submit,true);
  if(draft.type==='flight'){
    if(preserveGenerator)setBoardingGeneratorAvailability(form,draft);
    else refreshBoardingGenerator(form,draft,{profile});
    if(draft.boardingCode && draft.boardingCodeSource!=='generated')showDifferences();
    else updateGenerated();
  }
  refreshBarcodeFieldLocks(form,draft);
  if (autoRead && referenceURL && !draft[field]) readReference(true);
  return () => { disposed = true; clearTimeout(updateTimer);form.removeEventListener('input',inputChanged);form.removeEventListener('change',inputChanged);form.removeEventListener('submit',submit,true); camera.dispose(); reset(); };
}
