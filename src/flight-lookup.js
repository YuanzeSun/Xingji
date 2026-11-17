import {calendarDate,sameDate} from './journey-date.js';
import { escape as e } from './html.js';
import { flightQuery, flightCompletion } from './flight-lookup-model.js';
import { lookupFlight } from './flight-data.js';

export function flightLookupMarkup() {
  return `<section class="flight-lookup" aria-label="航班信息补全"><div class="flight-lookup-heading"><span>数据来源：飞常准</span><button class="button secondary small" type="button" data-flight-lookup>查询并补全</button></div><p class="fine-print">填写航班号和出发日期后查询，仅补全空白信息。查询使用你的飞常准账户额度。</p><p class="flight-lookup-status" data-flight-status role="status" aria-live="polite"></p><div data-flight-candidates></div></section>`;
}

export function bindFlightLookup(form, { getRecord, getKey, canQuery, desktop, apply, lookup = lookupFlight }) {
  const section = form.querySelector('.flight-lookup');
  if (!section) return () => {};
  const button = section.querySelector('[data-flight-lookup]'), status = section.querySelector('[data-flight-status]'), list = section.querySelector('[data-flight-candidates]');
  const cache = new Map();
  let disposed = false, busy = false, candidates = [], candidateStamp = '', cacheOwner = '', selectedKey = '';
  const stamp = () => { const record = getRecord(); return JSON.stringify(['type', 'service', 'departureDate', 'origin', 'originCode', 'destination', 'destinationCode'].map(field => record[field] || '')); };
  const validContext = original => !disposed && form.isConnected && canQuery() && desktop() && stamp() === original && getKey() === selectedKey;
  if (!desktop()) { button.disabled = true; status.textContent = '飞常准查询目前需电脑浏览器和连接扩展，手机仍可手动填写或扫描导入。'; }
  function accept(index) {
    if (!validContext(candidateStamp) || !candidates[index]) { list.innerHTML = ''; status.textContent = '查询条件已改变，请重新查询'; return; }
    const previousRows = candidates, changes = flightCompletion(getRecord(), candidates[index]);
    const count = Object.keys(changes).filter(field => !field.endsWith('Code')).length;
    if (count) apply(changes, { kind: 'flight-lookup', label: '飞常准航班查询', at: new Date().toISOString() });
    cache.set(JSON.stringify(flightQuery(getRecord())), { rows: previousRows, at: Date.now() });
    status.textContent = count ? `已补全 ${count} 项，保留已填写信息。请核对后保存。` : '已有信息均已填写，未覆盖或修改。';
    list.innerHTML = '';
  }
  async function query() {
    if (busy || disposed || !canQuery()) return;
    list.innerHTML = ''; candidates = [];
    try {
      if (!desktop()) throw new Error('请在电脑浏览器使用飞常准连接扩展查询');
      const request = flightQuery(getRecord()), key = getKey();
      if (!key) throw new Error('请先在“数据与同步”配置飞常准 Key');
      if (cacheOwner !== key) { cache.clear(); cacheOwner = key; }
      selectedKey = key;
      const original = stamp(), cacheKey = JSON.stringify(request), cached = cache.get(cacheKey);
      busy = true; button.disabled = true; button.textContent = '正在查询…'; status.textContent = '正在查询飞常准…';
      const fetched = cached && Date.now() - cached.at < 5 * 60 * 1000 ? cached.rows : await lookup('variflight', request, key);
      const rows = fetched.filter(row => row.service === request.fnum && sameDate(row.departureDate,request.date) && (!request.dep || row.originCode === request.dep) && (!request.arr || row.destinationCode === request.arr));
      if (!validContext(original)) { if (!disposed && form.isConnected) status.textContent = '查询条件或连接已改变，本次结果未填入'; return; }
      cache.set(cacheKey, { rows, at: Date.now() }); candidates = rows; candidateStamp = original;
      if (!rows.length) { status.textContent = '未查到可核对日期与机场的航班信息，原有内容未改变。'; return; }
      if (rows.length === 1) { accept(0); return; }
      status.textContent = `找到 ${rows.length} 个航段，请选择要补全的这一程。`;
      list.innerHTML = rows.map((row, index) => `<button type="button" class="flight-candidate" data-flight-candidate="${index}"><strong>${e(row.origin)} <code>${e(row.originCode)}</code> → ${e(row.destination)} <code>${e(row.destinationCode)}</code></strong><span>计划 ${e(calendarDate(row.departureDate))} ${e(row.departureTime)} → ${e(calendarDate(row.arrivalDate) || '日期待补充')} ${e(row.arrivalTime)}</span>${row.actualDepartureTime || row.actualArrivalTime ? `<span>实际 ${e(calendarDate(row.actualDepartureDate) || '日期待补充')} ${e(row.actualDepartureTime || '待补充')} → ${e(calendarDate(row.actualArrivalDate) || '日期待补充')} ${e(row.actualArrivalTime || '待补充')}</span>` : ''}<small>${e([row.airline, row.aircraft, row.flightDistance && '航程 ' + row.flightDistance + ' km'].filter(Boolean).join(' · '))} · 选择并补全</small></button>`).join('');
    } catch (error) { if (!disposed && form.isConnected) status.textContent = error.message; }
    finally { busy = false; if (!disposed && form.isConnected) { button.disabled = !desktop() || !canQuery(); button.textContent = '查询并补全'; } }
  }
  const click = event => { const target = event.target.closest('[data-flight-lookup],[data-flight-candidate]'); if (!target) return; if (target.hasAttribute('data-flight-lookup')) query(); else accept(Number(target.dataset.flightCandidate)); };
  const input = () => { if (candidateStamp && stamp() !== candidateStamp) { candidates = []; list.innerHTML = ''; status.textContent = '航班或机场已改变，请重新查询'; } };
  section.addEventListener('click', click); form.addEventListener('input', input);
  return () => { disposed = true; cache.clear(); section.removeEventListener('click', click); form.removeEventListener('input', input); };
}
