import {calendarDate,sameDate} from './journey-date.js';
import { escape as e } from './html.js';
import { flightCandidates, flightCompletion, flightLookupNeeds, rotationRegistration } from './flight-lookup-model.js';
import { flightQuery } from './flight-query.js';
import { FlightConnector } from './mcp.js';
import { flightTrackRequest, readFlightTrack } from './flight-track.js';
import { reconcileAircraft } from './aircraft.js';
import { ticketFieldLabel } from './ticket-form.js';
import { BOARDING_METADATA_LABELS } from './boarding-metadata.js';

const lookupLabels = {
  ...BOARDING_METADATA_LABELS, originCode: '出发机场', destinationCode: '到达机场',
  airline: '航空公司', aircraft: '机型', aircraftRegistration: '飞机编号',
  departureTerminal: '出发航站楼', arrivalTerminal: '到达航站楼',
  flightDistance: '航程距离', flightStop: '经停机场'
};

export function flightLookupMarkup() {
  return `<section class="flight-lookup" aria-label="航班信息补全"><div class="flight-lookup-heading"><span>数据来源：飞常准</span><button class="button secondary small" type="button" data-flight-lookup>查询并补全</button></div><p class="flight-lookup-note">飞常准提供的机型等信息可能有误，建议用航旅纵横核对。</p><p class="flight-lookup-status" data-flight-status role="status" aria-live="polite"></p><div data-flight-candidates></div></section>`;
}

export function bindFlightLookup(form, { getRecord, getKey, canQuery, desktop, apply, applyTrack, onPending, lookup }) {
  const section = form.querySelector('.flight-lookup');
  if (!section) return () => {};
  const button = section.querySelector('[data-flight-lookup]'), status = section.querySelector('[data-flight-status]'), list = section.querySelector('[data-flight-candidates]');
  const cache = new Map();
  let disposed = false, activeRequest, candidates = [], candidateStamp = '', selectedKey = '';
  const stamp = () => { const record = getRecord(); return JSON.stringify(['type', 'service', 'departureDate', 'origin', 'originCode', 'destination', 'destinationCode'].map(field => record[field] || '')); };
  const isOpen = () => !disposed && form.isConnected;
  const validContext = original => isOpen() && canQuery() && desktop() && stamp() === original && getKey() === selectedKey;
  const changed = () => { if (isOpen()) status.textContent = '航班或连接已改变，请重新查询。'; };
  function refreshButton() {
    button.disabled = Boolean(activeRequest) || !desktop() || !canQuery();
  }
  refreshButton();
  if (!desktop()) status.textContent = '飞常准查询需电脑端行迹连接扩展';
  function connectorFor(signal) {
    if (!desktop()) throw new Error('请在电脑 Chrome 或 Edge 安装行迹连接扩展后查询');
    const key = getKey();
    if (!key) throw new Error('请先在「数据与同步」配置飞常准 Key');
    if (selectedKey !== key) cache.clear();
    selectedKey = key;
    return new FlightConnector(key, signal);
  }
  async function fromCache(key, fetchValue) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.value;
    const value = await fetchValue();
    cache.set(key, { value, at: Date.now() });
    return value;
  }
  const source = () => ({ kind: 'flight-lookup', label: '飞常准航班查询', at: new Date().toISOString() });
  function missingTrackRequest() {
    if (!applyTrack) return;
    const record = getRecord();
    try {
      const flightStr = flightTrackRequest(record);
      if (record.flightTrack?.flightStr !== flightStr) return flightStr;
    } catch { /* The track needs an active flight with both airports resolved. */ }
  }
  async function fillRegistration(connector, original, summary) {
    const query = flightQuery(getRecord());
    if (!query.dep || !query.arr) return '补全起降机场后可查询飞机编号。';
    status.textContent = summary + '正在查询飞机编号…';
    try {
      const value = await fromCache('registration:' + JSON.stringify(query), async () =>
        rotationRegistration(await connector.aircraftRotation(query), query));
      if (!validContext(original) || !flightLookupNeeds(getRecord()).registration) return '';
      if (!value) return '飞常准暂无飞机编号。';
      apply({ aircraftRegistration: value }, source());
      return '已补全飞机编号。';
    } catch (error) { return error.message + '。'; }
  }
  async function fillTrack(connector, flightStr, original, summary) {
    status.textContent = summary + '正在查询航迹…';
    try {
      const track = await fromCache('track:' + flightStr, async () => readFlightTrack(await connector.flightTrack(flightStr), flightStr));
      if (!validContext(original) || missingTrackRequest() !== flightStr) return '';
      if (!track) return '暂无这班航班的航迹。';
      applyTrack(track);
      return '已带入飞行航迹，随票据保存。';
    } catch (error) { return '航迹未获取。' + error.message; }
  }
  async function fillMissing(connector, summary = '', empty = '已有信息均已填写。') {
    const original = stamp();
    if (flightLookupNeeds(getRecord()).registration) {
      summary += await fillRegistration(connector, original, summary);
      if (!validContext(original)) return changed();
    }
    const flightStr = missingTrackRequest();
    if (flightStr) {
      summary += await fillTrack(connector, flightStr, original, summary);
      if (!validContext(original)) return changed();
    }
    status.textContent = summary || empty;
  }
  async function accept(index, connector) {
    if (!validContext(candidateStamp) || !candidates[index]) { list.innerHTML = ''; status.textContent = '查询条件已改变，请重新查询'; return; }
    const previousRows = candidates, candidate = candidates[index], recordBeforeLookup = getRecord();
    const changes = flightCompletion(recordBeforeLookup, candidate);
    const conflicts = candidate.aircraftConflicts ??
      (recordBeforeLookup.aircraft && candidate.aircraft ? reconcileAircraft([recordBeforeLookup.aircraft, candidate.aircraft]).conflicts : []);
    candidates = []; candidateStamp = ''; list.innerHTML = '';
    const fields = Object.keys(changes);
    if (fields.length) apply(changes, source());
    const confirmed = flightQuery(getRecord());
    const matching = previousRows.filter(row => (!confirmed.dep || row.originCode === confirmed.dep) && (!confirmed.arr || row.destinationCode === confirmed.arr));
    const confirmedKey = 'schedule:' + JSON.stringify(confirmed);
    if (!cache.has(confirmedKey)) cache.set(confirmedKey, { value: matching, at: Date.now() });
    const names = [...new Set(fields.map(field => ticketFieldLabel(field, 'flight', lookupLabels[field])))];
    let summary = names.length ? `已补全 ${names.join('、')}。` : '';
    if (conflicts.length) summary += `机型有出入（${conflicts.join('、')}），请核对。`;
    if (!recordBeforeLookup.boardingTime && !recordBeforeLookup.lockedFields?.includes('boardingTime') && !candidate.boardingTime) {
      summary += '飞常准未提供登机时间。';
    }
    await fillMissing(connector, summary, '本次没有可补全的航班信息。');
  }
  async function query(signal) {
    list.innerHTML = ''; candidates = []; candidateStamp = '';
    const record = getRecord(), request = flightQuery(record), needs = flightLookupNeeds(record);
    const needsSchedule = needs.schedule || needs.stopover || (needs.registration && (!request.dep || !request.arr));
    if (!needsSchedule && !needs.registration && !missingTrackRequest()) {
      status.textContent = '已有信息均已填写。';
      return;
    }
    const connector = connectorFor(signal), original = stamp();
    if (!needsSchedule) return fillMissing(connector);
    status.textContent = '正在查询飞常准…';
    let fetched;
    try {
      fetched = await fromCache('schedule:' + JSON.stringify(request), async () =>
        lookup ? lookup(request, selectedKey) : flightCandidates(await connector.flightStatus(request), request));
    } catch (error) {
      if (!validContext(original)) return changed();
      if (!request.dep || !request.arr) throw error;
      return fillMissing(connector, error.message + '。');
    }
    if (!validContext(original)) return changed();
    const rows = fetched.filter(row => row.service === request.fnum && sameDate(row.departureDate,request.date) && (!request.dep || row.originCode === request.dep) && (!request.arr || row.destinationCode === request.arr));
    if (!rows.length) return fillMissing(connector, '未查到可核对日期与机场的航班信息。');
    candidates = rows; candidateStamp = original;
    if (rows.length === 1) { await accept(0, connector); return; }
    status.textContent = `找到 ${rows.length} 个航段，请选择要补全的这一程。`;
    list.innerHTML = rows.map((row, index) => `<button type="button" class="flight-candidate" data-flight-candidate="${index}"><strong>${e(row.origin)} <code>${e(row.originCode)}</code> → ${e(row.destination)} <code>${e(row.destinationCode)}</code></strong><span>计划 ${e(calendarDate(row.departureDate))} ${e(row.departureTime)} → ${e(calendarDate(row.arrivalDate) || '日期待补充')} ${e(row.arrivalTime)}</span>${row.actualDepartureTime || row.actualArrivalTime ? `<span>实际 ${e(calendarDate(row.actualDepartureDate) || '日期待补充')} ${e(row.actualDepartureTime || '待补充')} → ${e(calendarDate(row.actualArrivalDate) || '日期待补充')} ${e(row.actualArrivalTime || '待补充')}</span>` : ''}<small>${e([row.airline, row.aircraft, row.flightDistance && '航程 ' + row.flightDistance + ' km'].filter(Boolean).join(' · '))} · 选择并补全</small></button>`).join('');
  }
  function run(action) {
    if (activeRequest || disposed || !canQuery()) return;
    activeRequest = new AbortController();
    refreshButton();
    const pending = action(activeRequest.signal)
      .catch(error => { if (isOpen()) status.textContent = error.message; })
      .finally(() => {
        activeRequest = undefined;
        if (isOpen()) refreshButton();
      });
    onPending?.(pending);
  }
  const click = event => {
    const target = event.target.closest('[data-flight-lookup],[data-flight-candidate]');
    if (!target) return;
    if (target.hasAttribute('data-flight-lookup')) run(query);
    else run(signal => accept(Number(target.dataset.flightCandidate), new FlightConnector(selectedKey, signal)));
  };
  const input = () => {
    if (candidateStamp && stamp() !== candidateStamp) { candidates = []; list.innerHTML = ''; status.textContent = '航班或机场已改变，请重新查询'; }
    refreshButton();
  };
  section.addEventListener('click', click); form.addEventListener('input', input);
  return () => { disposed = true; activeRequest?.abort(); cache.clear(); section.removeEventListener('click', click); form.removeEventListener('input', input); };
}
