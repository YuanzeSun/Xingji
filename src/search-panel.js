import {calendarDate} from './journey-date.js';
import { ticketTemplateChoices } from './rail-template.js';
import { escape as e, selectOptions } from './html.js';
import { dateControl } from './date-field.js';
import { activeSearch, SORTS } from './search.js';
import { cityOverview, placesInCity, locationWords } from './locations.js';

const selected = (a, b) => a === b ? 'selected' : '';
export function searchChips(filters) {
  return activeSearch(filters).map(c => `<button class="search-chip" data-action="clear-search-field" data-field="${e(c.key)}" aria-label="移除条件：${e(c.label)}">${e(c.label)}<span aria-hidden="true">×</span></button>`).join('');
}
export function resultSummary(result, total) {
  if (result.error) return '请检查筛选条件';
  const rail = result.records.filter(r => r.type === 'rail').length;
  return `找到 ${result.records.length} 张 / 共 ${total} 张 · 火车票 ${rail} · 机票 ${result.records.length - rail}`;
}
export function cityContextHTML(records, filters) {
  const cities = [...new Set([filters.city, filters.originCity, filters.destinationCity].filter(c => c && c !== '__unknown__'))];
  if (cities.length) return cities.map(city => {
    const places = placesInCity(records, city);
    return `<p><strong>${e(city)} · 同城地点联查</strong>${places.length ? '：' + places.slice(0, 15).map(e).join('、') + (places.length > 15 ? '…' : '') : '：尚无已归属到此城市的地点'}</p>`;
  }).join('');
  const count = cityOverview(records).unassigned;
  return count ? `<p>${count} 张票存在待确认的城市，可选“城市待补充”查找，并在编辑票据时手动指定。</p>` : '';
}
export function searchPanel(records, filters, result, { open = false, routesOpen = false, demo = false } = {}) {
  const overview = cityOverview(records);
  const years = [...new Set(records.map(r => calendarDate(r.departureDate).slice(0, 4)).filter(Boolean))].sort().reverse();
  const rail = records.filter(r => r.type === 'rail').length;
  const values = keys => [...new Set(records.flatMap(r => keys.map(k => r[k])).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const suggestions = { city: overview.cities.map(([city]) => city), place: values(['origin', 'destination', 'originCode', 'destinationCode']), passenger: values(['passenger']), service: values(['service']), seatClass: values(['seatClass']), airline: values(['airline']) };
  const placeLabels = new Map();
  for (const r of records) for (const side of ['origin', 'destination']) if (r[side]) placeLabels.set(r[side], locationWords(r, side).join(' · '));
  const input = (key, label, placeholder = '', list = '') => `<label class="field"><span>${label}</span><input id="search-${key}" data-search-field="${key}" value="${e(filters[key])}" placeholder="${e(placeholder)}" ${list ? `list="search-list-${list}"` : ''} maxlength="200" ${['minPrice', 'maxPrice'].includes(key) ? 'inputmode="decimal"' : ''} /></label>`;
  const date = (key,label) => `<label class="field"><span>${label}</span>${dateControl(key,filters[key],false,{id:'search-'+key,searchField:key})}</label>`;
  const select = (key, label, options) => `<label class="field"><span>${label}</span><select id="search-${key}" data-search-field="${key}">${selectOptions(options, filters[key])}</select></label>`;
  const tabs = [['all', '全部票据', records.length], ['rail', '火车票', rail], ['flight', '机票', records.length - rail]].map(([id, label, count]) => `<button class="tab ${filters.type === id ? 'selected' : ''}" data-action="filter" data-type="${id}" aria-pressed="${filters.type === id}">${label}<span>${count}</span></button>`).join('');
  const citySelect = `<select id="city-filter" data-search-field="city" aria-label="按城市筛选"><option value="">全部城市</option>${overview.cities.map(([city, count]) => `<option value="${e(city)}" ${selected(filters.city, city)}>${e(city)} · ${count} 张</option>`).join('')}${overview.unassigned ? `<option value="__unknown__" ${selected(filters.city, '__unknown__')}>城市待补充 · ${overview.unassigned} 张</option>` : ''}</select>`;
  const quickRoutes = overview.routes.slice(0, 5).map(r => `<button class="route-shortcut" data-action="quick-route" data-from="${e(r.originCity)}" data-to="${e(r.destinationCity)}">${e(r.originCities.join(' / '))} ↔ ${e(r.destinationCities.join(' / '))}<span>${r.count}</span></button>`).join('');
  const primaryFields = input('originCity', '出发城市', '如 北京、beijing', 'city') + input('destinationCity', '到达城市', '如 上海、shanghai', 'city') + date('dateFrom','出发日期 · 从') + date('dateTo','出发日期 · 至') + input('service', '车次 / 航班号', '如 G103、CA181', 'service') + input('passenger', '旅客姓名', '按旅客查找', 'passenger') + input('seatClass', '席别 / 舱位', '如 二等座、Y', 'seatClass') + input('airline', '航空公司', '如 中国国际航空', 'airline');
  const extraFields = input('origin', '出发车站 / 机场关键词', '名称、拼音、首字母或代码', 'place') + input('destination', '到达车站 / 机场关键词', '名称、拼音、首字母或代码', 'place') + select('template', '票面样式', [['', '所有样式'], ...ticketTemplateChoices({ archive: true })]) + select('code', '条码 · 仅火车票', [['', '不限定'], ['with', '已收录'], ['without', '尚未收录']]) + input('mark', '票面标识', '如 网、学、孩') + input('minPrice', '最低票价', '不限') + input('maxPrice', '最高票价', '不限');
  const hasRoute = ['originCity', 'destinationCity', 'origin', 'destination'].some(k => filters[k]);
  return `<section class="archive-search" aria-label="票据检索">
    <div class="collection-bar"><div class="tabs" role="group" aria-label="交通方式">${tabs}</div><div class="filter-inputs"><label class="search-box"><span aria-hidden="true">⌕</span><input type="search" id="search" data-search-field="query" aria-label="搜索票据" placeholder="搜索城市、地点、班次、旅客、票号…" maxlength="1000" value="${e(filters.query)}" /></label>${citySelect}<select id="year-filter" data-search-field="year" aria-label="按年份筛选"><option value="all">全部年份</option>${years.map(y => `<option ${selected(filters.year, y)}>${y}</option>`).join('')}${records.some(r => !calendarDate(r.departureDate)) ? `<option value="unknown" ${selected(filters.year, 'unknown')}>日期待补充</option>` : ''}</select></div></div>
    <div class="search-utilities"><details class="search-help"><summary>搜索用法</summary><p>空格分词，双引号查短语，减号排除。支持拼音、首字母和机场码。</p></details><button class="text-button" data-action="reset-filters">清除全部条件</button></div>
    <div id="city-context" class="city-context">${cityContextHTML(records, filters)}</div>
    ${quickRoutes ? `<section class="route-shortcuts-section" data-expanded="${routesOpen}"><button class="route-shortcuts-toggle" data-action="toggle-routes" aria-expanded="${routesOpen}" aria-controls="common-route-list">常用路线<span aria-hidden="true">⌄</span></button><div class="route-shortcuts" id="common-route-list"><span class="routes-desktop-label">常用城市路线</span>${quickRoutes}</div></section>` : ''}
    <details class="advanced-search" id="advanced-search" ${open ? 'open' : ''}><summary>组合筛选<span>城市、日期、旅客与票面细节</span></summary><div class="advanced-search-body"><div class="search-field-grid">${primaryFields}</div><div class="route-tools"><label class="checkbox-row reverse-route"><input type="checkbox" id="search-bothDirections" data-search-field="bothDirections" ${filters.bothDirections ? 'checked' : ''} ${hasRoute ? '' : 'disabled'} />包含返程</label><button class="text-button" data-action="swap-route">⇄ 交换出发与到达</button></div><details class="search-more"><summary>更多票面与车站条件</summary><div class="search-field-grid">${extraFields}</div></details></div></details>
    <div id="search-chips" class="search-chips">${searchChips(filters)}</div><div class="search-results-bar"><p id="search-result-count" role="status" aria-live="polite">${e(resultSummary(result, records.length))}</p><div class="search-result-actions"><label><span class="visually-hidden">结果排序</span><select id="search-sort" data-search-field="sort" aria-label="结果排序">${Object.entries(SORTS).map(([value, label]) => `<option value="${value}" ${selected(filters.sort, value)}>${e(label)}</option>`).join('')}</select></label></div></div><p id="search-error" class="form-error" role="alert" ${result.error ? '' : 'hidden'}>${e(result.error)}</p>
    ${Object.entries(suggestions).map(([name, list]) => `<datalist id="search-list-${name}">${list.slice(0, 150).map(value => `<option value="${e(value)}" ${name === 'place' && placeLabels.has(value) ? `label="${e(placeLabels.get(value))}"` : ''}></option>`).join('')}</datalist>`).join('')}
  </section>`;
}
