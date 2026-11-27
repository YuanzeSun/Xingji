import { applyStatisticsDate, bindTestDialogs } from './helpers/stat-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { journeyDate } from '../src/journey-date.js';
import { statisticsOptions, todayDate, journeyStatistics, tripSeries } from '../src/statistics-model.js';
import { mountStatistics } from '../src/statistics.js';
import { smoothArrivalDelays } from '../src/arrival-delay-chart.js';
import { flightTrackRequest } from '../src/flight-track.js';
import { createBoardingCode } from '../src/bcbp.js';
import { flightTimeComparison } from '../src/flight-time-comparison.js';

const rail = extra => createRecord({ origin: '北京南', destination: '上海虹桥', departureDate: '2024-02-29', ...extra });
const flight = extra => createRecord({ type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'HND', departureDate: '2024-03-01', aircraft: 'Boeing 737-800', ...extra });
const range = { dateFrom: '', dateTo: '2026-11-16' };

test('repeat visits group physical vehicle IDs and expose only the included trips', () => {
  const rows = [
    rail({ id: 'first-train', service: 'G1', railTrainsets: 'CR400BF-B-5099 / CR400BF-B-5099 / CR400BF-5100' }),
    rail({ id: 'second-train', service: 'G21', departureDate: '2024-03-06', railTrainsets: 'ｃｒ４００ｂｆ－ｂ－５０９９' }),
    rail({ id: 'refund', template: 'rail-refund-receipt', railTrainsets: 'CR400BF-5100' }),
    rail({ id: 'missing-train', service: 'G1' }),
    flight({ id: 'first-flight', service: 'CA181', aircraftRegistration: 'b1813' }),
    flight({ id: 'second-flight', service: 'CA182', departureDate: '2024-03-05', aircraftRegistration: 'Ｂ－１８１３' }),
    flight({ id: 'once', aircraftRegistration: 'B-1814' }),
    flight({ id: 'invalid', aircraftRegistration: 'B-1814', flightStatus: 'invalid' }),
    flight({ id: 'deleted-flight', aircraftRegistration: 'B-1814', deleted: true })
  ];
  const data = journeyStatistics(rows, range);
  const grouped = groups => groups.map(({ name, count, trips }) => [name, count, trips.map(trip => trip.id)]);
  assert.deepEqual(grouped(data.repeatedTrainsets), [['CR400BF-B-5099', 2, ['second-train', 'first-train']]]);
  assert.deepEqual(grouped(data.repeatedAircraft), [['B-1813', 2, ['second-flight', 'first-flight']]]);

  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector('#root');
  const unmount = mountStatistics(root, rows, { options: { ...range } });
  try {
    const railPanel = root.querySelector('[data-stat-repeated="rail"]');
    const flightPanel = root.querySelector('[data-stat-repeated="flight"]');
    assert.match(railPanel.querySelector('summary').textContent, /CR400BF-B-5099.*2 次/);
    assert.match(flightPanel.querySelector('summary').textContent, /B-1813.*2 次/);
    flightPanel.querySelector('summary').click();
    assert.equal(flightPanel.querySelector('details').open, true);
    assert.deepEqual([...flightPanel.querySelectorAll('[data-action="view"]')].map(link => link.dataset.id), ['second-flight', 'first-flight']);
    assert.match(flightPanel.querySelector('[data-action="view"]').textContent, /2024\.03\.05.*CA182.*→/s);
    bindTestDialogs(dom.window);
    applyStatisticsDate(root, '[data-stat-from]', '2024-03-02');
    assert.equal(root.querySelector('[data-stat-repeated="rail"] details'), null);
    assert.equal(root.querySelector('[data-stat-repeated="flight"] details'), null);
  } finally {
    unmount();
    dom.window.close();
  }
});

test('rail mileage and flown distance share the date filter and show independent coverage', () => {
  const base = flight({ id: 'tracked', service: 'CA123', flightDistance: '750' });
  const tracked = createRecord({ ...base, flightTrack: {
    flightStr: flightTrackRequest(base), queriedAt: '2024-03-02T00:00:00Z',
    segments: [[[179, 0], [-179, 0]], [[30, 0], [31, 0]]]
  } });
  const rows = [
    rail({ railMileage: '1318' }), tracked, flight({ id: 'untracked', flightDistance: '9999' }),
    createRecord({ ...tracked, id: 'void', flightStatus: 'invalid' }),
    createRecord({ ...tracked, id: 'deleted', deleted: true })
  ];
  const all = journeyStatistics(rows, range);
  assert.equal(all.railMileage, 1318);
  assert.equal(all.railMileageTrips, 1);
  assert.equal(all.flight, 2);
  assert.equal(all.actualFlightDistanceTrips, 1);
  // These are two disconnected segments at the equator, spanning two degrees and one degree.
  assert.ok(Math.abs(all.actualFlightDistance - 333.585) < 0.001);
  const beforeFlight = journeyStatistics(rows, { ...range, dateTo: '2024-02-29' });
  assert.equal(beforeFlight.actualFlightDistance, 0);
  assert.equal(beforeFlight.actualFlightDistanceTrips, 0);
  assert.equal(beforeFlight.railMileage, 1318);

  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector('#root');
  const unmount = mountStatistics(root, rows, { options: { ...range } });
  const [railCard, flightCard] = root.querySelectorAll('.statistics-journey-metrics > section');
  assert.match(railCard.textContent, /铁路里程.*1,318 km.*1 \/ 1/);
  assert.match(flightCard.textContent, /实际飞行航程.*333\.6 km.*1 \/ 2/);
  unmount();
  dom.window.close();
});

test('rail and flight travel times are totaled independently across dates, time zones and clock changes', () => {
  const overnight = rail({ departureTime: '23:30', arrivalDate: '2024-03-01', arrivalTime: '01:10' });
  const actual = flight({ origin: 'JFK', destination: 'LHR', departureTime: '20:00', arrivalDate: '2024-03-02', arrivalTime: '09:00',
    actualDepartureDate: '2024-03-01', actualDepartureTime: '19:00', actualArrivalDate: '2024-03-02', actualArrivalTime: '07:15' });
  const planned = flight({ origin: 'HND', destination: 'PEK', departureDate: '2024-04-15', departureTime: '10:00', arrivalDate: '2024-04-15', arrivalTime: '13:00',
    actualDepartureDate: '2024-04-15', actualDepartureTime: '11:00' });
  const dateLine = flight({ origin: 'NRT', destination: 'LAX', departureDate: '2024-06-08', departureTime: '17:00', arrivalDate: '2024-06-08', arrivalTime: '10:00' });
  const clockChange = flight({ origin: 'JFK', destination: 'BOS', departureDate: '2024-03-10', departureTime: '01:30', arrivalDate: '2024-03-10', arrivalTime: '03:30' });
  const rows = [overnight, actual, planned, dateLine, clockChange,
    createRecord({ ...clockChange, departureTime: '02:30' }),
    createRecord({ ...clockChange, departureDate: '2024-11-03', arrivalDate: '2024-11-03' }),
    createRecord({ ...overnight, arrivalDate: '', arrivalTime: '01:10' }),
    createRecord({ ...overnight, arrivalDate: '2024-02-29' }),
    createRecord({ ...overnight, template: 'rail-refund-receipt' }),
    createRecord({ ...actual, flightStatus: 'invalid' }),
    createRecord({ ...planned, deleted: true })];
  const all = journeyStatistics(rows, range);
  assert.deepEqual(all.travelTime, { rail: { minutes: 100, trips: 1 }, flight: { minutes: 1275, trips: 4 } });
  assert.equal(all.records.length, 9);
  const before = journeyStatistics(rows, { ...range, dateTo: '2024-03-01' });
  assert.deepEqual(before.travelTime, { rail: { minutes: 100, trips: 1 }, flight: { minutes: 435, trips: 1 } });

  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector('#root');
  const unmount = mountStatistics(root, rows, { options: { ...range } });
  const cards = () => [...root.querySelectorAll('.statistics-journey-metrics > section')];
  assert.deepEqual(cards().map(card => card.querySelector('h2').textContent), ['火车', '飞机']);
  assert.deepEqual(cards().map(card => [...card.querySelectorAll('dt')].map(label => label.textContent)), [
    ['乘坐次数', '火车站数', '铁路里程', '总在途时间', '总金额'], ['航班数', '机场数', '实际飞行航程', '总在途时间', '总金额']
  ]);
  const duration = index => [...cards()[index].querySelectorAll('dt')].find(label => label.textContent === '总在途时间').parentElement.textContent;
  assert.match(duration(0), /总在途时间.*1 小时 40 分.*1 \/ 3 程可计算/);
  assert.match(duration(1), /总在途时间.*21 小时 15 分.*4 \/ 6 程可计算/);
  bindTestDialogs(dom.window);
  applyStatisticsDate(root, '[data-stat-to]', '2024-02-29');
  assert.match(duration(0), /1 小时 40 分.*1 \/ 3 程可计算/);
  assert.match(duration(1), /—.*0 \/ 0 程可计算/);
  unmount();
  dom.window.close();
});

test('ticket fare totals follow the journey date range and distinguish zero prices from missing prices', () => {
  const rows = [
    rail({ price: '0.1' }), rail({ price: '0.20', template: 'rail-supplement', railSupplementFee: '0.10' }),
    rail({}), rail({ price: '20', template: 'rail-refund-receipt' }),
    flight({ price: '0' }), flight({ price: '1024.57', departureDate: '2024-03-02' }),
    flight({ price: '300', flightStatus: 'invalid' }), flight({ price: '400', departureDate: '2024-03-03' })
  ];
  const options = { dateTo: '2024-03-02' };
  assert.deepEqual(journeyStatistics(rows, options).fares, { rail: { cents: 30, trips: 2 }, flight: { cents: 102457, trips: 2 } });

  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector('#root');
  bindTestDialogs(dom.window);
  const unmount = mountStatistics(root, rows, { options: { ...options } });
  const amounts = () => [...root.querySelectorAll('.statistics-journey-card')].map(card =>
    [...card.querySelectorAll('dt')].find(label => label.textContent === '总金额').nextElementSibling.textContent);
  try {
    assert.deepEqual(amounts(), ['0.30 元2 / 3 程已录入票价', '1,024.57 元2 / 2 程已录入票价']);
    applyStatisticsDate(root, '[data-stat-to]', '2024-03-01');
    assert.deepEqual(amounts(), ['0.30 元2 / 3 程已录入票价', '0.00 元1 / 1 程已录入票价']);
    applyStatisticsDate(root, '[data-stat-to]', '2024-02-29');
    assert.deepEqual(amounts(), ['0.30 元2 / 3 程已录入票价', '—0 / 0 程已录入票价']);
  } finally {
    unmount();
    dom.window.close();
  }
});

test('railway footprints count each named line once per ridden section within the date range', () => {
  const [beijing, tianjin, shanghai] = [[116.38, 39.86], [117.06, 39.05], [121.33, 31.19]];
  const stops = [
    { name: '北京南', coordinates: beijing }, { name: '天津南', coordinates: tianjin }, { name: '上海虹桥', coordinates: shanghai }
  ];
  const route = {
    service: 'G1', origin: '北京南', destination: '天津南', queriedAt: '2024-03-01T00:00:00Z',
    segments: [[beijing, tianjin]], stops: stops.slice(0, 2),
    lineLabels: [{ name: '京沪高速线', coordinates: beijing }, { name: '京沪高速线', coordinates: tianjin }],
    fullRoute: { segments: [[beijing, tianjin], [tianjin, shanghai]], stops,
      lineLabels: [{ name: '区间以外的线路', coordinates: shanghai }] }
  };
  const first = rail({ id: 'section', service: 'G1', destination: '天津南', railRoute: route });
  const next = rail({ id: 'later', service: 'G1', destination: '天津南', departureDate: '2024-03-03', railRoute: route });
  const rows = [first, next, rail({}), { ...first, id: 'stale', service: 'G2' },
    rail({ deleted: true }), rail({ template: 'rail-refund-receipt' })];
  const all = journeyStatistics(rows, range);
  assert.deepEqual(all.railLines, [{ name: '京沪高速线', count: 2 }]);
  assert.equal(all.railLineTrips, 2);
  assert.equal(all.rail, 4);
  const filtered = journeyStatistics(rows, { ...range, dateTo: '2024-03-01' });
  assert.deepEqual(filtered.railLines, [{ name: '京沪高速线', count: 1 }]);

  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector('#root');
  const unmount = mountStatistics(root, rows, { options: { ...range } });
  try {
    const rankings = [...root.querySelectorAll('[data-stat-ranking]')];
    assert.deepEqual(rankings.map(panel => panel.dataset.statRanking), ['rail-models', 'rail-bureaus', 'airlines', 'aircraft', 'rail-lines']);
    const panel = rankings.at(-1);
    assert.ok(panel.nextElementSibling.querySelector('[data-stat-repeated="rail"]'));
    assert.equal(panel.querySelector('[aria-pressed="true"]').dataset.statView, 'donut');
    assert.match(panel.querySelector('.statistics-ring-legend').textContent, /京沪高速线.*2 次/);
    panel.querySelector('[data-stat-view="bars"]').click();
    assert.match(panel.querySelector('.statistics-aircraft').textContent, /京沪高速线.*2 次/);
    panel.querySelector('[data-stat-view="columns"]').click();
    assert.match(panel.querySelector('.statistics-columns-plot').textContent, /2 次.*京沪高速线/);
    panel.querySelector('[data-stat-view="donut"]').click();
    assert.ok(panel.querySelector('.statistics-ring'));
    assert.equal(rankings[2].querySelector('[aria-pressed="true"]').dataset.statView, 'donut');
  } finally {
    unmount();
    dom.window.close();
  }
});

test('a flight time comparison shares one axis across an overnight trip and two airport time zones', () => {
  const record = flight({
    departureDate: '2026-11-26', departureTime: '23:45', arrivalDate: '2026-11-27', arrivalTime: '04:10',
    actualDepartureDate: '2026-11-27', actualDepartureTime: '00:20', actualArrivalDate: '2026-11-27', actualArrivalTime: '04:22'
  });
  const dom = new JSDOM(flightTimeComparison(record));
  try {
    const document = dom.window.document;
    const plan = document.querySelector('.planned .flight-timing-axis');
    const actual = document.querySelector('.actual .flight-timing-axis');
    assert.equal(plan.style.getPropertyValue('--from'), '0.000%');
    assert.equal(actual.style.getPropertyValue('--to'), '100.000%');
    assert.ok(parseFloat(actual.style.getPropertyValue('--from')) > 16);
    assert.deepEqual([...document.querySelectorAll('dd')].map(element => element.textContent),
      ['晚 35 分钟', '晚 12 分钟', '少用 23 分钟']);
    assert.equal(document.querySelector('.actual time').dateTime, '2026-11-27T00:20');
    assert.equal(flightTimeComparison({ ...record, actualArrivalDate: '' }), '');
  } finally { dom.window.close(); }
});

test('arrival delay smoothing bridges a single empty minute and leaves long gaps empty', () => {
  const density = smoothArrivalDelays([{ minutes: 24, count: 100 }, { minutes: 26, count: 80 }]);
  assert.ok(density.get(25) >= Math.min(density.get(24), density.get(26)));
  const distant = smoothArrivalDelays([{ minutes: -120, count: 1 }, { minutes: 1440, count: 1 }]);
  assert.equal(distant.get(25), undefined, 'minutes far from every sample have no density');
});

test('the arrival delay chart preserves exact counts across midnight and clock changes', () => {
  const trip = (actualArrivalTime, extra) => flight({
    arrivalDate: '2024-03-01', arrivalTime: '12:00', actualArrivalDate: '2024-03-01', actualArrivalTime, ...extra
  });
  const rows = ['11:59', '12:00', '12:01', '12:14', '12:15', '12:29', '12:30', '12:59', '13:00'].map(time => trip(time));
  rows.push(
    trip('00:05', { arrivalTime: '23:50', actualArrivalDate: '2024-03-02' }),
    trip('03:05', { origin: 'SFO', destination: 'JFK', departureDate: '2024-03-10',
      arrivalDate: '2024-03-10', arrivalTime: '01:55', actualArrivalDate: '2024-03-10' }),
    trip('02:00', { origin: 'SFO', destination: 'JFK', departureDate: '2024-11-03',
      arrivalDate: '2024-11-03', arrivalTime: '01:30', actualArrivalDate: '2024-11-03' }),
    trip('12:45', { actualArrivalDate: '' }),
    trip('12:45', { arrivalDate: '' }),
    trip('12:45', { destination: '未识别机场' }),
    trip('15:00', { flightStatus: 'invalid' }),
    trip('15:00', { deleted: true })
  );
  const all = journeyStatistics(rows, range);
  assert.equal(all.flight, 15);
  assert.equal(all.arrivalDelayTrips, 11);
  assert.deepEqual(all.arrivalDelays.map(({ minutes, count }) => [minutes, count]),
    [[-1, 1], [0, 1], [1, 1], [10, 1], [14, 1], [15, 2], [29, 1], [30, 1], [59, 1], [60, 1]]);

  const dom = new JSDOM('<div id="root"></div>');
  const root = dom.window.document.querySelector('#root');
  bindTestDialogs(dom.window);
  const unmount = mountStatistics(root, rows, { options: { ...range } });
  try {
    const delayPanel = () => root.querySelector('[data-stat-arrival-delays]');
    assert.match(delayPanel().textContent, /11 \/ 15 班可比较/);
    const plot = delayPanel().querySelector('[data-stat-delay-plot]');
    const line = plot.querySelector('.statistics-line').getAttribute('d');
    assert.match(line, /^M.*C/);
    assert.doesNotMatch(line, /NaN|Infinity/);
    assert.match(plot.querySelector('svg').textContent, /延误分钟数/);
    assert.doesNotMatch(delayPanel().textContent, /平滑占比|%|负值|实际/);
    assert.equal(plot.querySelector('circle, output, svg title'), null);
    assert.match(root.querySelector('[data-stat-ranking="rail-lines"]').textContent, /暂无已识别的铁路线/);
    applyStatisticsDate(root, '[data-stat-from]', '2024-03-10');
    assert.match(delayPanel().textContent, /1 \/ 2 班可比较/);
    const single = delayPanel().querySelector('.statistics-line').getAttribute('d');
    assert.doesNotMatch(single, /NaN|Infinity/);
  } finally {
    unmount();
    dom.window.close();
  }
});

test('statistics default to an unbounded start and today, compare dates only and respect edited bounds', () => {
  assert.deepEqual(statisticsOptions({}, '2026-11-16'), { ...range, period: 'year', year: '', chartZoom:1, mergeDirections:true, railUnits:false, railSubtypes:true, aircraftSubtypes:true, marketingAirlines:false, includeStopoverAirports:false });
  const rows = [rail({ id: 'past' }), flight({ id: 'today', departureDate: '2026-11-16', departureTime: '23:59' }), rail({ id: 'future', departureDate: '2026-11-17' }), rail({ id: 'deleted', deleted: true }), rail({ id: 'undated', departureDate: '' })];
  const result = journeyStatistics(rows, range);
  assert.deepEqual(result.records.map(row => row.id), ['past', 'today']);
  assert.equal(journeyStatistics(rows, { dateFrom: '2026-11-16', dateTo: '2026-11-17' }).records.length, 2);
  assert.equal(journeyStatistics(rows, { dateFrom: '', dateTo: '' }).records.length, 3);
  const today = todayDate();
  const tomorrow = new Date(today + 'T00:00:00Z');
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const future = tomorrow.toISOString().slice(0, 10);
  const nowRows = [rail({ id: 'today-limit', departureDate: today }), rail({ id: 'future-limit', departureDate: future })];
  assert.equal(statisticsOptions({ dateTo: future }).dateTo, today);
  assert.equal(statisticsOptions({ dateTo: '' }).dateTo, today);
  assert.deepEqual(journeyStatistics(nowRows, { dateTo: future }).records.map(row => row.id), ['today-limit']);
  assert.match(journeyStatistics(rows, { dateFrom: '2025-01-01', dateTo: '2024-12-31' }).error, /起始日期/);
  assert.ok(journeyStatistics(rows, { dateTo: '2025-02-30' }).error);
});

test('imprecise dates count only when their whole known interval fits, without invented months', () => {
  const rows = [rail({ departureDate: '2023' }), flight({ departureDate: '2024-02-01' }), rail({ departureDate: '2026' })];
  const result = journeyStatistics(rows, range);
  assert.equal(result.records.length, 2);
  assert.equal(journeyStatistics(rows, { dateFrom: '2023-02-01', dateTo: '2023-12-31' }).records.length, 0);
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
  assert.equal(data.unknownAircraft, 1);
  assert.deepEqual(data.countries.map(row => row.code).sort(), ['CN', 'JP']);
  assert.equal(JSON.stringify(rows), before);
});

test('the airport option counts each saved stopover once in the selected date range', () => {
  const route = { fnum: 'CA181', dep: 'PEK', arr: 'HND', date: '2024-03-01' };
  const stopped = ['ICN', 'ICN', 'NRT', 'ZZZ'].map((code, index) =>
    flight({ id: 'stopover-' + index, service: 'CA181', flightStop: { ...route, airport: code } }));
  const other = flight({ id: 'other', origin: 'NRT', destination: 'PEK' });
  const later = flight({ service: 'CA181', departureDate: '2024-03-02',
    flightStop: { ...route, date: '2024-03-02', airport: 'PVG' } });
  const rows = [...stopped, other, later];
  const options = { ...range, dateTo: '2024-03-01' };
  const endpoints = journeyStatistics(rows, options);
  const withStops = journeyStatistics(rows, { ...options, includeStopoverAirports: true });
  const codes = data => data.airports.map(airport => airport.code).sort();
  assert.deepEqual(codes(endpoints), ['HND', 'NRT', 'PEK']);
  assert.deepEqual(codes(withStops), ['HND', 'ICN', 'NRT', 'PEK', 'ZZZ']);
  assert.deepEqual(withStops.routes, endpoints.routes);
  assert.deepEqual(withStops.countries, endpoints.countries);

  const dom = new JSDOM('<div id="root"></div>'), root = dom.window.document.querySelector('#root');
  const unmount = mountStatistics(root, rows, { options });
  try {
    const toggle = () => root.querySelector('[data-stat-option="includeStopoverAirports"]');
    const summary = () => root.querySelector('.statistics-journey-card:nth-child(2) dl > div:nth-child(2) strong').textContent;
    assert.equal(toggle().checked, false);
    assert.equal(summary(), '3 个');
    toggle().click();
    assert.equal(toggle().checked, true);
    assert.equal(summary(), '5 个');
    assert.deepEqual([...root.querySelectorAll('.statistics-airport-list code')].map(code => code.textContent).sort(), codes(withStops));
    toggle().click();
    assert.equal(summary(), '3 个');
  } finally {
    unmount();
    dom.window.close();
  }
});

test('the airline ranking merges recognized aliases and switches between operating and marketing carriers', () => {
  const boarding = {
    passenger: 'EXAMPLE/TRAVELER', pnr: 'AB1234', origin: 'PEK', destination: 'HND',
    date: '2024-03-01', carrier: 'CX', flightNumber: '1234', seat: '12A', cabin: 'Y', sequence: '12', status: '1'
  };
  const code = createBoardingCode(boarding);
  const rows = [
    ...['国航', 'ＣＡ', 'CCA', 'Air China', '中国国际航空股份有限公司'].map(airline => flight({ airline })),
    flight({ service: 'CA 181' }), flight({ service: 'AA81' }), flight({ airline: '美国航空' }),
    flight({ service: 'CA121', airline: 'CZ', marketingCarrier: 'CA' }),
    flight({ service: 'CA122', marketingCarrier: 'CA', boardingCode: code, boardingCodeSource: 'original', boardingLegIndex: '0' }),
    flight({ ...boarding, seatClass: boarding.cabin, service: 'CA123', airline: '国航', marketingCarrier: 'CA',
      boardingCode: code, boardingCodeSource: 'generated', boardingLegIndex: '0', boardingCodeOperatingFlight: 'CX1234' }),
    flight({ service: 'CA124', marketingCarrier: 'CA' }), flight({ service: 'YY12' }),
    flight({ airline: 'JL', departureDate: '2024-01-01' }), flight({ airline: 'JL', departureDate: '2200-01-01' }),
    flight({ airline: 'JL', flightStatus: 'open' }), flight({ airline: 'JL', deleted: true })
  ];
  const options = { ...range, dateFrom: '2024-03-01' }, before = JSON.stringify(rows);
  const result = journeyStatistics(rows, options, '2026-11-25');
  assert.equal(result.airlines[0].name, '中国国际航空');
  assert.deepEqual(Object.fromEntries(result.airlines.map(({ name, count }) => [name, count])), {
    中国国际航空: 6, 国泰航空: 2, 美國航空: 2, 中国南方航空: 1
  });
  assert.equal(result.unknownAirlines, 2);
  const purchased = journeyStatistics(rows, { ...options, marketingAirlines: true }, '2026-11-25');
  assert.deepEqual(purchased.airlines, [{ name: '中国国际航空', count: 10 }, { name: '美國航空', count: 2 }]);
  assert.equal(purchased.unknownAirlines, 1);
  assert.equal(purchased.flight, result.flight);
  assert.equal(JSON.stringify(rows), before);

  const dom = new JSDOM('<div id="root"></div>'), root = dom.window.document.querySelector('#root');
  const cleanup = mountStatistics(root, rows, { options: { ...options } });
  const panel = () => root.querySelector('[data-stat-ranking="airlines"]');
  const basis = value => panel().querySelector(`[name="airline-basis"][value="${value}"]`);
  assert.equal(panel().querySelector('header span').textContent, '4 家');
  assert.match(panel().querySelector('li').textContent, /中国国际航空6 次/);
  assert.match(panel().textContent, /未识别航司 · 2 次/);
  assert.equal(panel().querySelector('[data-stat-view][aria-pressed="true"]').dataset.statView, 'donut');
  assert.equal(panel().querySelector('.statistics-ring strong').textContent, '11');
  const group = panel().querySelector('[role="radiogroup"]');
  assert.equal(group.firstElementChild.textContent, '代码共享航班');
  assert.equal(group.getAttribute('aria-labelledby'), group.firstElementChild.id);
  assert.equal(basis('operating').closest('label').textContent, '按实际承运');
  assert.equal(basis('marketing').closest('label').textContent, '按购票航司');
  assert.equal(basis('operating').checked, true);
  assert.equal(basis('marketing').checked, false);
  basis('marketing').click();
  assert.equal(basis('operating').checked, false);
  assert.equal(basis('marketing').checked, true);
  assert.equal(dom.window.document.activeElement, basis('marketing'));
  assert.equal(panel().querySelector('.statistics-ring strong').textContent, '12');
  assert.match(panel().textContent, /未识别航司 · 1 次/);
  panel().querySelector('[data-stat-view="bars"]').click();
  basis('operating').click();
  assert.equal(basis('operating').checked, true);
  assert.equal(basis('marketing').checked, false);
  assert.equal(panel().querySelector('[data-stat-view][aria-pressed="true"]').dataset.statView, 'bars');
  assert.match(panel().textContent, /未识别航司 · 2 次/);
  cleanup(); dom.window.close();
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
    assert.deepEqual(Array.from(root.querySelectorAll('.statistics-journey-card dl > div:first-child strong'), value => value.textContent), ['0 次', '1 班']);
    applyStatisticsDate(root, '[data-stat-to]', '2023-12-31');
    assert.equal(root.querySelector('.statistics-journey-metrics'), null);
    assert.match(root.querySelector('[role="alert"]').textContent, /起始日期/);
    root.querySelector('[data-stat-reset]').click();
    assert.equal(root.querySelector('[data-stat-from]').textContent, '不限'); assert.ok(root.querySelector('.statistics-journey-metrics'));
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
  const toggle=root.querySelector('[data-stat-option="mergeDirections"]');assert.equal(toggle.checked,true);toggle.checked=false;toggle.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  assert.equal(options.mergeDirections,false);assert.equal(root.querySelectorAll('.statistics-routes tbody tr').length,2);assert.ok([...root.querySelectorAll('.statistics-route-arrow')].every(node=>node.textContent==='→'));
  cleanup();const again=mountStatistics(root,rows,{options});assert.equal(root.querySelector('[data-stat-option="mergeDirections"]').checked,false);
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
  const before=JSON.stringify(rows),normal=journeyStatistics(rows,range),grouped=journeyStatistics(rows,{...range,railUnits:true,aircraftSubtypes:false});
  assert.deepEqual(normal.railBureaus,[{name:'上海局',count:3}]);
  assert.deepEqual(grouped.railBureaus.map(row=>row.name).sort(),['上海局 · 上海动车段','上海局 · 南京动车段','上海局 · 单位未收录'].sort());
  assert.deepEqual(grouped.aircraft,[{name:'737',count:3},{name:'DHC-8',count:2}]);
  for(const key of ['rail','flight','airports','stations','countries','continents','routes'])assert.deepEqual(grouped[key],normal[key]);
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root'),options={...range};let cleanup=mountStatistics(root,rows,{options});
  const change=(key,attributes)=>{const input=root.querySelector(`[data-stat-option="${key}"]`);Object.assign(input,attributes);input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  assert.equal(root.querySelector('[data-stat-option="railUnits"]').checked,false);assert.equal(root.querySelector('[data-stat-option="aircraftSubtypes"]').checked,true);
  change('railUnits',{checked:true});assert.match(root.querySelector('[data-stat-ranking="rail-bureaus"]').textContent,/南京动车段/);
  change('aircraftSubtypes',{checked:false});assert.doesNotMatch(root.querySelector('[data-stat-ranking="aircraft"]').textContent,/737-800|737-200|MAX/);
  cleanup();cleanup=mountStatistics(root,rows,{options});assert.equal(root.querySelector('[data-stat-option="railUnits"]').checked,true);assert.equal(root.querySelector('[data-stat-option="aircraftSubtypes"]').checked,false);
  assert.equal(JSON.stringify(rows),before);cleanup();dom.window.close();
});

test('rail power supply grouping separates conventional coaches, preserves EMUs and survives switching pages',()=>{
  const rows=[rail({railModel:'25GDC600V'}),rail({railModel:'25GAC380V'}),rail({railModel:'25G',railPowerSupply:'DC600V'}),rail({railModel:'25G'}),rail({railModel:'CR400AF / CR400AF'}),rail({railModel:'25T',railPowerSupply:'DC600V',departureDate:'2200-01-01'}),rail({railModel:'25T',template:'rail-refund-receipt'})];
  const before=JSON.stringify(rows),normal=journeyStatistics(rows,{...range,railSubtypes:false}),split=journeyStatistics(rows,range);
  assert.deepEqual(normal.railModels,[{name:'25G',count:4},{name:'CR400AF',count:1}]);
  assert.deepEqual(Object.fromEntries(split.railModels.map(row=>[row.name,row.count])),{'25G · DC600V':2,'25G · AC380V':1,'25G':1,CR400AF:1});
  for(const key of ['rail','flight','railMileage','railMileageTrips','aircraft','railBureaus','airports','stations','routes'])assert.deepEqual(split[key],normal[key]);
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root'),options={...range};let cleanup=mountStatistics(root,rows,{options});
  const change=checked=>{const toggle=root.querySelector('[data-stat-option="railSubtypes"]');toggle.checked=checked;toggle.dispatchEvent(new dom.window.Event('change',{bubbles:true}));};
  try{
    assert.equal(root.querySelector('[data-stat-option="railSubtypes"]').checked,true);
    assert.match(root.querySelector('[data-stat-ranking="rail-models"]').textContent,/DC600V/);
    change(false);
    cleanup();cleanup=mountStatistics(root,rows,{options});assert.equal(root.querySelector('[data-stat-option="railSubtypes"]').checked,false);
    assert.doesNotMatch(root.querySelector('[data-stat-ranking="rail-models"]').textContent,/DC600V|AC380V/);assert.equal(JSON.stringify(rows),before);
  }finally{cleanup();dom.window.close();}
});

test('rail model statistics uses saved submodels, preserves compound labels and groups known variants on request', () => {
  const date = journeyDate('2024-02-29');
  const railJourney = {
    query: { trainNum: 'D821', startDate: date, boardingDate: date, origin: '北京南', destination: '上海虹桥' },
    queriedAt: '2024-02-29T00:00:00Z',
    stops: [{ station: '北京南', departureDate: date, departureTime: '09:00' }, { station: '上海虹桥', arrivalDate: date, arrivalTime: '16:00' }],
    trainsets: [{ id: 'CRH5G-5218', model: 'CRH5G', subModel: '技术提升型' }, { id: 'CRH5G-5229', model: 'CRH5G', subModel: '技术提升型' }],
    coupling: true,
  };
  const rows = [
    rail({ service: 'D821', railModel: 'CRH5G', railJourney }), rail({ railModel: 'ｃｒｈ５ｇ (技术提升)' }),
    rail({ railModel: 'CRH5G' }), rail({ railModel: 'CRH5G（旧型）' }), rail({ railModel: 'CRH5A' }),
    rail({ railModel: 'CRH2C1 / CRH2C一阶段 / CRH2C（一阶）' }),
    rail({ railModel: 'CRH380A(统型,公务版) / CR400BF-GS' }), rail({ railModel: 'CR400BF-S / CR400BF-GS' }),
    rail({ railModel: '25G (DC600V 供电)' }), rail({ railModel: '25T (BSP)', railPowerSupply: 'AC380V' }),
    rail({ railModel: 'CR200J3-C / CR200J1-D' }), rail({ railModel: 'CRH6A-A / CRH6A' }),
    rail({ railModel: '未知车型（说明）' }),
  ];
  const before = JSON.stringify(rows);
  const counts = options => Object.fromEntries(journeyStatistics(rows, { ...range, ...options }).railModels.map(({ name, count }) => [name, count]));
  assert.deepEqual(counts(), {
    'CRH5G（技术提升型）': 2, CRH5G: 1, 'CRH5G（旧型）': 1, CRH5A: 1, 'CRH2C（一阶段）': 1,
    'CRH380A（统型、公务版）': 1, 'CR400BF-GS': 2, 'CR400BF-S': 1, '25G · DC600V': 1, '25T（BSP） · AC380V': 1,
    'CR200J3-C': 1, 'CR200J1-D': 1, 'CRH6A-A': 1, CRH6A: 1, '未知车型(说明)': 1,
  });
  assert.deepEqual(counts({ railSubtypes: false }), {
    CRH5G: 4, CRH5A: 1, CRH2C: 1, CRH380A: 1, CR400BF: 2, '25G': 1, '25T': 1,
    CR200J: 1, CRH6A: 1, '未知车型(说明)': 1,
  });
  const dom = new JSDOM('<div id="root"></div>'), root = dom.window.document.querySelector('#root');
  const cleanup = mountStatistics(root, rows, { options: { ...range } });
  try {
    const subtype = root.querySelector('[data-stat-option="railSubtypes"]');
    assert.equal(subtype.checked, true);
    subtype.checked = false;
    subtype.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.doesNotMatch(root.querySelector('[data-stat-ranking="rail-models"]').textContent, /技术提升型|公务版|CR400BF-GS|DC600V|AC380V/);
    assert.equal(root.querySelector('[data-stat-option="aircraftSubtypes"]').checked, true);
    assert.equal(JSON.stringify(rows), before);
  } finally { cleanup(); dom.window.close(); }
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
    change('[data-stat-option=railSubtypes]', { checked: false });
    assert.equal(picked('rail-models'), 'columns');
    assert.doesNotMatch(card('rail-models').textContent, /DC600V/);
    change('[data-stat-option=aircraftSubtypes]', { checked: false });
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
  const count = () => root.querySelector('.statistics-journey-card strong').textContent;
  let cleanup = () => {};
  try {
    cleanup = mountStatistics(root, rows, { options });
    assert.equal(end(), '2026-11-19');
    assert.equal(count(), '1 次');
    cleanup();
    clock = new NativeDate(2026, 10, 20, 0, 1);
    cleanup = mountStatistics(root, rows, { options });
    assert.equal(end(), '2026-11-20');
    assert.equal(count(), '2 次');
    applyStatisticsDate(root, '[data-stat-to]', '2026-11-19');
    clock = new NativeDate(2026, 10, 21, 0, 1);
    dom.window.dispatchEvent(new dom.window.Event('focus'));
    assert.equal(end(), '2026-11-19');
    assert.equal(count(), '1 次');
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
