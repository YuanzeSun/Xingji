import {BOARDING_FIELDS,BOARDING_SHARED_FIELDS,boardingCodeDifferences,clearGeneratedCode} from './boarding-code-state.js';
import {JOURNEY_DATE_FIELDS,journeyDate,daysInYear} from './journey-date.js';
import {readTicketDate,writeTicketDate} from './date-field.js';
import {readBoardingCode} from './bcbp.js';
import {BOARDING_METADATA_FIELDS,boardingMetadataValues} from './boarding-metadata.js';
import {flightPassengerName} from './flight-passenger.js';
import {normalizePlaces} from './places.js';
import {markManualFields} from './lookup-values.js';
import {fieldSourceBadge,markFieldSources,railBarcodeFieldLocked,refreshFieldSources} from './field-sources.js';
import {barcodeFieldLocked,refreshBarcodeFieldLocks} from './barcode-fields.js';
import { codeCameraMarkup, bindCodeCamera } from './code-camera.js';
import { renderCodeData } from './barcode-data.js';
import { isLinearTicketCode, normalizeTicketCode } from './ticket-code.js';
import { supportsGeneratedRailQR } from './rail-ticket-qr.js';
import { isAnonymousRedTemplate } from './rail-template.js';
import { normalizeBoardingCode } from './boarding-code.js';
import { DEMO_BOARDING_CODE } from './demo-boarding-code.js';
import { DEMO_RAIL_LINEAR_CODE, DEMO_RAIL_TICKET_CODE, DEMO_TICKET_CODE } from './demo-code.js';
import {boardingGeneratorMarkup,automaticBoardingCode,editBoardingGeneratorField,readBoardingGenerator,refreshBoardingGenerator,setBoardingGeneratorAvailability} from './boarding-code-generator.js';

const configuration = record => record.type === 'flight' ? { field: 'boardingCode', title: '登机牌条码或电子登机牌二维码', normalize: normalizeBoardingCode } : { field: 'ticketCode', title: '条码', normalize: normalizeTicketCode };
const removable = (record,field) => !!record[field] && record.boardingCodeSource!=='generated';
const thumbnail = (code, title) => code ? `${renderCodeData(code)}<span>已收录</span>` : `<span class="fine-print">尚未收录${title}</span>`;
let boardingExamples, railQRExample, railLinearExample;
function boardingExamplesMarkup(hidden) {
  boardingExamples ??= `<div class="boarding-code-sample"><span class="boarding-code-sample-image" aria-hidden="true">${renderCodeData(DEMO_BOARDING_CODE)}</span><span>纸质登机牌 · PDF417</span></div>
    <div class="boarding-code-sample"><span class="boarding-code-sample-image" aria-hidden="true">${renderCodeData(DEMO_TICKET_CODE)}</span><span>电子登机牌 · 二维码</span></div>`;
  return `<figure class="boarding-code-examples" data-code-examples ${hidden ? 'hidden' : ''}><figcaption>扫码示例</figcaption>${boardingExamples}</figure>`;
}
function railExampleMarkup(record) {
  const linear = record.template === 'rail-red-barcode';
  const example = linear ? (railLinearExample ??= renderCodeData(DEMO_RAIL_LINEAR_CODE))
    : (railQRExample ??= renderCodeData(DEMO_RAIL_TICKET_CODE));
  return `<figure class="boarding-code-examples rail-code-example${linear ? ' rail-linear-example' : ''}" data-code-examples ${record.ticketCode ? 'hidden' : ''}><figcaption>扫码示例</figcaption><div class="boarding-code-sample"><span class="boarding-code-sample-image" aria-hidden="true">${example}</span><span>${linear ? '虚构一维条码' : '虚构车票二维码'}</span></div></figure>`;
}
export function ticketCodeEditor(record, { fromScan = false, generator = true } = {}) {
  const { field, title, normalize } = configuration(record);
  const flight = record.type === 'flight';
  const referenceButton = fromScan ? `<button type="button" class="button small secondary" id="code-use-scan" ${record[field] ? 'hidden' : ''}>读取本次图片中的码</button>` : '';
  const upload = '<button type="button" class="button small secondary" data-code-upload>上传图片</button><input id="code-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden />';
  const saved = normalize(record[field]);
  const controls = `<div class="saved-code" id="saved-code" ${!flight && !saved ? 'hidden' : ''}>${thumbnail(saved, title)}</div><div class="code-actions">${referenceButton}<button type="button" class="button small secondary" data-code-start>相机扫描</button>${upload}<button type="button" class="button small secondary" id="code-remove" ${removable(record,field) ? '' : 'hidden'}>移除</button></div>`;
  let guidance = flight ? '请扫描自己登机牌上的完整码。' : '请对准票面上的二维码或一维条码。';
  if (!flight && supportsGeneratedRailQR(record.template)) {
    const required = isAnonymousRedTemplate(record.template) ? '行程和底部售票码' : '行程、底部售票码及实名信息';
    guidance = `可扫描票面原码。填齐${required}后可自动生成。`;
  }
  const scan = `<div class="boarding-code-scan"><div class="boarding-code-controls">${controls}<p class="fine-print" data-code-guidance ${record[field] ? 'hidden' : ''}>${guidance}</p></div>${flight ? boardingExamplesMarkup(record[field]) : railExampleMarkup(record)}</div>`;
  return `<section data-code-editor class="editor-extra${flight ? '' : ' full-field rail-code-entry'}" ${flight ? '' : 'data-rail-code-entry'} id="code-editor"><h3>${flight ? title : '扫码录入'}${fieldSourceBadge(field,record)}</h3>${scan}${codeCameraMarkup()}${flight && generator ? boardingGeneratorMarkup(record) : ''}<p class="fine-print" id="code-status" role="status"></p><p id="code-consistency" class="code-consistency" role="status" hidden></p><div id="code-choices" class="code-choices" hidden></div><button type="button" class="text-button" id="code-cancel" hidden>取消选择</button><p class="form-error" id="code-error" role="alert"></p></section>`;
}
export function bindTicketCodeEditor(form, draft, changed, { referenceURL = '', autoRead = false, profile, preserveGenerator = false, onCameraStart, isCurrent = () => true, loadRebuilder = async () => (await import('./code-reader.js')).rebuildCodesFromImage, cameraOptions = {} } = {}) {
  const section = form.querySelector('[data-code-editor]'); if (!section) return () => {};
  const find = id => section.querySelector('#' + id);
  const { field, title, normalize } = configuration(draft), photo = find('code-photo'), status = find('code-status'), error = find('code-error'), choices = find('code-choices'), cancel = find('code-cancel');
  const flight = draft.type === 'flight';
  let generation = 0, disposed = false, loading = false, pending = false, updateTimer;
  const consistency=find('code-consistency');
  function reset() { generation++; loading = false; pending = false; choices.replaceChildren(); choices.hidden = true; cancel.hidden = true; photo.value = ''; }
  function showSaved() {
    const saved = find('saved-code');
    saved.innerHTML = thumbnail(draft[field], title);
    saved.hidden = !flight && !draft[field];
    find('code-remove').hidden = !removable(draft,field);
    const reference = find('code-use-scan');
    if (reference) reference.hidden = !!draft[field];
    for (const element of section.querySelectorAll('[data-code-examples], [data-code-guidance]')) element.hidden = !!draft[field];
  }
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
    if(disposed || !flight || loading || pending)return;
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
    if (!isCurrent()) return;
    const previousRecord={...draft};
    draft[field] = normalize(code.data);
    const filled=[];
    markManualFields(draft,[field]);
    markFieldSources(draft,[field],'barcode');
    if(!flight){
      if (isLinearTicketCode(draft[field])) draft.template = 'rail-red-barcode';
      else if (draft.template === 'rail-red-barcode') draft.template = 'rail-red-qr';
      if (draft.template !== previousRecord.template) markFieldSources(draft, ['template'], 'barcode');
      const values=code.railFields;
      const previousLocks=draft.lockedFields.filter(key=>railBarcodeFieldLocked(previousRecord,key));
      draft.lockedFields=draft.lockedFields.filter(key=>!previousLocks.includes(key));
      if(values){
        for(const key of previousLocks)if(!Object.hasOwn(values,key)){
          draft[key]=key==='railStanding' ? false : '';
          delete draft.fieldSources[key];
          filled.push(key);
        }
        Object.assign(draft,values);
        markFieldSources(draft,Object.keys(values),'barcode');
        for(const key of Object.keys(values)){
          if(draft[key] && !draft.lockedFields.includes(key))draft.lockedFields.push(key);
          if(draft.lookupValues)delete draft.lookupValues[key];
          if(JOURNEY_DATE_FIELDS.includes(key))writeTicketDate(form,key,draft[key]);
          else if(form.elements[key])form.elements[key].value=draft[key];
          filled.push(key);
        }
        if(values.departureDate && !previousRecord.departureDate?.year)markFieldSources(draft,['departureDateYear'],'default');
        if(previousRecord.departureDate && !draft.departureDate)delete draft.fieldSources.departureDateYear;
        draft.lockedFields.sort();
      }
    }
    if(flight){
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
    reset();showSaved();
    if (flight) showDifferences();
    if (code.railFields) status.textContent = '已扫码录入，二维码字段已锁定';
    else if (!flight && isLinearTicketCode(draft[field])) status.textContent = '已收录一维条码，可继续录入车票信息';
    else status.textContent = '已读取并重建 ' + code.format + '，重新编码后信息已核对';
    error.textContent='';changed({filled,previousRecord,codeStatus:status.textContent,railFields:code.railFields});
  }
  async function read(file, source = 'manual', options) {
    if (!isCurrent()) return;
    reset(); const request = generation; loading = true; status.textContent = '正在读取并重建条码…'; error.textContent = '';
    try {
      const rebuild = await loadRebuilder(), result = await rebuild(file, draft.type, options);
      const readRailTicketCode = !flight && source !== 'photo' && result.codes.some(code => !isLinearTicketCode(code.data))
        ? (await import('./rail-ticket-qr.js')).readRailTicketCode : null;
      if (disposed || request !== generation || !section.isConnected || !isCurrent()) return;
      loading = false;
      if (!result.codes.length) { status.textContent = ''; if (source === 'manual' || result.issues.length) {  error.textContent = result.issues[0] || '未识别到可重建的码，请选择显示完整二维码或条码的图片'; } return; }
      let available=result.codes.flatMap(code=>{
        const read=flight&&readBoardingCode(code.data);
        return read?.legCount>1 ? read.legs.map((leg,index)=>({...code,legIndex:index,label:`第 ${index+1} 段 · ${leg.service} ${leg.origin} → ${leg.destination}`})) : [code];
      });
      if(readRailTicketCode){
        const tickets=available.flatMap(code=>{
          if (isLinearTicketCode(code.data)) return [code];
          const railFields=readRailTicketCode(code.data,journeyDate(draft.departureDate)?.year ?? undefined);
          return railFields ? [{...code,railFields,label:railFields.service+' · '+railFields.ticketNumber}] : [];
        });
        if(tickets.length)available=tickets;
        else if(source==='camera'){
          status.textContent='';
          error.textContent='未读到支持的火车票条码，请对准票面上的码';
          return;
        }
      }
      if (available.length === 1 && (source !== 'camera' || !available[0].isLink)) { use(available[0]); return true; }
      pending = true;
      status.textContent = available.some(code => code.legIndex !== undefined) ? '请选择一个航段录入' : '请选择本张票据对应的码';
      choices.hidden = false; cancel.hidden = false;
      for (const code of available) {
        const button = form.ownerDocument.createElement('button'); button.type = 'button'; button.className = 'code-choice';
        button.innerHTML = renderCodeData(normalize(code.data));
        const label = form.ownerDocument.createElement('span'); label.textContent = code.label || code.format + ' · 使用此码'; button.append(label); button.addEventListener('click', () => use(code)); choices.append(button);
      }
      return true;
    } catch (failure) { if (!disposed && request === generation) { loading = false; status.textContent = ''; error.textContent = failure.message || '条码读取失败，请换一张清晰图片';  } }
  }
  async function readReference(source) {
    const request = generation; loading = true; status.textContent = '正在读取并重建条码…';
    try { const response = await fetch(referenceURL); if (!response.ok) throw new Error('本次图片无法读取'); const file = await response.blob(); if (!disposed && request === generation) await read(file, source); }
    catch (failure) { if (!disposed && request === generation) { loading = false; status.textContent = ''; error.textContent = failure.message;  } }
  }
  const camera = bindCodeCamera(section, (image, options) => read(image, 'camera', options), { asCanvas: flight, ...cameraOptions, onStart:onCameraStart, onCancel: () => { reset(); status.textContent = ''; error.textContent = ''; } });
  form.querySelector('[data-rail-photo]')?.addEventListener('click',camera.stop,true);
  form.querySelector('[data-rail-photo-file]')?.addEventListener('change',camera.stop,true);
  form.querySelector('[data-rail-receipt-file]')?.addEventListener('change',camera.stop,true);
  section.querySelector('[data-code-upload]').addEventListener('click', () => photo.click());
  photo.addEventListener('change', () => { const file = photo.files?.[0]; if (file) { onCameraStart?.(); camera.stop(); read(file); } });
  find('code-use-scan')?.addEventListener('click', () => readReference());
  find('code-remove').addEventListener('click', () => {
    if(!removable(draft,field))return;
    reset();
    if(!flight)draft.lockedFields=draft.lockedFields.filter(key=>!railBarcodeFieldLocked(draft,key));
    draft[field]='';
    if(flight){
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
  form.addEventListener('submit',submit,true);
  if(flight){
    form.addEventListener('input',inputChanged);
    form.addEventListener('change',inputChanged);
    if(preserveGenerator)setBoardingGeneratorAvailability(form,draft);
    else refreshBoardingGenerator(form,draft,{profile});
    if(draft.boardingCode && draft.boardingCodeSource!=='generated')showDifferences();
    else updateGenerated();
  }
  refreshBarcodeFieldLocks(form,draft);
  if (autoRead && referenceURL && !draft[field] && draft.fieldSources?.[field] !== 'manual') readReference('photo');
  return () => { disposed = true; clearTimeout(updateTimer);form.removeEventListener('input',inputChanged);form.removeEventListener('change',inputChanged);form.removeEventListener('submit',submit,true); camera.dispose(); reset(); };
}
