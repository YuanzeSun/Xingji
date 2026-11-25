import {BOARDING_FIELDS,BOARDING_SHARED_FIELDS,boardingCodeDifferences,clearGeneratedCode} from './boarding-code-state.js';
import {JOURNEY_DATE_FIELDS,journeyDate} from './journey-date.js';
import {readTicketDate,writeTicketDate} from './date-field.js';
import {readBoardingCode} from './bcbp.js';
import {boardingScanReview} from './boarding-rescan.js';
import {normalizePlaces} from './places.js';
import {railService} from './rail-journey.js';
import {markManualFields} from './lookup-values.js';
import {fieldSourceBadge,markFieldSources,railBarcodeFieldLocked,railCodeEntryLocked,refreshFieldSources} from './field-sources.js';
import {ticketFieldLocked,refreshTicketFieldLocks} from './barcode-fields.js';
import { codeCameraMarkup, bindCodeCamera } from './code-camera.js';
import { renderCodeData } from './barcode-data.js';
import { hasRailQRCode, isLinearTicketCode, normalizeTicketCode } from './ticket-code.js';
import { normalizeBoardingCode } from './boarding-code.js';
import { DEMO_BOARDING_CODE } from './demo-boarding-code.js';
import { DEMO_RAIL_LINEAR_CODE, DEMO_RAIL_TICKET_CODE, DEMO_TICKET_CODE } from './demo-code.js';
import {automaticBoardingCode,editBoardingGeneratorField,readBoardingGenerator,refreshBoardingGenerator,setBoardingGeneratorAvailability} from './boarding-code-generator.js';
import {escape as e} from './html.js';
import {applyTicketIdentity} from './personal-profile.js';

const configuration = record => record.type === 'flight' ? { field: 'boardingCode', normalize: normalizeBoardingCode } : { field: 'ticketCode', normalize: normalizeTicketCode };
const codeRemovalLocked = (record, editingSaved) => editingSaved && (record.type === 'flight' || hasRailQRCode(record));
const removable = (record, field, editingSaved) => !codeRemovalLocked(record, editingSaved) && !!record[field] && record.boardingCodeSource !== 'generated';
const thumbnail = code => code ? `${renderCodeData(code)}<span>已收录</span>` : '';
let boardingExamples, railQRExample, railLinearExample;
function boardingExamplesMarkup(hidden) {
  boardingExamples ??= `<div class="boarding-code-sample"><span class="boarding-code-sample-image" aria-hidden="true">${renderCodeData(DEMO_BOARDING_CODE)}</span><span>PDF417</span></div>
    <div class="boarding-code-sample"><span class="boarding-code-sample-image" aria-hidden="true">${renderCodeData(DEMO_TICKET_CODE)}</span><span>二维码</span></div>`;
  return `<figure class="boarding-code-examples" data-code-examples ${hidden ? 'hidden' : ''}><figcaption>扫码示例</figcaption>${boardingExamples}</figure>`;
}
function railExampleMarkup(record) {
  const linear = record.template === 'rail-red-barcode';
  const example = linear ? (railLinearExample ??= renderCodeData(DEMO_RAIL_LINEAR_CODE))
    : (railQRExample ??= renderCodeData(DEMO_RAIL_TICKET_CODE));
  return `<figure class="boarding-code-examples rail-code-example${linear ? ' rail-linear-example' : ''}" data-code-examples ${record.ticketCode || railCodeEntryLocked(record) ? 'hidden' : ''}><figcaption>扫码示例</figcaption><span class="boarding-code-sample-image" aria-hidden="true">${example}</span></figure>`;
}
export function ticketCodeEditor(record, { fromScan = false, editingSaved = false } = {}) {
  const { field, normalize } = configuration(record);
  const flight = record.type === 'flight';
  const title = flight ? '登机牌条码或电子登机牌二维码' : '扫码录入';
  const disabled = railCodeEntryLocked(record) ? ' disabled' : '';
  const referenceButton = fromScan && !disabled ? `<button type="button" class="button small secondary" id="code-use-scan" ${record[field] ? 'hidden' : ''}>读取本次图片中的码</button>` : '';
  const upload = `<button type="button" class="button small secondary" data-code-upload${disabled}>上传图片</button><input id="code-photo" type="file" accept="image/png,image/jpeg,image/webp" hidden${disabled} />`;
  const saved = normalize(record[field]);
  const remove = codeRemovalLocked(record, editingSaved) ? '' : `<button type="button" class="button small secondary" id="code-remove" ${removable(record, field, editingSaved) ? '' : 'hidden'}>移除</button>`;
  const controls = `<div class="saved-code" id="saved-code" ${saved ? '' : 'hidden'}>${thumbnail(saved)}</div><div class="code-actions">${referenceButton}<button type="button" class="button small secondary" data-code-start${disabled}>相机扫描</button>${upload}${remove}</div>`;
  const scan = `<div class="boarding-code-scan"><div class="boarding-code-controls">${controls}</div>${flight ? boardingExamplesMarkup(record[field]) : railExampleMarkup(record)}</div>`;
  return `<section data-code-editor class="editor-extra${flight ? '' : ' full-field rail-code-entry'}" ${flight ? '' : 'data-rail-code-entry'} id="code-editor"><h3>${title}${fieldSourceBadge(field,record)}</h3>${scan}${codeCameraMarkup()}<p class="fine-print" id="code-status" role="status"></p><p id="code-consistency" class="code-consistency" role="status" hidden></p><div id="code-choices" class="code-choices" hidden></div><button type="button" class="text-button" id="code-cancel" hidden>取消选择</button><p class="form-error" id="code-error" role="alert"></p></section>`;
}
export function bindTicketCodeEditor(form, draft, changed, {
  referenceURL = '', autoRead = false, editingSaved = false, savedService = editingSaved ? draft.service : '',
  profile, preserveGenerator = false, onCameraStart, isCurrent = () => true,
  loadRebuilder = async () => (await import('./code-reader.js')).rebuildCodesFromImage, cameraOptions = {}
} = {}) {
  const section = form.querySelector('[data-code-editor]'); if (!section) return () => {};
  const find = id => section.querySelector('#' + id);
  const { field, normalize } = configuration(draft), photo = find('code-photo'), status = find('code-status'), error = find('code-error'), choices = find('code-choices'), cancel = find('code-cancel');
  const flight = draft.type === 'flight';
  let generation = 0, disposed = false, loading = false, pending = false, updateTimer;
  const consistency=find('code-consistency');
  function reset() { generation++; loading = false; pending = false; choices.replaceChildren(); choices.classList.remove('code-conflicts'); choices.hidden = true; cancel.hidden = true; photo.value = ''; }
  function showSaved() {
    const saved = find('saved-code');
    saved.innerHTML = thumbnail(draft[field]);
    saved.hidden = !draft[field];
    const remove = find('code-remove');
    if (remove) remove.hidden = !removable(draft, field, editingSaved);
    const reference = find('code-use-scan');
    if (reference) reference.hidden = !!draft[field];
    section.querySelector('[data-code-examples]').hidden = !!draft[field] || railCodeEntryLocked(draft);
  }
  function currentRecord() {
    const record={...draft};
    for (const key of BOARDING_SHARED_FIELDS) {
      const input = form.elements[key];
      if (!input || (key === 'service' && savedService) || ticketFieldLocked(draft, key)) continue;
      record[key] = JOURNEY_DATE_FIELDS.includes(key) ? readTicketDate(form, key, draft) : input.value;
    }
    return normalizePlaces(record);
  }
  function showDifferences(record=currentRecord()) {
    const differences=boardingCodeDifferences(record);
    consistency.textContent=differences.length ? '已收录条码与票面不同：'+differences.join('、')+'。' : '';
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
  function useFlight(code, selection) {
    if (!isCurrent()) return;
    const data = normalize(code.data), index = String(code.legIndex ?? 0);
    const read = readBoardingCode(data, index);
    const original = draft.boardingCodeSource === 'original';
    const rescan = editingSaved || original;
    const previousRecord = currentRecord();
    const review = read ? boardingScanReview(previousRecord, read, rescan) : null;
    const mismatchedService = savedService && review?.conflicts.some(({ key }) => key === 'service');
    if (rescan && (!review || review.rejected || mismatchedService)) {
      reset();
      status.textContent = '';
      error.textContent = !review ? '无法从新码确认航班信息，已拒绝录入。' :
        '行程关键信息不符，已拒绝录入。' + review.conflicts.map(({ label, existing, scanned }) => `${label} ${existing} → ${scanned}`).join('；');
      return;
    }
    if (review?.conflicts.length) {
      const fields = review.conflicts.map(({ key, existing, scanned }) => [key, existing, scanned]);
      if (!selection || JSON.stringify(fields) !== JSON.stringify(selection.fields)) {
        pending = true;
        status.textContent = '以下字段有冲突，请逐项选择。';
        error.textContent = '';
        choices.classList.add('code-conflicts');
        choices.innerHTML = review.conflicts.map(({ key, label, existing, scanned }) =>
          `<fieldset data-scan-conflict="${key}"><legend>${e(label)}</legend><label class="code-conflict-choice"><input type="radio" name="scan-${key}" value="existing" /><span>已有 · ${e(existing)}</span></label><label class="code-conflict-choice"><input type="radio" name="scan-${key}" value="scanned" /><span>新码 · ${e(scanned)}</span></label></fieldset>`).join('')
          + '<button type="button" class="button primary small" data-scan-confirm>确认录入</button>';
        choices.hidden = false;
        cancel.hidden = false;
        choices.querySelector('input').focus();
        choices.querySelector('[data-scan-confirm]').addEventListener('click', () => {
          const groups = [...choices.querySelectorAll('[data-scan-conflict]')], missing = groups.find(group => !group.querySelector(':checked'));
          if (missing) { error.textContent = '请为每个冲突字段选择来源。'; missing.querySelector('input').focus(); return; }
          useFlight(code, { fields, choices: Object.fromEntries(groups.map(group => [group.dataset.scanConflict, group.querySelector(':checked').value])) });
        });
        return;
      }
    }
    const adopted = review?.conflicts.filter(({ key }) => selection?.choices[key] === 'scanned') || [];
    const replaceCode = !draft.boardingCode || !rescan || review?.added || adopted.length;
    reset();
    status.textContent = !rescan ? '已读取并重建 ' + code.format :
      review?.added ? `已补充 ${review.added} 项资料` : review?.conflicts.length ? '已按选择核对扫码资料' : '扫码资料一致';
    error.textContent = '';
    if (!replaceCode) return;

    draft.boardingCode = data;
    draft.boardingCodeSource = 'original';
    draft.boardingLegIndex = index;
    draft.boardingCodeOperatingFlight = '';
    markManualFields(draft, [field]);
    markFieldSources(draft, [field], 'barcode');
    const values = Object.assign({}, review?.values, ...adopted.map(({ update }) => update));
    const filled = Object.keys(values);
    Object.assign(draft, values);
    markFieldSources(draft, filled, 'barcode');
    draft.lockedFields = draft.lockedFields.filter(key => !Object.hasOwn(values, key));
    for (const key of filled) delete draft.lookupValues[key];
    normalizePlaces(draft);
    for (const key of filled) {
      if (key === 'departureDate') writeTicketDate(form, key, draft[key]);
      else if (form.elements[key]) form.elements[key].value = draft[key];
    }
    if (filled.includes('seatClass')) {
      const preset = form.querySelector('[data-seat-preset]'), input = form.elements.seatClass;
      if (preset && input && [...preset.options].some(option => option.value === draft.seatClass)) {
        preset.value = draft.seatClass; input.hidden = true; input.required = false;
      }
    }
    refreshBoardingGenerator(form, draft, { profile });
    refreshFieldSources(form, draft);
    refreshTicketFieldLocks(form, draft);
    showSaved(); showDifferences();
    changed({ previousRecord, rescan });
  }
  function use(code) {
    if (!isCurrent()) return;
    if (flight) { useFlight(code); return; }
    const linear = isLinearTicketCode(code.data);
    if (codeRemovalLocked(draft, editingSaved) && linear) {
      reset();
      status.textContent = '';
      error.textContent = '已收录的二维码只能用二维码替换';
      return;
    }
    const values = code.railFields || (code.issuer ? { issuer: code.issuer } : null);
    if (savedService && values?.service && railService(values.service) !== railService(savedService)) {
      reset();
      status.textContent = '';
      error.textContent = '二维码车次与已保存车次不符，未填入';
      return;
    }
    const previousRecord={...draft};
    draft[field] = normalize(code.data);
    markManualFields(draft,[field]);
    markFieldSources(draft,[field],'barcode');
    if (linear) draft.template = 'rail-red-barcode';
    else if (draft.template === 'rail-red-barcode') draft.template = 'rail-red-qr';
    if (draft.template !== previousRecord.template) markFieldSources(draft, ['template'], 'barcode');
    const previousLocks=draft.lockedFields.filter(key=>railBarcodeFieldLocked(previousRecord,key));
    draft.lockedFields=draft.lockedFields.filter(key=>!previousLocks.includes(key));
    if(values){
      for(const key of previousLocks)if(!Object.hasOwn(values,key) && !(key === 'service' && savedService)){
        draft[key]=key==='railStanding' ? false : '';
        delete draft.fieldSources[key];
      }
      const { identity, ...fields } = values;
      if (savedService && fields.service) fields.service = savedService;
      Object.assign(draft,fields);
      const keys = Object.keys(fields);
      markFieldSources(draft,keys,'barcode');
      if (applyTicketIdentity(draft, identity, profile, 'barcode')) keys.push('identity');
      for(const key of keys){
        if(draft[key] && !draft.lockedFields.includes(key))draft.lockedFields.push(key);
        if(draft.lookupValues)delete draft.lookupValues[key];
        if(JOURNEY_DATE_FIELDS.includes(key))writeTicketDate(form,key,draft[key]);
        else if(form.elements[key])form.elements[key].value=draft[key];
      }
      if(values.departureDate && !previousRecord.departureDate?.year)markFieldSources(draft,['departureDateYear'],'default');
      if(previousRecord.departureDate && !draft.departureDate)delete draft.fieldSources.departureDateYear;
      draft.lockedFields.sort();
    }
    refreshFieldSources(form,draft);
    refreshTicketFieldLocks(form,draft);
    reset();showSaved();
    if (code.railFields) status.textContent = '已扫码录入，二维码字段已锁定';
    else status.textContent = linear ? '已收录一维条码' : '已收录火车票二维码';
    error.textContent='';changed({previousRecord,codeStatus:status.textContent,railFields:code.railFields});
  }
  async function read(file, source = 'manual', options) {
    if (!isCurrent() || railCodeEntryLocked(draft)) return;
    const explicit = source !== 'camera' || options?.cameraFrame === 0;
    reset(); const request = generation; loading = true;
    if (explicit) { status.textContent = '正在识别条码…'; error.textContent = ''; }
    try {
      const rebuild = await loadRebuilder(), result = await rebuild(file, draft.type, options);
      const readRailTicketScan = !flight && result.codes.some(code => !isLinearTicketCode(code.data))
        ? (await import('./rail-ticket-scan.js')).readRailTicketScan : null;
      if (disposed || request !== generation || !section.isConnected || !isCurrent()) return;
      loading = false;
      if (!result.codes.length) {
        status.textContent = '';
        if (source === 'manual' || options?.cameraFrame === 0 || result.issues.length) error.textContent = result.issues[0] || '未识别到条码';
        return;
      }
      let available=result.codes.flatMap(code=>{
        const read=flight&&readBoardingCode(code.data);
        return read?.legCount>1 ? read.legs.map((leg,index)=>({...code,legIndex:index,label:`第 ${index+1} 段 · ${leg.service} ${leg.origin} → ${leg.destination}`})) : [code];
      });
      if (readRailTicketScan) {
        const year = journeyDate(draft.departureDate)?.year ?? undefined;
        available = available.flatMap(code => {
          if (isLinearTicketCode(code.data)) return [code];
          const railFields = readRailTicketScan(code.data, year);
          if (!railFields) return [];
          const label = railFields.service + ' · ' + railFields.ticketNumber;
          return [source === 'photo'
            ? { ...code, label, issuer: draft.template !== 'rail-supplement' && railFields.issuer }
            : { ...code, label, railFields }];
        });
        if (!available.length) {
          status.textContent='';
          const message = '未识别到可录入的火车票二维码';
          if (error.textContent !== message) error.textContent = message;
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
  const clearFeedback = () => { reset(); status.textContent = ''; error.textContent = ''; };
  const camera = railCodeEntryLocked(draft) ? null : bindCodeCamera(section, (image, options) => read(image, 'camera', options), {
    asCanvas: flight, ...cameraOptions, onStart: () => { clearFeedback(); onCameraStart?.(); }, onCancel: clearFeedback
  });
  if (camera) {
    form.querySelector('[data-rail-photo]')?.addEventListener('click',camera.stop,true);
    form.querySelector('[data-rail-photo-file]')?.addEventListener('change',camera.stop,true);
    form.querySelector('[data-rail-receipt-file]')?.addEventListener('change',camera.stop,true);
    section.querySelector('[data-code-upload]').addEventListener('click', () => photo.click());
  }
  photo.addEventListener('change', () => { const file = photo.files?.[0]; if (file) { onCameraStart?.(); camera.stop(); read(file); } });
  find('code-use-scan')?.addEventListener('click', () => readReference());
  find('code-remove')?.addEventListener('click', () => {
    if (!removable(draft, field, editingSaved)) return;
    reset();
    if(!flight)draft.lockedFields=draft.lockedFields.filter(key=>!railBarcodeFieldLocked(draft,key));
    draft[field]='';
    if(flight){
      for(const key of BOARDING_FIELDS)draft[key]='';
      refreshBoardingGenerator(form,draft,{profile});
    }
    markManualFields(draft,[field]);
    consistency.hidden=true;
    refreshFieldSources(form,draft);refreshTicketFieldLocks(form,draft);
    status.textContent='';error.textContent='';showSaved();changed();
  });
  cancel.addEventListener('click', () => { clearFeedback(); updateGenerated(); });
  const inputChanged=event=>{
    const input=event.target, extra=input.matches('[data-bcbp]');
    if(extra){
      if(input.disabled)return;
      editBoardingGeneratorField(input);
    } else {
      if(input.closest('[data-code-editor]'))return;
      if(ticketFieldLocked(draft,input.name)){refreshTicketFieldLocks(form,draft);return;}
      if(!BOARDING_SHARED_FIELDS.includes(input.closest('[data-journey-date]')?.dataset.journeyDate || input.name) && !input.matches('[data-seat-preset]'))return;
    }
    clearTimeout(updateTimer);
    updateTimer=setTimeout(()=>{if(section.isConnected)updateGenerated();},150);
  };
  const submit=event=>{
    if(disposed)return;
    if (!loading && !pending) { updateGenerated(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    const comparing = choices.classList.contains('code-conflicts');
    error.textContent = loading ? '正在读取条码，请稍候' : comparing ? '请先确认或取消扫码核对' : '请先选择对应的码，或取消选择';
    if (comparing) choices.querySelector('fieldset:not(:has(:checked)) input, [data-scan-confirm]')?.focus();
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
  refreshTicketFieldLocks(form,draft);
  if (autoRead && referenceURL && !draft[field] && !railCodeEntryLocked(draft) && draft.fieldSources?.[field] !== 'manual') readReference('photo');
  return () => { disposed = true; clearTimeout(updateTimer);form.removeEventListener('input',inputChanged);form.removeEventListener('change',inputChanged);form.removeEventListener('submit',submit,true); camera?.dispose(); reset(); };
}
