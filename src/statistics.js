import {tripChartMarkup,bindTripChart} from './statistics-chart.js';
import { escape as e } from './html.js';
import { journeyStatistics, statisticsOptions, todayDate, tripSeries, countryName } from './statistics-model.js';
import { rankingViews, rankingChartMarkup } from './statistics-ranking.js';

const empty = text => `<p class="statistics-empty">${text}</p>`;
function placesPanel(title, places, type) {
  return `<section class="statistics-panel"><header><h2>${title}</h2><span>${places.length} 个</span></header>${places.length ? `<ul class="statistics-place-list statistics-${type}-list" tabindex="0" aria-label="${title}列表">${places.map(place => type === 'station' ? `<li>${e(place.name)}</li>` : `<li><span>${e(place.name)}<small>${e(countryName(place.country))}</small></span><code>${e(place.code)}</code></li>`).join('')}</ul>` : empty('暂无已识别的' + title.replace('去过的', ''))}</section>`;
}

const rankings = {
  'rail-models': { title: '乘坐车型', data: 'railModels', unit: '种', option: 'railPowerSupplies', label: '细分供电制式' },
  'rail-bureaus': { title: '担当路局', data: 'railBureaus', unit: '个', option: 'railUnits', label: '细分车辆归属单位' },
  aircraft: { title: '乘坐机型', data: 'aircraft', unit: '种', option: 'aircraftSubtypes', label: '细分子型号' }
};

export function mountStatistics(container, records, { options = {} } = {}) {
  Object.assign(options, statisticsOptions(options));
  const rankingCharts = options.rankingCharts ??= {};
  let statistics, dateDialog;
  let series = [],chartCleanup=()=>{};
  const scrollPositions = { year: null, month: null };
  function rankingPanel(kind) {
    const { title, data, unit, option, label } = rankings[kind];
    const rows = statistics[data], view = rankingCharts[kind] || 'bars';
    const chooser = Object.entries(rankingViews).map(([value, name]) => `<button type="button" data-stat-view="${value}" aria-pressed="${view === value}">${name}</button>`).join('');
    return `<section class="statistics-panel statistics-ranking" data-stat-ranking="${kind}"><header><h2>${title}</h2><span>${rows.length} ${unit}</span></header><div class="statistics-ranking-controls"><div class="statistics-view-picker" role="group" aria-label="${title}图表样式">${chooser}</div><label><input type="checkbox" data-stat-option="${option}" ${options[option] ? 'checked' : ''}/>${label}</label></div><div data-stat-plot>${rankingChartMarkup(title, rows, view)}</div></section>`;
  }
  function render() {
    chartCleanup();
    const data = statistics = journeyStatistics(records, options);
    const yearChoices = data.years.length ? Array.from({ length: Number(data.years.at(-1)) - Number(data.years[0]) + 1 }, (_, i) => String(Number(data.years[0]) + i)) : [todayDate().slice(0, 4)];
    if (!yearChoices.includes(options.year)) options.year = yearChoices.at(-1);
    series = data.records.length ? tripSeries(data.records, options) : [];
    const rangeButton = (key, label, attr) => `<div class="statistics-range-field"><span>${label}</span><button type="button" class="statistics-date-button" ${attr} data-stat-date="${key}" aria-label="${label}，${e(options[key] || '不限')}" aria-haspopup="dialog">${e(options[key] || '不限')}</button></div>`;
    container.innerHTML = `<section class="statistics-range" aria-label="统计日期范围"><div>${rangeButton('dateFrom', '起始日期', 'data-stat-from')}<span class="statistics-range-dash">—</span>${rangeButton('dateTo', '截止日期', 'data-stat-to')}<button type="button" class="text-button" data-stat-reset aria-label="恢复默认日期" title="恢复默认日期"><span class="statistics-reset-symbol" aria-hidden="true">↺</span><span class="statistics-reset-label">恢复默认</span></button></div><p class="form-error" role="alert" ${data.error ? '' : 'hidden'}>${e(data.error)}</p></section>${data.error ? '' : `
      <section class="statistics-summary" aria-label="所选日期范围的乘坐记录">${[['火车', data.rail, '次'], ['飞机', data.flight, '次'], ['机场', data.airports.length, '个'], ['火车站', data.stations.length, '个']].map(([label, count, unit]) => `<div><span>${label}</span><strong>${count}<small>${unit}</small></strong></div>`).join('')}</section>
      <section class="statistics-mileage" aria-label="铁路里程"><span>铁路里程</span><strong>${data.railMileageTrips ? data.railMileage.toLocaleString('zh-CN',{maximumFractionDigits:3}) : '—'} <small>km</small></strong><span>${data.railMileageTrips} / ${data.rail} 程已收录里程</span></section>
      <section class="statistics-panel statistics-trend"><header><h2>乘坐次数</h2><div class="statistics-period-controls"><div role="group" aria-label="统计图时间粒度">${[['year', '按年'], ['month', '按月']].map(([value, label]) => `<button data-stat-scale="${value}" aria-pressed="${options.period === value}">${label}</button>`).join('')}</div><label ${options.period === 'month' ? '' : 'hidden'}><span class="visually-hidden">月度图年份</span><select data-stat-year aria-label="月度图年份">${[...yearChoices].reverse().map(year => `<option ${options.year === year ? 'selected' : ''}>${e(year)}</option>`).join('')}</select></label></div></header>${tripChartMarkup(series,{zoom:options.chartZoom,viewportWidth:container.clientWidth || 720})}</section>
      <div class="statistics-columns">${rankingPanel('rail-models')}${rankingPanel('rail-bureaus')}</div>
      <div class="statistics-columns">${rankingPanel('aircraft')}
      <section class="statistics-panel"><header><h2>去过的大洲和国家</h2></header><h3>大洲 <span>${data.continents.length}</span></h3>${data.continents.length ? `<ul class="statistics-chips">${data.continents.map(row => `<li>${e(row.name)}</li>`).join('')}</ul>` : empty('暂无已识别的大洲')}<h3>国家 <span>${data.countries.length}</span></h3>${data.countries.length ? `<ul class="statistics-chips countries">${data.countries.map(row => `<li>${e(row.name)}</li>`).join('')}</ul>` : empty('暂无已识别的国家')}</section></div>
      <div class="statistics-columns">${placesPanel('去过的机场', data.airports, 'airport')}${placesPanel('去过的火车站', data.stations, 'station')}</div>
      <section class="statistics-panel" data-stat-routes><header><h2>乘坐过的航线</h2><div class="statistics-route-controls"><label><input type="checkbox" data-stat-merge-routes ${options.mergeDirections ? 'checked' : ''}/>合并双向航线</label><span>${data.routes.length} 条</span></div></header>${data.routes.length ? `<div class="statistics-table-scroll"><table class="statistics-routes"><thead><tr><th>航线</th><th>次数</th></tr></thead><tbody>${data.routes.map(route => `<tr><td><div class="statistics-route-pair"><span class="statistics-route-endpoint">${e(route.from.name)} <code>${e(route.from.code)}</code></span><span class="statistics-route-arrow" role="img" aria-label="${options.mergeDirections ? '双向' : '前往'}">${options.mergeDirections ? '↔' : '→'}</span><span class="statistics-route-endpoint">${e(route.to.name)} <code>${e(route.to.code)}</code></span></div></td><td>${route.count}</td></tr>`).join('')}</tbody></table></div>` : empty('暂无可识别的航线')}</section>`}`;
    chartCleanup=bindTripChart(container,series,options,{onZoom:()=>{const scroll=container.querySelector('.statistics-chart-scroll');if(scroll)scrolled({target:scroll});}});
    const scroll = container.querySelector('.statistics-chart-scroll');
    if (scroll) {
      if (scrollPositions[options.period] !== null) scroll.scrollLeft = scrollPositions[options.period];
      else if (options.period === 'month') scrollToYear();
      else scroll.scrollLeft = scroll.scrollWidth;
    }
  }
  function scrollToYear() {
    const scroll = container.querySelector('.statistics-chart-scroll'), svg = container.querySelector('.statistics-chart');
    const point = container.querySelector(`[data-stat-period="${options.year}-01"]`);
    if (!scroll || !point) return;
    const width = Number(svg.getAttribute('viewBox').split(' ')[2]);
    const scale = (svg.getBoundingClientRect().width || width) / width;
    scroll.scrollLeft = Math.max(0, (Number(point.getAttribute('cx')) - 42) * scale);
    scrollPositions.month = scroll.scrollLeft;
  }
  function scrolled(event) {
    const scroll = event.target;
    if (!scroll.matches('.statistics-chart-scroll')) return;
    scrollPositions[options.period] = scroll.scrollLeft;
    if (options.period !== 'month' || !series.length) return;
    const svg = scroll.querySelector('svg'), width = Number(svg.getAttribute('viewBox').split(' ')[2]);
    const scale = (svg.getBoundingClientRect().width || width) / width;
    const index = Math.round(((scroll.scrollLeft + scroll.clientWidth / 2) / scale - 42) / (width - 84) * (series.length - 1));
    options.year = series[Math.max(0, Math.min(series.length - 1, index))].key.slice(0, 4);
    container.querySelector('[data-stat-year]').value = options.year;
  }
  function updateDate(key, value) {
    options[key] = value;
    scrollPositions.year = scrollPositions.month = null;
    render();
    container.querySelector(`[data-stat-date="${key}"]`).focus();
  }
  function openDate(button) {
    if (dateDialog?.open) return;
    const key = button.dataset.statDate, label = key === 'dateFrom' ? '起始日期' : '截止日期';
    const dialog = dateDialog = container.ownerDocument.createElement('dialog');
    dialog.className = 'modal statistics-date-dialog';
    dialog.setAttribute('aria-label', label);
    dialog.innerHTML = `<form method="dialog" class="detail-body"><label class="field"><span>${label}</span><input type="date" name="date" min="1800-01-01" max="2200-12-31" value="${e(options[key] || todayDate())}" required /></label><div class="button-row"><button type="button" class="text-button" data-clear-date>不限</button><button type="button" class="button secondary" data-cancel-date>取消</button><button type="submit" class="button primary">应用</button></div></form>`;
    const form = dialog.querySelector('form');
    const finish = value => {
      dialog.close();
      if (value !== undefined) updateDate(key, value);
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (form.checkValidity()) finish(form.elements.date.value);
    });
    dialog.querySelector('[data-clear-date]').addEventListener('click', () => finish(''));
    dialog.querySelector('[data-cancel-date]').addEventListener('click', () => finish());
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (dateDialog === dialog) dateDialog = null;
      if (button.isConnected) button.focus();
    });
    container.append(dialog);
    dialog.showModal();
  }
  const change = event => {
    const target = event.target;
    if (target.matches('[data-stat-option]') && ['railUnits','railPowerSupplies','aircraftSubtypes'].includes(target.dataset.statOption)) {
      options[target.dataset.statOption]=target.checked;
      const scroll=container.querySelector('.statistics-chart-scroll'); if(scroll) scrollPositions[options.period]=scroll.scrollLeft;
      const key=target.dataset.statOption; render(); container.querySelector(`[data-stat-option="${key}"]`).focus(); return;
    }
    else if (target.matches('[data-stat-merge-routes]')) {
      options.mergeDirections=target.checked;
      const scroll=container.querySelector('.statistics-chart-scroll'); if(scroll) scrollPositions[options.period]=scroll.scrollLeft;
      render(); container.querySelector('[data-stat-merge-routes]').focus(); return;
    }
    else if (target.matches('[data-stat-year]')) { options.year = target.value; scrollToYear(); }
  };
  const click = event => {
    const date = event.target.closest('[data-stat-date]');
    if (date) { openDate(date); return; }
    const view = event.target.closest('[data-stat-view]');
    if (view) {
      if (view.getAttribute('aria-pressed') === 'true') return;
      const panel = view.closest('[data-stat-ranking]'), kind = panel.dataset.statRanking;
      const { title, data } = rankings[kind];
      rankingCharts[kind] = view.dataset.statView;
      panel.querySelector('[aria-pressed="true"][data-stat-view]').setAttribute('aria-pressed', 'false');
      view.setAttribute('aria-pressed', 'true');
      panel.querySelector('[data-stat-plot]').innerHTML = rankingChartMarkup(title, statistics[data], rankingCharts[kind]);
      return;
    }
    const scale = event.target.closest('[data-stat-scale]');
    if (scale) {
      const period = scale.dataset.statScale;
      if (period !== options.period) {
        options.period = period;
        render();
        container.querySelector(`[data-stat-scale="${period}"]`).focus({ preventScroll: true });
      }
      return;
    }
    if (event.target.closest('[data-stat-reset]')) {
      options.dateFrom = '';
      options.dateTo = todayDate();
      scrollPositions.year = scrollPositions.month = null;
      render();
      container.querySelector('[data-stat-reset]').focus({ preventScroll: true });
    }
  };
  container.addEventListener('change', change);
  container.addEventListener('click', click);
  container.addEventListener('scroll', scrolled, true);
  render();
  return () => {
    dateDialog?.remove();
    chartCleanup();
    container.removeEventListener('change', change);
    container.removeEventListener('click', click);
    container.removeEventListener('scroll', scrolled, true);
  };
}
