import {calendarDate} from './journey-date.js';
import { escape as e } from './html.js';
import { railQuery, railCompletion } from './rail-lookup-model.js';
import { lookupRailDetails, RAIL_DETAILS_SOURCE } from './rail-data.js';
import { railJourneyMarkup, bindRailJourney } from './rail-journey-ui.js';
import { railJourneyMatches } from './rail-journey.js';
import {fieldSourceBadge} from './field-sources.js';

export const railTrainsetField=record=>`<label class="field"><span>车组编号${fieldSourceBadge('railTrainsets',record)}</span><input name="railTrainsets" data-rail-trainsets value="${e(record.railTrainsets || '')}" placeholder="如 CR400BF-B-5099，多组用 / 分隔" /></label>`;

export function railLookupMarkup(record) {
  return `<section class="rail-lookup" aria-label="铁路资料补全"><div class="rail-lookup-heading"><a href="${RAIL_DETAILS_SOURCE}" target="_blank" rel="noopener noreferrer">RailGo 行程补全</a><button class="button secondary small" type="button" data-rail-lookup>${railJourneyMatches(record) ? '刷新资料' : '查询并补全'}</button></div><p class="rail-lookup-status" data-rail-status role="status" aria-live="polite"></p><div class="code-consistency" data-rail-reference role="status" aria-live="polite" hidden></div><details class="rail-start-override"><summary>调整列车始发日期</summary><label class="field"><span>列车始发日期</span><input type="date" data-date-control data-rail-start value="${e(railJourneyMatches(record) && calendarDate(record.railJourney.query.startDate) !== calendarDate(record.departureDate) ? calendarDate(record.railJourney.query.startDate) : '')}" min="1800-01-01" max="2200-12-31"/></label></details><details class="rail-lookup-result" data-rail-result ${railJourneyMatches(record) ? '' : 'hidden'}><summary>查看已取得的经停、车组与车厢示意图</summary><div data-rail-journey-preview>${railJourneyMarkup(record)}</div></details></section>`;
}
export function bindRailLookup(form, { getRecord, canQuery, apply, lookup = lookupRailDetails, scannedRail, scannedRailQR }) {
  const section = form.querySelector('.rail-lookup');
  if (!section) return () => {};
  const button = section.querySelector('[data-rail-lookup]'), date = section.querySelector('[data-rail-start]'), status = section.querySelector('[data-rail-status]'), preview = section.querySelector('[data-rail-journey-preview]'), resultBox = section.querySelector('[data-rail-result]');
  const referenceBox = section.querySelector('[data-rail-reference]');
  let disposed = false, busy = false, request, appliedStamp = '', referenceStamp = '', applying = false;
  const scan = scannedRailQR || scannedRail;
  const filled = new Map(Object.entries(getRecord().lookupValues || {}));
  const stamp = () => JSON.stringify([date.value, ...['type','template','service','departureDate','origin','originCode','destination','destinationCode'].map(field => getRecord()[field] || '')]);
  if(filled.size)appliedStamp=stamp();
  const renderResult = () => {
    const record=getRecord();preview.innerHTML=railJourneyMarkup(record);resultBox.hidden=!railJourneyMatches(record);
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
      const input = railQuery(getRecord(),date.value || undefined), original=stamp();
      const initialTime = getRecord().departureTime;
      referenceBox.hidden = true;
      referenceStamp = '';
      busy=true; button.disabled=true; button.textContent='正在查询…'; status.textContent='正在查询时刻、担当单位与列车资料…';
      request=new AbortController();
      const result=await lookup(input,{railRoute:getRecord().railRoute,railJourney:getRecord().railJourney,signal:AbortSignal.any([request.signal,AbortSignal.timeout(40000)])});
      if (disposed || !form.isConnected) return;
      if (!canQuery() || form.querySelector('[type="submit"]')?.disabled || original!==stamp() ||
          (automatic && getRecord().departureTime !== initialTime)) { status.textContent='查询条件已改变，本次结果未填入'; return; }
      if (result.reference) {
        const ref = result.reference;
        const start = calendarDate(ref.railJourney.query.startDate);
        const boarding = calendarDate(ref.railJourney.query.boardingDate);
        const departure = (start === boarding ? '' : boarding + ' ') + ref.departureTime;
        const arrival = (ref.arrivalDate === boarding ? '' : ref.arrivalDate + ' ') + ref.arrivalTime;
        const details = [ref.railModel, ref.railBureau, ref.railRunner, ref.railCarOwner].filter(Boolean).join(' · ');
        referenceBox.innerHTML = `<strong>非乘车当日 · 仅供参考</strong><div>查询始发日 ${e(start)} · 乘车日 ${e(input.boardingDate)}</div><div>${e(input.origin)} ${e(departure)} → ${e(input.destination)} ${e(arrival)}</div>${details ? '<div>' + e(details) + '</div>' : ''}`;
        referenceBox.hidden = false;
        referenceStamp = original;
        status.textContent = '';
        return;
      }
      if (automatic && scan.departureTime && result.departureTime !== scan.departureTime) {
        status.textContent='RailGo 发车时间与票面不同，请核对后手动查询';
        return;
      }
      const changes=railCompletion(getRecord(),result,date.value || undefined), count=Object.keys(changes).filter(key=>changes[key] && !['railJourney','railRoute'].includes(key)).length, snapshot=!!(changes.railJourney || changes.railRoute);
      if (Object.keys(changes).length) {
        applying=true;
        try { apply(changes,{kind:'rail-lookup',label:`RailGo 行程资料（始发日 ${calendarDate(result.railJourney.query.startDate)}）`,at:new Date().toISOString()}); }
        finally { applying=false; }
        for (const [field,value] of Object.entries(changes)) if (!['railJourney','railRoute'].includes(field)) filled.set(field,value);
        appliedStamp=stamp();
      }
      renderResult();
      const names=[...new Set((result.railRoute?.lineLabels||[]).map(label=>label.name))];
      status.textContent=count || snapshot ? `${count ? '已补全 '+count+' 项，' : ''}${snapshot ? '已取得行程资料，' : ''}请核对后保存${names.length ? '；线路：'+names.join('、') : result.railRoute ? '；线路名称暂未取得，可重试查询' : ''}${result.partial ? '；部分附加资料暂不可用' : ''}` : '已有信息已保留';
    } catch(error) { if(!disposed && form.isConnected) status.textContent=error.name==='TimeoutError' ? '查询超时，请重试或手动填写' : error.message; }
    finally { busy=false; if(!disposed && form.isConnected) {button.textContent=railJourneyMatches(getRecord()) ? '刷新资料' : '查询并补全';refresh();} }
  }
  const input=event=>{
    if (!applying && !disposed) {
      if (event.target.closest('[data-journey-date]')?.dataset.journeyDate==='departureDate') date.value='';
      if (referenceStamp && referenceStamp !== stamp()) {
        referenceBox.hidden = true;
        referenceStamp = '';
      }
      filled.delete(event.target.name);
      if (appliedStamp && appliedStamp!==stamp()) {
        const changes={railJourney:'',railRoute:''};
        for (const [field,value] of filled) if (getRecord()[field]===value) changes[field]='';
        filled.clear(); appliedStamp=''; applying=true;
        try { apply(changes,null); } finally { applying=false; }
      }
    }
    refresh();renderResult();
  };
  const cleanupPreview=bindRailJourney(preview,getRecord);
  button.addEventListener('click',query); form.addEventListener('input',input); form.addEventListener('change',input); refresh();renderResult();
  const sameTime = scan?.departureTime ? scan.departureTime === getRecord().departureTime : !!scannedRailQR;
  if (!button.disabled && sameTime) {
    let sameTrip = false;
    try {
      const startDate = date.value || undefined;
      sameTrip = JSON.stringify(railQuery(scan, startDate)) === JSON.stringify(railQuery(getRecord(), startDate));
    } catch { /* Leave incomplete scans for review. */ }
    if (sameTrip) void query({ automatic: true });
  }
  return ()=>{disposed=true;request?.abort();cleanupPreview();button.removeEventListener('click',query);form.removeEventListener('input',input);form.removeEventListener('change',input);};
}
