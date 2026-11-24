import { applyStatisticsDate, bindTestDialogs } from './helpers/stat-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { journeyDate } from '../src/journey-date.js';
import { statisticsOptions, statisticsRange, todayDate, journeyStatistics, tripSeries } from '../src/statistics-model.js';
import { mountStatistics } from '../src/statistics.js';

const rail = extra => createRecord({ origin: '北京南', destination: '上海虹桥', departureDate: '2024-02-29', ...extra });
const flight = extra => createRecord({ type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'HND', departureDate: '2024-03-01', aircraft: 'Boeing 737-800', ...extra });
const range = { dateFrom: '', dateTo: '2026-11-16' };

test('statistics default to an unbounded start and today, compare dates only and respect edited bounds', () => {
  assert.deepEqual(statisticsOptions({}, '2026-11-16'), { ...range, period: 'year', year: '', chartZoom:1, mergeDirections:true, railUnits:false, railPowerSupplies:false, aircraftGrouping:'model' });
  const rows = [rail({ id: 'past' }), flight({ id: 'today', departureDate: '2026-11-16', departureTime: '23:59' }), rail({ id: 'future', departureDate: '2026-11-17' }), rail({ id: 'deleted', deleted: true }), rail({ id: 'undated', departureDate: '' })];
  const result = statisticsRange(rows, range);
  assert.deepEqual(result.records.map(row => row.id), ['past', 'today']); assert.equal(result.omittedDates, 1);
  assert.equal(statisticsRange(rows, { dateFrom: '2026-11-16', dateTo: '2026-11-17' }).records.length, 2);
  assert.equal(statisticsRange(rows, { dateFrom: '', dateTo: '' }).records.length, 3);
  const today = todayDate();
  const tomorrow = new Date(today + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const future = tomorrow.toISOString().slice(0, 10);
  const nowRows = [rail({ id: 'today-limit', departureDate: today }), rail({ id: 'future-limit', departureDate: future })];
  assert.equal(statisticsOptions({ dateTo: future }).dateTo, today);
  assert.equal(statisticsOptions({ dateTo: '' }).dateTo, today);
  assert.deepEqual(statisticsRange(nowRows, { dateTo: future }).records.map(row => row.id), ['today-limit']);
  assert.match(statisticsRange(rows, { dateFrom: '2025-01-01', dateTo: '2024-12-31' }).error, /起始日期/);
  assert.ok(statisticsRange(rows, { dateTo: '2025-02-30' }).error);
});

test('imprecise dates count only when their whole known interval fits, without invented months', () => {
  const rows = [rail({ departureDate: '2023' }), flight({ departureDate: '2024-02-01' }), rail({ departureDate: '2026' })];
  const result = statisticsRange(rows, range);
  assert.equal(result.records.length, 2); assert.equal(result.omittedDates, 1);
  assert.equal(statisticsRange(rows, { dateFrom: '2023-02-01', dateTo: '2023-12-31' }).records.length, 0);
  const annual = tripSeries(result.records);
  assert.deepEqual(annual.map(row => [row.key, row.rail, row.flight]), [['2023', 1, 0], ['2024', 0, 1]]);
  const monthly = tripSeries(result.records, { period: 'month' });
  assert.equal(monthly.filter(row => row.key.startsWith('2023')).reduce((sum, row) => sum + row.rail + row.flight, 0), 0);
  assert.equal(monthly.find(row => row.key === '2024-02').flight, 1);
});

test('statistics keep airport and station identities, combine return air routes and count stored records without a second trip merge', () => {
  const rows = [rail({ id: 'a' }), rail({ id: 'b', origin: 'VNP', destination: 'AOH', passenger: '另一位旅客' }), flight({ id: 'outbound' }), flight({ id: 'inbound', origin: 'HND', destination: 'PEK', aircraft: 'B737-800' }), flight({ id: 'daxing', origin: 'PKX', aircraft: 'Airbus A320' }), flight({ id: 'conflict', origin: 'PEK', originCode: 'SHA', aircraft: '' }), rail({ deleted: true })];
  const before = JSON.stringify(rows), data = journeyStatistics(rows, range);
  assert.equal(data.rail, 2); assert.equal(data.flight, 4);
  assert.equal(data.stations.length, 2); assert.equal(data.airports.length, 3);
  assert.equal(data.routes.length, 2); assert.equal(data.routes.find(route => route.id === 'HND-PEK').count, 2);
  assert.deepEqual(data.aircraft, [{ name: '737-800', count: 2 }, { name: 'A320（子型号未确认）', count: 1 }]);
  assert.equal(data.unknownAircraft, 1); assert.equal(data.unknownRoutes, 1); assert.equal(data.unknownPlaces, 1);
  assert.deepEqual(data.countries.map(row => row.code).sort(), ['CN', 'JP']);
  assert.equal(JSON.stringify(rows), before);
});

test('geography uses each airport continent and correctly assigns Chinese regions and Lao railway stations', () => {
  const rows = [flight({ origin: 'HKG', destination: 'TPE' }), flight({ origin: 'MFM', destination: 'SFO' }), flight({ origin: 'LHR', destination: 'SYD' }), rail({ origin: '万象', destination: '昆明南' }), flight({ origin: 'VVO', destination: 'SVO' })];
  const data = journeyStatistics(rows, range);
  assert.deepEqual(data.countries.map(row => row.code).sort(), ['AU', 'CN', 'GB', 'LA', 'RU', 'US']);
  assert.deepEqual(data.continents.map(row => row.code).sort(), ['AS', 'EU', 'NA', 'OC']);
  const russia = journeyStatistics([rows.at(-1)], range);
  assert.deepEqual(russia.continents.map(row => row.code).sort(), ['AS', 'EU']);
  assert.equal(data.stations.find(row => row.name === '万象').country, 'LA');
});

test('year and month series fill zero periods without allocating year-only records to January', () => {
  const rows = [rail({ departureDate: '2022' }), flight({ departureDate: '2024-02-01' }), flight({ departureDate: '2024-02-29' })];
  assert.deepEqual(tripSeries(rows).map(row => [row.key, row.rail, row.flight]), [['2022', 1, 0], ['2023', 0, 0], ['2024', 0, 2]]);
  const monthly = tripSeries(rows, { period: 'month' });
  assert.equal(monthly.length, 36); assert.equal(monthly[0].key, '2022-01'); assert.equal(monthly.at(-1).key, '2024-12');
  assert.equal(monthly.find(row => row.key === '2024-01').flight, 0); assert.equal(monthly.find(row => row.key === '2024-02').flight, 2);
  assert.equal(monthly.find(row => row.key === '2024-02').label, '2024年2月');
  assert.equal(monthly.reduce((sum, row) => sum + row.rail + row.flight, 0), 2);
  assert.deepEqual(tripSeries([]), []);
  assert.deepEqual(tripSeries([], { period: 'month' }), []);
});

test('statistics controls refresh every dimension, offer monthly data and show errors without stale figures', () => {
  const dom = new JSDOM('<div id="root"></div>'), root = dom.window.document.querySelector('#root');
  const options = { ...range }, rows = [rail({ departureDate: '2022-01-01' }), flight({ departureDate: '2024-03-01' })];
  bindTestDialogs(dom.window);
  const cleanup = mountStatistics(root, rows, { options });
  const change = (selector, value) => { const control = root.querySelector(selector); control.value = value; control.dispatchEvent(new dom.window.Event('change', { bubbles: true })); };
  try {
    assert.equal(root.querySelector('[data-stat-from]').textContent, '不限');
    assert.equal(root.querySelector('[data-stat-to]').textContent, range.dateTo);
    root.querySelector('[data-stat-scale="month"]').click();
    assert.equal(root.querySelector('[data-stat-year]').value, '2024');
    change('[data-stat-year]', '2023');
    assert.equal(root.querySelector('.statistics-chart-table'), null);
    assert.equal(root.querySelectorAll('[data-stat-period]').length, 72);
    assert.doesNotMatch(root.textContent, /查看图表数据/);
    assert.ok(root.querySelector('.statistics-chart-scroll').scrollLeft > 0);
    const chart = root.querySelector('.statistics-chart');
    change('[data-stat-year]', '2022');
    assert.equal(root.querySelector('.statistics-chart'), chart);
    assert.equal(root.querySelector('.statistics-chart-scroll').scrollLeft, 0);
    assert.ok(parseInt(chart.style.minWidth) > 720);
    const dot = root.querySelector('[data-stat-period="2023-01"]'); dot.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
    assert.match(root.querySelector('output').textContent, /火车 0 次/);
    applyStatisticsDate(root, '[data-stat-from]', '2024-01-01');
    assert.match(root.querySelector('.statistics-summary').textContent, /火车0次飞机1次/);
    applyStatisticsDate(root, '[data-stat-to]', '2023-12-31');
    assert.equal(root.querySelector('.statistics-summary'), null);
    assert.match(root.querySelector('[role="alert"]').textContent, /起始日期/);
    root.querySelector('[data-stat-reset]').click();
    assert.equal(root.querySelector('[data-stat-from]').textContent, '不限'); assert.ok(root.querySelector('.statistics-summary'));
  } finally { cleanup(); dom.window.close(); }
});

test('station lists expose names without internal codes or countries and remove explanatory fine print', () => {
  const dom = new JSDOM('<div id="root"></div>'), root = dom.window.document.querySelector('#root');
  const rows = [rail({ origin: 'VNP', destination: 'AOH' }), flight({}), flight({ origin: 'HKG', destination: 'TPE', aircraft: '' }), rail({ departureDate: '' })];
  const before = JSON.stringify(rows), cleanup = mountStatistics(root, rows, { options: { ...range } });
  try {
    const stations = root.querySelector('.statistics-station-list'), airports = root.querySelector('.statistics-airport-list');
    assert.deepEqual([...stations.querySelectorAll('li')].map(item => item.textContent), ['北京南', '上海虹桥']);
    assert.equal(stations.querySelector('code,small'), null);
    assert.doesNotMatch(stations.textContent, /VNP|AOH|中国/);
    assert.equal(stations.tabIndex, 0); assert.equal(airports.tabIndex, 0);
    assert.match(airports.textContent, /PEK|HND/);
    assert.doesNotMatch(root.textContent, /根据行程|推断经停|港澳台|以票据中填写|按出发日期统计|暂不计入/);
    assert.equal(root.querySelector('.statistics-note'), null);
    assert.equal(JSON.stringify(rows), before);
    assert.equal(journeyStatistics(rows, range).stations[0].code, 'VNP');
  } finally { cleanup(); dom.window.close(); }
});

test('route direction mode separates reverse flights without changing any other travel totals and survives UI navigation options',()=>{
  const rows=[flight({id:'outbound'}),flight({id:'return',origin:'HND',destination:'PEK'}),flight({id:'again'})];
  const merged=journeyStatistics(rows,range),directed=journeyStatistics(rows,{...range,mergeDirections:false});
  assert.equal(merged.routes.length,1);assert.equal(merged.routes[0].count,3);
  assert.deepEqual(directed.routes.map(route=>[route.id,route.count]),[['PEK-HND',2],['HND-PEK',1]]);
  for(const key of ['rail','flight','airports','countries','continents','aircraft'])assert.deepEqual(directed[key],merged[key]);
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root'),options={...range},cleanup=mountStatistics(root,rows,{options});
  const toggle=root.querySelector('[data-stat-merge-routes]');assert.equal(toggle.checked,true);toggle.checked=false;toggle.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(options.mergeDirections,false);assert.equal(root.querySelectorAll('.statistics-routes tbody tr').length,2);assert.ok([...root.querySelectorAll('.statistics-route-arrow')].every(node=>node.textContent==='→'));
  cleanup();const again=mountStatistics(root,rows,{options});assert.equal(root.querySelector('[data-stat-merge-routes]').checked,false);
  again();dom.window.close();
});

test('rail model rankings use saved trainsets, respect manual models and count each coupled model once per journey', () => {
  const date = journeyDate('2024-02-29');
  const snapshot = () => ({
    query: { trainNum:'G103', startDate:date, boardingDate:date, origin:'北京南', destination:'上海虹桥' },
    queriedAt:'2026-11-17T00:00:00Z',
    stops: [{ station:'北京南', departureDate:date, departureTime:'08:00' }, { station:'上海虹桥', arrivalDate:date, arrivalTime:'13:00' }],
    trainsets: [{ id:'CR400AF-2001', model:'cr400af' }, { id:'CR400AF-2002', model:'CR400AF' }], coupling:true,
    coaches: { model:'CRH2A', queriedAt:'2026-11-17T00:00:00Z' }
  });
  const rows = [
    rail({ railModel:'25t' }), rail({ railModel:'25T' }),
    rail({ railModel:'CR400AF / CR400BF / cr400af' }),
    rail({ service:'G103', railJourney:snapshot() }),
    rail({ service:'G103', railModel:'CRH380A', railJourney:snapshot() }),
    rail({ service:'G104', railJourney:snapshot() }),
    rail({ service:'G103', railJourney:{ ...snapshot(), trainsets:[] } }),
    rail({ railModel:'25G', departureDate:'2200-01-01' }),
    rail({ railModel:'25G', template:'rail-refund-receipt' })
  ];
  const before = JSON.stringify(rows), data = journeyStatistics(rows, range);
  assert.deepEqual(Object.fromEntries(data.railModels.map(row => [row.name,row.count])), { '25T':2, CR400AF:2, CR400BF:1, CRH380A:1 });
  const dom = new JSDOM('<div id="root"></div>'), root = dom.window.document.querySelector('#root');
  const cleanup = mountStatistics(root, rows, { options:{ ...range } });
  assert.match(root.querySelector('[data-stat-ranking="rail-models"]').textContent, /乘坐车型.*4 种.*25T.*2 次/s);
  assert.equal(JSON.stringify(rows), before);
  cleanup(); dom.window.close();
});

test('rail ownership and aircraft subtype toggles change only their own rankings and remain selected across remounts',()=>{
  const rows=[rail({id:'r1',railBureau:'上局',railCarOwner:'上海动车段'}),rail({id:'r2',railBureau:'上海局',railCarOwner:'南京动车段'}),rail({id:'r3',railBureau:'上海局'}),flight({id:'b1',aircraft:'737-800'}),flight({id:'b2',aircraft:'737-200'}),flight({id:'b3',aircraft:'737 MAX 8'}),flight({id:'d1',aircraft:'DHC-8-400'}),flight({id:'d2',aircraft:'DHC-8-402'})];
  const before=JSON.stringify(rows),normal=journeyStatistics(rows,range),grouped=journeyStatistics(rows,{...range,railUnits:true,aircraftGrouping:'series'});
  assert.deepEqual(normal.railBureaus,[{name:'上海局',count:3}]);
  assert.deepEqual(grouped.railBureaus.map(row=>row.name).sort(),['上海局 · 上海动车段','上海局 · 南京动车段','上海局 · 单位未收录'].sort());
  assert.deepEqual(grouped.aircraft,[{name:'737',count:3},{name:'DHC-8',count:2}]);
  for(const key of ['rail','flight','airports','stations','countries','continents','routes'])assert.deepEqual(grouped[key],normal[key]);
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root'),options={...range};let cleanup=mountStatistics(root,rows,{options});
  const change=(key,attributes)=>{const input=root.querySelector(`[data-stat-option="${key}"]`);Object.assign(input,attributes);input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  assert.equal(root.querySelector('[data-stat-option="railUnits"]').checked,false);assert.equal(root.querySelector('[data-stat-option="aircraftGrouping"]').value,'model');
  change('railUnits',{checked:true});assert.match(root.querySelector('[data-stat-ranking="rail-bureaus"]').textContent,/南京动车段/);
  change('aircraftGrouping',{value:'series'});assert.doesNotMatch(root.querySelector('[data-stat-ranking="aircraft"]').textContent,/737-800|737-200|MAX/);
  cleanup();cleanup=mountStatistics(root,rows,{options});assert.equal(root.querySelector('[data-stat-option="railUnits"]').checked,true);assert.equal(root.querySelector('[data-stat-option="aircraftGrouping"]').value,'series');
  assert.equal(JSON.stringify(rows),before);cleanup();dom.window.close();
});

test('rail power supply grouping separates conventional coaches, preserves EMUs and survives switching pages',()=>{
  const rows=[rail({railModel:'25GDC600V'}),rail({railModel:'25GAC380V'}),rail({railModel:'25G',railPowerSupply:'DC600V'}),rail({railModel:'25G'}),rail({railModel:'CR400AF / CR400AF'}),rail({railModel:'25T',railPowerSupply:'DC600V',departureDate:'2200-01-01'}),rail({railModel:'25T',template:'rail-refund-receipt'})];
  const before=JSON.stringify(rows),normal=journeyStatistics(rows,range),split=journeyStatistics(rows,{...range,railPowerSupplies:true});
  assert.deepEqual(normal.railModels,[{name:'25G',count:4},{name:'CR400AF',count:1}]);
  assert.deepEqual(Object.fromEntries(split.railModels.map(row=>[row.name,row.count])),{'25G · DC600V':2,'25G · AC380V':1,'25G · 供电制式未知':1,CR400AF:1});
  for(const key of ['rail','flight','railMileage','railMileageTrips','aircraft','railBureaus','airports','stations','routes'])assert.deepEqual(split[key],normal[key]);
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root'),options={...range};let cleanup=mountStatistics(root,rows,{options});
  const change=checked=>{const toggle=root.querySelector('[data-stat-option="railPowerSupplies"]');toggle.checked=checked;toggle.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  try{
    assert.equal(root.querySelector('[data-stat-option="railPowerSupplies"]').checked,false);change(true);
    assert.match(root.querySelector('[data-stat-ranking="rail-models"]').textContent,/DC600V/);
    cleanup();cleanup=mountStatistics(root,rows,{options});assert.equal(root.querySelector('[data-stat-option="railPowerSupplies"]').checked,true);
    change(false);assert.doesNotMatch(root.querySelector('[data-stat-ranking="rail-models"]').textContent,/DC600V|AC380V|供电制式未知/);assert.equal(JSON.stringify(rows),before);
  }finally{cleanup();dom.window.close();}
});

test('each ranking switches charts independently and keeps its grouping and date filters', () => {
  const rows = [
    rail({ railModel: '25GDC600V', railBureau: '上海局', railCarOwner: '上海动车段' }),
    rail({ railModel: '25GAC380V', railBureau: '上海局', railCarOwner: '南京动车段' }),
    ...['737-800', '737-200', 'A320', 'A321', 'A380', '787-9', 'DHC-8-400', '未知型号'].map(aircraft => flight({ aircraft }))
  ];
  const dom = new JSDOM('<div id="root"></div>'), root = dom.window.document.querySelector('#root');
  const options = { ...range };
  let cleanup = mountStatistics(root, rows, { options });
  const card = kind => root.querySelector(`[data-stat-ranking="${kind}"]`);
  const picked = kind => card(kind).querySelector('[data-stat-view][aria-pressed=true]').dataset.statView;
  const change = (selector, update) => {
    const control = root.querySelector(selector);
    Object.assign(control, update);
    control.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  try {
    const trend = root.querySelector('.statistics-trend');
    for (const kind of ['rail-models', 'rail-bureaus', 'aircraft']) assert.equal(picked(kind), 'donut');
    card('rail-models').querySelector('[data-stat-view=columns]').click();
    card('rail-bureaus').querySelector('[data-stat-view=bars]').click();
    assert.equal(picked('rail-bureaus'), 'bars');
    assert.ok(card('rail-models').querySelector('.statistics-column-scroll'));
    assert.equal(root.querySelector('.statistics-trend'), trend);
    const tail = card('aircraft').querySelector('.statistics-ring-other');
    assert.match(card('aircraft').textContent, /未识别机型 · 1 次/);
    assert.match(tail.querySelector('summary').textContent, /其他（2 项）2 次28\.6%/);
    assert.equal(tail.querySelectorAll('li').length, 2);
    assert.equal(card('aircraft').querySelector('.statistics-ring strong').textContent, '7');
    change('[data-stat-option=railPowerSupplies]', { checked: true });
    assert.equal(picked('rail-models'), 'columns');
    assert.match(card('rail-models').textContent, /DC600V/);
    change('[data-stat-option=aircraftGrouping]', { value: 'series' });
    assert.equal(picked('aircraft'), 'donut');
    assert.equal(card('aircraft').querySelector('.statistics-ring strong').textContent, '7');
    assert.doesNotMatch(card('aircraft').textContent, /737-800/);
    bindTestDialogs(dom.window);
    applyStatisticsDate(root, '[data-stat-to]', '2024-02-29');
    assert.equal(picked('aircraft'), 'donut');
    assert.match(card('aircraft').textContent, /暂无记录/);
    cleanup();
    cleanup = mountStatistics(root, rows, { options });
    assert.equal(picked('rail-models'), 'columns');
    assert.equal(picked('aircraft'), 'donut');
    assert.equal(picked('rail-bureaus'), 'bars');
  } finally {
    cleanup();
    dom.window.close();
  }
});

test('the automatic end date rolls over on return and a chosen date stays fixed', () => {
  const NativeDate = globalThis.Date;
  let clock = new NativeDate(2026, 10, 19, 23, 58);
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clock.getTime()])); }
  };
  const dom = new JSDOM('<div id="statistics"></div>'), root = dom.window.document.querySelector('#statistics');
  bindTestDialogs(dom.window);
  const rows = [rail({ departureDate: '2026-11-19' }), rail({ departureDate: '2026-11-20' })], options = {};
  const end = () => root.querySelector('[data-stat-to]').textContent;
  const count = () => root.querySelector('.statistics-summary strong').textContent;
  let cleanup = () => {};
  try {
    cleanup = mountStatistics(root, rows, { options });
    assert.equal(end(), '2026-11-19');
    assert.equal(count(), '1次');
    cleanup();
    clock = new NativeDate(2026, 10, 20, 0, 1);
    cleanup = mountStatistics(root, rows, { options });
    assert.equal(end(), '2026-11-20');
    assert.equal(count(), '2次');
    applyStatisticsDate(root, '[data-stat-to]', '2026-11-19');
    clock = new NativeDate(2026, 10, 21, 0, 1);
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    assert.equal(end(), '2026-11-19');
    assert.equal(count(), '1次');
    root.querySelector('[data-stat-reset]').click();
    assert.equal(end(), '2026-11-21');
    clock = new NativeDate(2026, 10, 22, 0, 1);
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    assert.equal(end(), '2026-11-22');
  } finally {
    cleanup();
    dom.window.close();
    globalThis.Date = NativeDate;
  }
});
