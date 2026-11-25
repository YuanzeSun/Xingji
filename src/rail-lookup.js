import {calendarDate} from './journey-date.js';
import { escape as e } from './html.js';
import { railQuery, railCompletion } from './rail-lookup-model.js';
import { lookupRailDetails, RAIL_DETAILS_SOURCE } from './rail-data.js';
import { railJourneyMarkup, railReferenceNotice } from './rail-journey-ui.js';
import { railJourneyMatches } from './rail-journey.js';
import {fieldSourceBadge,RAILGO_REFERENCE_SOURCE} from './field-sources.js';

export const railTrainsetField=record=>`<label class="field"><span>车组编号${fieldSourceBadge('railTrainsets',record)}</span><input name="railTrainsets" data-rail-trainsets value="${e(record.railTrainsets || '')}" placeholder="如 CR400BF-B-5099，多组用 / 分隔" /></label>`;

function railResponseMarkup({ trainNum, date, reference, httpStatus, payload }, initialDate) {
  const day = date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  const attempt = reference ? '参考日期复查' : date === initialDate ? '首次查询' : '推算始发日复查';
  const row = payload?.data;
  const fields = {
    success: payload?.success, code: payload?.code, msg: payload?.msg, message: payload?.message,
    number: row?.number, numberFull: row?.numberFull, rundays: row?.rundays,
    'timetable[].station': Array.isArray(row?.timetable) ? row.timetable.map(stop => stop?.station) : undefined
  };
  const raw = Object.entries(fields).filter(([, value]) => value !== undefined)
    .map(([key, value]) => key + ': ' + JSON.stringify(value)).join('\n');
  const title = e([attempt, trainNum, day, 'HTTP ' + httpStatus].join(' · '));
  return '<p>' + title + '</p>' +
    (raw ? '<pre tabindex="0" aria-label="' + title + '">' + e(raw) + '</pre>' : '');
}

export function railLookupMarkup(record) {
  const journey = railJourneyMatches(record) ? record.railJourney : null;
  const savedStart = journey && !journey.query.referenceFor ? calendarDate(journey.query.startDate) : '';
  const startOverride = savedStart === calendarDate(record.departureDate) ? '' : savedStart;
  const reference = railReferenceNotice(record);
  return `<section class="rail-lookup" aria-label="铁路资料补全"><div class="rail-lookup-heading"><a href="${RAIL_DETAILS_SOURCE}" target="_blank" rel="noopener noreferrer">RailGo 行程补全</a><button class="button secondary small" type="button" data-rail-lookup>${journey ? '刷新资料' : '查询并补全'}</button></div><p class="rail-lookup-status" data-rail-status role="status" aria-live="polite"></p><div class="code-consistency" data-rail-reference role="status" aria-live="polite" ${reference ? '' : 'hidden'}>${reference}</div><details class="rail-start-override"><summary>调整列车始发日期</summary><label class="field"><span>列车始发日期</span><input type="date" data-date-control data-rail-start value="${e(startOverride)}" min="1800-01-01" max="2200-12-31"/></label></details><details class="rail-lookup-result" data-rail-result ${journey ? '' : 'hidden'}><summary>查看 RailGo 查询结果</summary><div data-rail-journey-preview>${railJourneyMarkup(record)}</div></details><details class="rail-lookup-diagnostics" data-rail-diagnostics hidden><summary>查看 RailGo 原始返回</summary><div data-rail-responses></div></details></section>`;
}
export function bindRailLookup(form, { getRecord, canQuery, apply, lookup = lookupRailDetails, scannedRail, scannedRailQR, railPointsTrip, onAutomaticPending }) {
  const section = form.querySelector('.rail-lookup');
  if (!section) return () => {};
  const button = section.querySelector('[data-rail-lookup]'), date = section.querySelector('[data-rail-start]'), status = section.querySelector('[data-rail-status]'), preview = section.querySelector('[data-rail-journey-preview]'), resultBox = section.querySelector('[data-rail-result]');
  const referenceBox = section.querySelector('[data-rail-reference]');
  const diagnostics = section.querySelector('[data-rail-diagnostics]'), responses = section.querySelector('[data-rail-responses]');
  let disposed = false, busy = false, request, appliedStamp = '', applying = false;
  let diagnosticsStamp = '';
  const automaticRecord = scannedRailQR || scannedRail || railPointsTrip;
  const filled = new Map(Object.entries(getRecord().lookupValues || {}));
  const stamp = () => {
    const record = getRecord();
    return JSON.stringify([date.value, ...['type','template','service','departureDate','origin','originCode','destination','destinationCode'].map(field => record[field] || '')]);
  };
  if (filled.size || railJourneyMatches(getRecord())) appliedStamp=stamp();
  const clearDiagnostics = () => {
    diagnosticsStamp = '';
    diagnostics.hidden = true;
    diagnostics.open = false;
    responses.replaceChildren();
  };
  const renderResult = () => {
    const record=getRecord();preview.innerHTML=railJourneyMarkup(record);resultBox.hidden=!railJourneyMatches(record);
    const reference=railReferenceNotice(record);
    if (referenceBox.innerHTML!==reference) referenceBox.innerHTML=reference;
    referenceBox.hidden=!reference;
    const input=form.querySelector('[data-rail-trainsets]');if(input && input.value!==(record.railTrainsets || ''))input.value=record.railTrainsets || '';
  };
  const refresh = () => {
    button.disabled = true;
    if (busy || !canQuery()) return;
    try { railQuery(getRecord(), date.value || undefined); }
    catch { return; }
    button.disabled = false;
  };
  async function query({ automatic = false } = {}) {
    if (busy || disposed || !canQuery()) return;
    try {
      const startDate = date.value || undefined;
      const input = railQuery(getRecord(), startDate), original = stamp();
      const initialTime = getRecord().departureTime;
      clearDiagnostics();
      busy=true; button.disabled=true; button.textContent='正在查询…'; status.textContent='正在查询时刻、担当单位与列车资料…';
      request=new AbortController();
      const result=await lookup(input,{
        railRoute:getRecord().railRoute, railJourney:getRecord().railJourney, explicitStartDate: Boolean(startDate), signal:AbortSignal.any([request.signal,AbortSignal.timeout(40000)]),
        onTimetableResponse(response) {
          if (disposed || !form.isConnected || original !== stamp()) return;
          diagnosticsStamp = original;
          responses.insertAdjacentHTML('beforeend', railResponseMarkup(response, input.date));
        }
      });
      if (disposed || !form.isConnected) return;
      if (!canQuery() || form.querySelector('[type="submit"]')?.disabled || original!==stamp() ||
          (automatic && getRecord().departureTime !== initialTime)) { status.textContent='查询条件已改变，本次结果未填入'; return; }
      const reference = result.railJourney.query.referenceFor;
      if (!reference && automatic && automaticRecord?.departureTime && result.departureTime !== automaticRecord.departureTime) {
        status.textContent='RailGo 发车时间与票面不同，请核对后手动查询';
        return;
      }
      const changes=railCompletion(getRecord(),result,startDate), count=Object.keys(changes).filter(key=>changes[key] && !['railJourney','railRoute'].includes(key)).length, snapshot=!!(changes.railJourney || changes.railRoute);
      if (Object.keys(changes).length) {
        const runDay=calendarDate(result.railJourney.query.startDate);
        const source=reference ? {kind:RAILGO_REFERENCE_SOURCE,label:`RailGo 参考资料（开行日 ${runDay}）`} : {kind:'rail-lookup',label:`RailGo 行程资料（始发日 ${runDay}）`};
        applying=true;
        try { apply(changes,{...source,at:new Date().toISOString()}); }
        finally { applying=false; }
        for (const field of Object.keys(changes)) if (!['railJourney','railRoute'].includes(field)) filled.set(field,getRecord()[field]);
        appliedStamp=stamp();
      }
      renderResult();
      const names=[...new Set((result.railRoute?.lineLabels||[]).map(label=>label.name))];
      status.textContent=count || snapshot ? `${count ? '已补全 '+count+' 项，' : ''}${snapshot ? '已取得行程资料，' : ''}请核对后保存${names.length ? '；线路：'+names.join('、') : result.railRoute ? '；线路名称暂未取得，可重试查询' : ''}${result.partial ? '；部分附加资料暂不可用' : ''}` : '已有信息已保留';
    } catch(error) { if(!disposed && form.isConnected) status.textContent=error.name==='TimeoutError' ? '查询超时，请重试或手动填写' : error.message; }
    finally {
      busy = false;
      if (!disposed && form.isConnected) {
        if (diagnosticsStamp === stamp()) diagnostics.hidden = false;
        else if (diagnosticsStamp) clearDiagnostics();
        button.textContent = railJourneyMatches(getRecord()) ? '刷新资料' : '查询并补全';
        refresh();
      }
    }
  }
  const input=event=>{
    if (!applying && !disposed) {
      const dateField=event.target.closest('[data-journey-date]')?.dataset.journeyDate;
      if (dateField==='departureDate') date.value='';
      filled.delete(dateField || event.target.name);
      const current = stamp();
      if (diagnosticsStamp && diagnosticsStamp !== current) clearDiagnostics();
      if (appliedStamp && appliedStamp!==current) {
        const changes={railJourney:'',railRoute:''};
        for (const [field,value] of filled) if (JSON.stringify(getRecord()[field])===JSON.stringify(value)) changes[field]='';
        filled.clear(); appliedStamp=''; applying=true;
        try { apply(changes,null); } finally { applying=false; }
      }
    }
    refresh();renderResult();
  };
  button.addEventListener('click',query); form.addEventListener('input',input); form.addEventListener('change',input); refresh();renderResult();
  const sameTime = automaticRecord?.departureTime ? automaticRecord.departureTime === getRecord().departureTime : !!(scannedRailQR || railPointsTrip);
  if (!button.disabled && sameTime) {
    let sameTrip = false;
    try {
      const startDate = date.value || undefined;
      sameTrip = JSON.stringify(railQuery(automaticRecord, startDate)) === JSON.stringify(railQuery(getRecord(), startDate));
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
    button.removeEventListener('click', query);
    form.removeEventListener('input', input);
    form.removeEventListener('change', input);
  };
}
