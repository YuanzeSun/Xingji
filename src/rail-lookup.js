import {calendarDate} from './journey-date.js';
import { escape as e } from './html.js';
import { railQuery, railCompletion } from './rail-lookup-model.js';
import { lookupRailDetails, RAIL_DETAILS_SOURCE } from './rail-data.js';
import { railJourneyMarkup, railReferenceNotice } from './rail-journey-ui.js';
import { hasConfirmedRailJourney, railJourneyMatches, RAIL_TIMETABLE_REFERENCES } from './rail-journey.js';
import { lookupRailTimetableReference } from './rail-timetable-reference.js';
import {fieldSourceBadge,RAILGO_REFERENCE_SOURCE} from './field-sources.js';

export const railTrainsetField=record=>`<label class="field"><span>车组编号${fieldSourceBadge('railTrainsets',record)}</span><input name="railTrainsets" data-rail-trainsets value="${e(record.railTrainsets || '')}" placeholder="如 CR400BF-B-5099，多组用 / 分隔" /></label>`;

function railResponseMarkup({ trainNum, date, httpStatus, payload }) {
  const day = date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const row = payload?.data;
  const fields = {
    success: payload?.success, code: payload?.code, msg: payload?.msg, message: payload?.message,
    number: row?.number, numberFull: row?.numberFull, rundays: row?.rundays,
    'timetable[].station': Array.isArray(row?.timetable) ? row.timetable.map(stop => stop?.station) : undefined
  };
  const raw = Object.entries(fields).filter(([, value]) => value !== undefined)
    .map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n');
  const title = e([trainNum, '查询日期 ' + day, 'HTTP ' + httpStatus].join(' · '));
  return '<p>' + title + '</p>' +
    (raw ? '<pre tabindex="0" aria-label="' + title + '">' + e(raw) + '</pre>' : '');
}

export function railLookupMarkup(record) {
  const journey = railJourneyMatches(record) ? record.railJourney : null;
  const savedStart = hasConfirmedRailJourney(record) ? calendarDate(journey.query.startDate) : '';
  const startOverride = savedStart === calendarDate(record.departureDate) ? '' : savedStart;
  const reference = railReferenceNotice(record);
  const fallbackOptions = `<div data-rail-fallback hidden role="group" aria-label="其他铁路查询">${Object.entries(RAIL_TIMETABLE_REFERENCES).map(([key, { name }]) => `<button class="button secondary small" type="button" data-rail-provider="${key}">查 ${name}</button>`).join('')}</div>`;
  return `
    <section class="rail-lookup" aria-label="铁路资料补全">
      <div class="rail-lookup-heading">
        <a href="${RAIL_DETAILS_SOURCE}" target="_blank" rel="noopener noreferrer">RailGo 行程补全</a>
        <button class="button secondary small" type="button" data-rail-lookup>${journey ? '重新查询' : '查询并补全'}</button>
      </div>
      <p class="rail-lookup-status" data-rail-status role="status" aria-live="polite"></p>
      <p class="rail-query-hint" data-rail-query-hint hidden><button type="button" aria-controls="rail-lookup-diagnostics">查看 RailGo 原始返回</button><span data-rail-retry-date>，按开行日期（rundays）调整查询日期后重查，或用下方任一服务查询。</span></p>
      ${fallbackOptions}
      <div class="code-consistency" data-rail-reference role="status" aria-live="polite" ${reference ? '' : 'hidden'}>${reference}</div>
      <details class="rail-query-date">
        <summary>查询日期</summary>
        <label class="field"><span>列车始发日</span><input type="date" data-date-control data-rail-query-date value="${e(startOverride)}" min="1800-01-01" max="2200-12-31"/></label>
      </details>
      <details id="rail-lookup-diagnostics" class="rail-lookup-diagnostics" data-rail-diagnostics hidden>
        <summary>查看 RailGo 原始返回</summary><div data-rail-responses></div>
      </details>
    </section>`;
}

export function railTimetableMarkup(record) {
  return `<section class="rail-lookup-result" data-rail-result aria-labelledby="rail-lookup-result-heading" ${railJourneyMatches(record) ? '' : 'hidden'}>
      <h3 id="rail-lookup-result-heading">列车时刻表</h3>
      <div data-rail-journey-preview>${railJourneyMarkup(record)}</div>
    </section>`;
}
export function bindRailLookup(form, { getRecord, canQuery, apply, lookup = lookupRailDetails, lookupReference = lookupRailTimetableReference, scannedRail, scannedRailQR, railPointsTrip, onAutomaticPending }) {
  const section = form.querySelector('.rail-lookup');
  if (!section) return () => {};
  const button = section.querySelector('[data-rail-lookup]'), date = section.querySelector('[data-rail-query-date]'), status = section.querySelector('[data-rail-status]');
  const resultBox = form.querySelector('[data-rail-result]'), preview = resultBox.querySelector('[data-rail-journey-preview]');
  const referenceBox = section.querySelector('[data-rail-reference]');
  const diagnostics = section.querySelector('[data-rail-diagnostics]'), responses = section.querySelector('[data-rail-responses]');
  const hint = section.querySelector('[data-rail-query-hint]'), dateHint = hint.querySelector('[data-rail-retry-date]');
  const showRaw = hint.querySelector('button');
  const fallback = section.querySelector('[data-rail-fallback]'), providers = [...fallback.querySelectorAll('button')];
  let disposed = false, busy = false, request, appliedTrip = '', applying = false;
  let diagnosticsTrip = '', failedTrip = '', renderedJourney;
  const automaticRecord = scannedRailQR || scannedRail || railPointsTrip;
  const filled = new Map(Object.entries(getRecord().lookupValues || {}));
  const tripStamp = () => {
    const record = getRecord();
    return JSON.stringify(['type','template','service','departureDate','origin','originCode','destination','destinationCode'].map(field => record[field] || ''));
  };
  if (filled.size || railJourneyMatches(getRecord())) appliedTrip = tripStamp();
  const clearDiagnostics = () => {
    diagnosticsTrip = '';
    diagnostics.hidden = true;
    diagnostics.open = false;
    hint.hidden = true;
    responses.replaceChildren();
  };
  const renderResult = () => {
    const record = getRecord(), matched = railJourneyMatches(record);
    const markup = railJourneyMarkup(record);
    if (markup !== renderedJourney) {
      preview.innerHTML = markup;
      renderedJourney = markup;
    }
    resultBox.hidden = !matched;
    date.disabled = hasConfirmedRailJourney(record);
    if (date.disabled) date.value = calendarDate(record.railJourney.query.startDate);
    const reference=railReferenceNotice(record);
    if (referenceBox.innerHTML!==reference) referenceBox.innerHTML=reference;
    referenceBox.hidden=!reference;
    const input=form.querySelector('[data-rail-trainsets]');if(input && input.value!==(record.railTrainsets || ''))input.value=record.railTrainsets || '';
  };
  const refresh = () => {
    button.disabled = true;
    fallback.hidden = !failedTrip || failedTrip !== tripStamp() || hasConfirmedRailJourney(getRecord());
    for (const provider of providers) provider.disabled = busy || !canQuery();
    if (busy) return;
    button.textContent = railJourneyMatches(getRecord()) ? '重新查询' : '查询并补全';
    if (!canQuery()) return;
    try { railQuery(getRecord(), date.value || undefined); }
    catch { return; }
    button.disabled = false;
  };
  const applyResult = (changes, source) => {
    if (!Object.keys(changes).length) return;
    applying = true;
    try { apply(changes, { ...source, at: new Date().toISOString() }); }
    finally { applying = false; }
    for (const field of Object.keys(changes)) if (!['railJourney','railRoute'].includes(field)) filled.set(field, getRecord()[field]);
    appliedTrip = tripStamp();
  };
  async function query({ automatic = false } = {}) {
    if (busy || disposed || !canQuery()) return;
    let otherRunDay = false;
    const trip = tripStamp(), selectedDate = date.value;
    try {
      const startDate = automatic ? undefined : selectedDate || undefined;
      const input = railQuery(getRecord(), startDate);
      const initialTime = getRecord().departureTime;
      clearDiagnostics();
      busy=true; refresh(); button.textContent='正在查询…'; status.textContent='正在查询时刻、担当单位与列车资料…';
      request=new AbortController();
      const result=await lookup(input,{
        railRoute:getRecord().railRoute, railJourney:getRecord().railJourney, allowReference: !!startDate && !date.disabled, signal:AbortSignal.any([request.signal,AbortSignal.timeout(40000)]),
        onTimetableResponse(response) {
          if (disposed || !form.isConnected || trip !== tripStamp()) return;
          diagnosticsTrip = trip;
          responses.innerHTML = railResponseMarkup(response);
          const rundays = response.payload?.data?.rundays;
          otherRunDay = Array.isArray(rundays) && rundays.some(day => typeof day === 'string' && /^\d{8}$/.test(day) && day !== input.date);
        }
      });
      if (disposed || !form.isConnected) return;
      if (!canQuery() || form.querySelector('[type="submit"]')?.disabled || trip !== tripStamp() || selectedDate !== date.value ||
          (automatic && getRecord().departureTime !== initialTime)) { status.textContent='查询条件已改变，本次结果未填入'; return; }
      const reference = result.railJourney.query.referenceFor;
      if (automatic && automaticRecord?.departureTime && result.departureTime !== automaticRecord.departureTime) {
        status.textContent='RailGo 发车时间与票面不同，请核对后手动查询';
        failedTrip = trip;
        return;
      }
      const changes=railCompletion(getRecord(),result,startDate), count=Object.keys(changes).filter(key=>changes[key] && !['railJourney','railRoute'].includes(key)).length, snapshot=!!(changes.railJourney || changes.railRoute);
      const runDay=calendarDate(result.railJourney.query.startDate);
      const source=reference ? {kind:RAILGO_REFERENCE_SOURCE,label:`RailGo 参考资料（开行日 ${runDay}）`} : {kind:'rail-lookup',label:`RailGo 行程资料（始发日 ${runDay}）`};
      applyResult(changes, source);
      failedTrip = '';
      renderResult();
      const names=[...new Set((result.railRoute?.lineLabels||[]).map(label=>label.name))];
      status.textContent=count || snapshot ? `${count ? '已补全 '+count+' 项，' : ''}${snapshot ? '已取得行程资料，' : ''}请核对后保存${names.length ? '；线路：'+names.join('、') : result.railRoute ? '；线路名称暂未取得，可重试查询' : ''}${result.partial ? '；部分附加资料暂不可用' : ''}` : '已有信息已保留';
    } catch (error) {
      if (!disposed && form.isConnected) {
        if (trip !== tripStamp() || selectedDate !== date.value) {
          status.textContent = '查询条件已改变，本次结果未填入';
          return;
        }
        failedTrip = trip;
        status.textContent = error.name === 'TimeoutError' ? '查询超时，请重试或手动填写' : error.message;
        hint.hidden = diagnosticsTrip !== tripStamp();
        dateHint.hidden = !otherRunDay || date.disabled;
      }
    }
    finally {
      busy = false;
      if (!disposed && form.isConnected) {
        if (diagnosticsTrip === tripStamp()) diagnostics.hidden = false;
        else if (diagnosticsTrip) clearDiagnostics();
        refresh();
      }
    }
  }
  async function queryHistorical(event) {
    const trip = tripStamp();
    if (busy || disposed || !canQuery() || fallback.hidden) return;
    const provider = event.currentTarget.dataset.railProvider, name = RAIL_TIMETABLE_REFERENCES[provider].name;
    const departureTime = getRecord().departureTime;
    const isCurrent = () => trip === tripStamp() && departureTime === getRecord().departureTime && canQuery() && !form.querySelector('[type="submit"]')?.disabled;
    busy = true;
    refresh();
    status.textContent = '正在查询 ' + name + '…';
    request = new AbortController();
    try {
      const result = await lookupReference(provider, railQuery(getRecord()), departureTime, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(25000)]) });
      if (disposed || !form.isConnected) return;
      if (!isCurrent()) { status.textContent = '查询条件已改变，本次结果未填入'; return; }
      const changes = railCompletion(getRecord(), result);
      applyResult(changes, { kind: provider, label: name });
      renderResult();
      status.textContent = changes.railJourney ? '已从 ' + name + ' 补全，请核对后保存' : '已有行程资料已保留';
    } catch (error) {
      if (!disposed && form.isConnected) status.textContent = !isCurrent() ? '查询条件已改变，本次结果未填入' :
        error.name === 'TimeoutError' ? name + ' 查询超时，请重试' : error.message;
    } finally {
      busy = false;
      if (!disposed && form.isConnected) refresh();
    }
  }
  const input=event=>{
    if (!applying && !disposed) {
      const dateField=event.target.closest('[data-journey-date]')?.dataset.journeyDate;
      filled.delete(dateField || event.target.name);
      const current = tripStamp();
      if (failedTrip && failedTrip !== current) failedTrip = '';
      if (dateField === 'departureDate' || (date.disabled && appliedTrip !== current)) date.value = '';
      if (diagnosticsTrip && diagnosticsTrip !== current) clearDiagnostics();
      if (appliedTrip && appliedTrip !== current) {
        const changes={railJourney:'',railRoute:''};
        for (const [field,value] of filled) if (JSON.stringify(getRecord()[field])===JSON.stringify(value)) changes[field]='';
        filled.clear(); appliedTrip = ''; applying=true;
        try { apply(changes,null); } finally { applying=false; }
      }
    }
    renderResult();refresh();
  };
  const openDiagnostics = () => {
    if (diagnostics.hidden) return;
    diagnostics.open = true;
    diagnostics.querySelector('summary').focus();
    diagnostics.scrollIntoView?.({ block: 'nearest' });
  };
  showRaw.addEventListener('click', openDiagnostics);
  for (const provider of providers) provider.addEventListener('click', queryHistorical);
  button.addEventListener('click',query); form.addEventListener('input',input); form.addEventListener('change',input); renderResult();refresh();
  const sameTime = automaticRecord?.departureTime ? automaticRecord.departureTime === getRecord().departureTime : !!(scannedRailQR || railPointsTrip);
  if (!button.disabled && sameTime) {
    let sameTrip = false;
    try {
      sameTrip = JSON.stringify(railQuery(automaticRecord)) === JSON.stringify(railQuery(getRecord()));
    } catch { /* Leave incomplete imports for review. */ }
    if (sameTrip) {
      const pending = query({ automatic: true });
      onAutomaticPending?.(pending);
    }
  }
  return () => {
    disposed = true;
    request?.abort();
    clearDiagnostics();
    showRaw.removeEventListener('click', openDiagnostics);
    for (const provider of providers) provider.removeEventListener('click', queryHistorical);
    button.removeEventListener('click', query);
    form.removeEventListener('input', input);
    form.removeEventListener('change', input);
  };
}
