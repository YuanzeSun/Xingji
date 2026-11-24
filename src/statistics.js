import {tripChartMarkup,bindTripChart} from './statistics-chart.js';
import { escape as e } from './html.js';
import { journeyStatistics, statisticsOptions, todayDate, tripSeries, countryName } from './statistics-model.js';
import { rankingViews, rankingChartMarkup } from './statistics-ranking.js';

const empty = text => `<p class="statistics-empty">${text}</p>`;
const metricMarkup = (value, unit, maximumFractionDigits = 0) => `${value.toLocaleString('zh-CN', { maximumFractionDigits })}<small> ${unit}</small>`;
function durationMarkup(minutes) {
  const days = Math.floor(minutes / 1440), hours = Math.floor(minutes % 1440 / 60), remainder = minutes % 60;
  return [[days, '天'], [hours, '小时'], [remainder, '分']].filter(([value]) => value)
    .map(([value, unit]) => `<span>${value.toLocaleString('zh-CN')} <small>${unit}</small></span>`).join(' ');
}
function placesPanel(title, places, type) {
  return `<section class="statistics-panel"><header><h2>${title}</h2><span>${places.length} 个</span></header>${places.length ? `<ul class="statistics-place-list statistics-${type}-list" tabindex="0" aria-label="${title}列表">${places.map(place => type === 'station' ? `<li>${e(place.name)}</li>` : `<li><span>${e(place.name)}<small>${e(countryName(place.country))}</small></span><code>${e(place.code)}</code></li>`).join('')}</ul>` : empty('暂无已识别的' + title.replace('去过的', ''))}</section>`;
}

const rankings = {
  'rail-models': { title: '乘坐车型', data: 'railModels', unit: '种', option: 'railPowerSupplies', label: '细分供电制式' },
  'rail-bureaus': { title: '担当路局', data: 'railBureaus', unit: '个', option: 'railUnits', label: '细分车辆归属单位' },
  aircraft: { title: '乘坐机型', data: 'aircraft', unit: '种', option: 'aircraftSubtypes', label: '细分子型号', unknown: 'unknownAircraft', unknownLabel: '未识别机型' },
  airlines: { title: '乘坐航司', data: 'airlines', unit: '家', unknown: 'unknownAirlines', unknownLabel: '未识别航司' }
};

export function mountStatistics(container, records, { options = {} } = {}) {
  Object.assign(options, statisticsOptions(options), { dateTo: options.dateTo || '' });
  const rankingCharts = options.rankingCharts ??= {};
  const doc = container.ownerDocument, win = doc.defaultView;
  let statistics, dateDialog, renderedDay;
  let series = [],chartCleanup=()=>{};
  const scrollPositions = { year: null, month: null };
  function rankingPanel(kind) {
    const { title, data, unit, option, label, unknown, unknownLabel } = rankings[kind];
    const rows = statistics[data], view = rankingCharts[kind] || 'donut';
    const chooser = Object.entries(rankingViews).map(([value, name]) => `<button type="button" data-stat-view="${value}" aria-pressed="${view === value}">${name}</button>`).join('');
    const grouping = kind === 'airlines'
      ? `<div class="statistics-airline-basis" role="radiogroup" aria-labelledby="statistics-airline-basis-label"><span id="statistics-airline-basis-label">联程航班</span>${[['operating', '按实际承运'], ['marketing', '按购票航司']].map(([value, name]) => `<label><input type="radio" name="airline-basis" value="${value}" data-stat-option="marketingAirlines" ${options.marketingAirlines === (value === 'marketing') ? 'checked' : ''}/>${name}</label>`).join('')}</div>`
      : option ? `<label><input type="checkbox" data-stat-option="${option}" ${options[option] ? 'checked' : ''}/>${label}</label>` : '';
    const unidentified = statistics[unknown] ? `<p class="fine-print">${unknownLabel} · ${statistics[unknown]} 次</p>` : '';
    return `<section class="statistics-panel statistics-ranking" data-stat-ranking="${kind}"><header><h2>${title}</h2><span>${rows.length} ${unit}</span></header><div class="statistics-ranking-controls"><div class="statistics-view-picker" role="group" aria-label="${title}图表样式">${chooser}</div>${grouping}</div><div data-stat-plot>${rankingChartMarkup(title, rows, view)}</div>${unidentified}</section>`;
  }
  function render() {
    chartCleanup();
    renderedDay = todayDate();
    const data = statistics = journeyStatistics(records, options, renderedDay);
    const yearChoices = data.years.length ? Array.from({ length: Number(data.years.at(-1)) - Number(data.years[0]) + 1 }, (_, i) => String(Number(data.years[0]) + i)) : [todayDate().slice(0, 4)];
    if (!yearChoices.includes(options.year)) options.year = yearChoices.at(-1);
    series = data.records.length ? tripSeries(data.records, options) : [];
    const rangeButton = (key, label, attr) => {
      const value = options[key] || (key === 'dateTo' ? renderedDay : '不限');
      return `<div class="statistics-range-field"><span>${label}</span><button type="button" class="statistics-date-button" ${attr} data-stat-date="${key}" aria-label="${label}，${e(value)}" aria-haspopup="dialog">${e(value)}</button></div>`;
    };
    const { rail, flight } = data.travelTime;
    const transportMetrics = [
      ['火车', data.rail, [
        ['乘坐次数', metricMarkup(data.rail, '次')],
        ['火车站数', metricMarkup(data.stations.length, '个')],
        ['铁路里程', metricMarkup(data.railMileage, 'km', 3), data.railMileageTrips, '程已收录里程'],
        ['总在途时间', durationMarkup(rail.minutes), rail.trips, '程可计算']
      ]],
      ['飞机', data.flight, [
        ['航班数', metricMarkup(data.flight, '班')],
        ['机场数', metricMarkup(data.airports.length, '个')],
        ['实际飞行航程', metricMarkup(data.actualFlightDistance, 'km', 1), data.actualFlightDistanceTrips, '程已收录航迹'],
        ['总在途时间', durationMarkup(flight.minutes), flight.trips, '程可计算']
      ]]
    ];
    container.innerHTML = `<section class="statistics-range" aria-label="统计日期范围"><div>${rangeButton('dateFrom', '起始日期', 'data-stat-from')}<span class="statistics-range-dash">—</span>${rangeButton('dateTo', '截止日期', 'data-stat-to')}<button type="button" class="text-button" data-stat-reset aria-label="恢复默认日期" title="恢复默认日期"><span class="statistics-reset-symbol" aria-hidden="true">↺</span><span class="statistics-reset-label">恢复默认</span></button></div><p class="form-error" role="alert" ${data.error ? '' : 'hidden'}>${e(data.error)}</p></section>${data.error ? '' : `
      <section class="statistics-columns statistics-journey-metrics" aria-label="所选日期范围的行程统计">${transportMetrics.map(([transport, total, metrics]) =>
        `<section class="statistics-panel statistics-journey-card"><h2>${transport}</h2><dl>${metrics.map(([label, value, count, coverage]) =>
          `<div><dt>${label}</dt><dd><strong>${count === 0 ? '—' : value}</strong>${coverage ? `<span>${count} / ${total} ${coverage}</span>` : ''}</dd></div>`).join('')}</dl></section>`).join('')}</section>
      <section class="statistics-panel statistics-trend"><header><h2>乘坐次数</h2><div class="statistics-period-controls"><div role="group" aria-label="统计图时间粒度">${[['year', '按年'], ['month', '按月']].map(([value, label]) => `<button data-stat-scale="${value}" aria-pressed="${options.period === value}">${label}</button>`).join('')}</div><label ${options.period === 'month' ? '' : 'hidden'}><span class="visually-hidden">月度图年份</span><select data-stat-year aria-label="月度图年份">${[...yearChoices].reverse().map(year => `<option ${options.year === year ? 'selected' : ''}>${e(year)}</option>`).join('')}</select></label></div></header>${tripChartMarkup(series,{zoom:options.chartZoom,viewportWidth:container.clientWidth || 720})}</section>
      <div class="statistics-columns">${rankingPanel('rail-models')}${rankingPanel('rail-bureaus')}</div>
      <div class="statistics-columns">${rankingPanel('airlines')}${rankingPanel('aircraft')}</div>
      <section class="statistics-panel"><header><h2>去过的大洲和国家</h2></header><h3>大洲 <span>${data.continents.length}</span></h3>${data.continents.length ? `<ul class="statistics-chips">${data.continents.map(row => `<li>${e(row.name)}</li>`).join('')}</ul>` : empty('暂无已识别的大洲')}<h3>国家 <span>${data.countries.length}</span></h3>${data.countries.length ? `<ul class="statistics-chips countries">${data.countries.map(row => `<li>${e(row.name)}</li>`).join('')}</ul>` : empty('暂无已识别的国家')}</section>
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
    const dialog = dateDialog = doc.createElement('dialog');
    dialog.className = 'modal statistics-date-dialog';
    dialog.setAttribute('aria-label', label);
    const today = todayDate();
    const isEnd = key === 'dateTo';
    const value = options[key] || (isEnd ? today : '');
    dialog.innerHTML = `<form method="dialog" class="detail-body"><label class="field"><span>${label}</span><input type="date" name="date" min="1800-01-01" max="${today}" value="${e(value)}" required /></label><div class="button-row"><button type="button" class="text-button" data-clear-date>${isEnd ? '截至今天' : '不限'}</button><button type="button" class="button secondary" data-cancel-date>取消</button><button type="submit" class="button primary">应用</button></div></form>`;
    const form = dialog.querySelector('form');
    const finish = value => {
      dialog.close();
      if (value !== undefined) updateDate(key, value);
    };
    form.addEventListener('submit', event => {
      event.preventDefault();
      form.elements.date.max = todayDate();
      if (form.checkValidity()) finish(form.elements.date.value);
    });
    dialog.querySelector('[data-clear-date]').addEventListener('click', () => finish(''));
    dialog.querySelector('[data-cancel-date]').addEventListener('click', () => finish());
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (dateDialog === dialog) dateDialog = null;
      if (button.isConnected) {
        refreshDay();
        container.querySelector(`[data-stat-date="${key}"]`)?.focus({ preventScroll: true });
      }
    });
    container.append(dialog);
    dialog.showModal();
  }
  function refreshDay() {
    const today = todayDate();
    if (today === renderedDay) return;
    if (dateDialog?.open) dateDialog.querySelector('input[type="date"]').max = today;
    else render();
  }
  const visibility = () => { if (doc.visibilityState === 'visible') refreshDay(); };
  const change = event => {
    const target = event.target;
    if (target.matches('[data-stat-option]')) {
      const key = target.dataset.statOption, radio = target.type === 'radio';
      options[key] = radio ? target.value === 'marketing' : target.checked;
      const scroll = container.querySelector('.statistics-chart-scroll');
      if (scroll) scrollPositions[options.period] = scroll.scrollLeft;
      render();
      container.querySelector(`[data-stat-option="${key}"]${radio ? ':checked' : ''}`).focus({ preventScroll: true });
      return;
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
      options.dateTo = '';
      scrollPositions.year = scrollPositions.month = null;
      render();
      container.querySelector('[data-stat-reset]').focus({ preventScroll: true });
    }
  };
  container.addEventListener('change', change);
  container.addEventListener('click', click);
  container.addEventListener('scroll', scrolled, true);
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('focus', refreshDay);
  render();
  return () => {
    dateDialog?.remove();
    chartCleanup();
    container.removeEventListener('change', change);
    container.removeEventListener('click', click);
    container.removeEventListener('scroll', scrolled, true);
    doc.removeEventListener('visibilitychange', visibility);
    win.removeEventListener('focus', refreshDay);
  };
}
