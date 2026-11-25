import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord, archive, readArchive } from '../src/model.js';
import { railQuery, railDetails, railCompletion } from '../src/rail-lookup-model.js';
import { lookupRailDetails } from '../src/rail-data.js';
import { railLookupMarkup, bindRailLookup } from '../src/rail-lookup.js';
import { applyLookupValues } from '../src/lookup-values.js';
import { journeyStatistics } from '../src/statistics-model.js';
import { mountStatistics } from '../src/statistics.js';
import { ticketSVG } from '../src/tickets.js';

const record = extra => createRecord({ type:'rail', service:'G1', origin:'北京南', destination:'上海虹桥', departureDate:'2026-11-17', ...extra });
const payload = extra => ({ success:true, data:{ bureau:'H', bureauShortName:'上局', car:'CR400BF-S', numberFull:['G1'], rundays:['20261116','20261117'], timetable:[{station:'北京南',day:0,arrive:'06:30',depart:'06:30'},{station:'南京南',day:0,arrive:'10:13',depart:'10:15'},{station:'上海虹桥',day:0,arrive:'11:24',depart:'11:24'}], ...extra } });

test('RailGo requests send only public train and start-day identifiers and reject absent or mismatched data', async () => {
  const ticket = record({service:'ｇ１',passenger:'示例旅客',identity:'P000001',price:'100'}), query=railQuery(ticket), calls=[];
  const result=await lookupRailDetails(query,{fetcher:async(url,options)=>{calls.push({url,options});return Response.json(payload());}});
  const url=new URL(calls[0].url);
  assert.deepEqual([...url.searchParams],[['trainNum','G1'],['date','20261117']]);
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
  assert.equal(result.railBureau,'上海局');assert.equal(result.railModel,'CR400BF-S');
  assert.throws(()=>railQuery({...ticket,departureDate:'2026-11'}),/完整/);
  assert.throws(()=>railQuery({...ticket,service:'G1?secret=x'}),/车次/);
  assert.throws(()=>railQuery({...ticket,type:'flight'}),/火车行程/);
  assert.throws(()=>railQuery({...ticket,template:'rail-refund-receipt'}),/火车行程/);
  assert.throws(()=>railDetails(payload({rundays:['20261118']}),query),/未确认/);
  assert.throws(()=>railDetails(payload({numberFull:['G2']}),query),/未确认/);
  assert.throws(()=>railDetails(payload({bureauShortName:'京局'}),query),/不一致/);
  assert.throws(()=>railDetails(payload(),{...query,origin:'深圳北'}),/已返回时刻表.*缺少「深圳北」/);
  await assert.rejects(lookupRailDetails(query,{fetcher:async()=>Response.json({success:false},{status:400})}),/未查到/);
  await assert.rejects(lookupRailDetails(query,{fetcher:async()=>new Response('',{status:429})}),/较频繁/);
});

test('a boarding day is checked against the first-station date, including an after-midnight station departure', () => {
  const ticket=record({origin:'南京南'}), wrong=railQuery(ticket);
  const data=payload({timetable:[{station:'北京南',day:0,arrive:'19:00',depart:'19:00'},{station:'南京南',day:0,arrive:'23:58',depart:'00:05'},{station:'上海虹桥',day:1,arrive:'02:00',depart:'02:00'}]});
  assert.throws(()=>railDetails(data,wrong),/始发次日.*乘车日是 2026-11-18.*选择 2026-11-16/);
  const sameDay = railQuery(record({ departureDate: '2025-09-30' }), '2025-10-01');
  assert.throws(() => railDetails(payload({ rundays: ['20251001'] }), sameDay),
    /始发当天.*乘车日是 2025-10-01.*选择 2025-09-30/);
  const query=railQuery(ticket,'2026-11-16'), result=railDetails(data,query);
  const completion=railCompletion(ticket,result,'2026-11-16');
  assert.equal(completion.departureTime,'00:05');assert.equal(calendarDate(completion.arrivalDate),'2026-11-17');assert.equal(completion.arrivalTime,'02:00');
  assert.equal(calendarDate(completion.railJourney.query.startDate),'2026-11-16');assert.equal(completion.railBureau,'上海局');assert.equal(completion.railModel,'CR400BF-S');
  const protectedFields=railCompletion({...ticket,railBureau:'北京局',lockedFields:['railModel','departureTime']},result,'2026-11-16');
  assert.equal(protectedFields.railBureau,undefined);assert.equal(protectedFields.railModel,undefined);assert.equal(protectedFields.departureTime,undefined);
  assert.deepEqual(railCompletion({...ticket,destination:'苏州北'},result,'2026-11-16'),{});
});

test('new prefixes pass the lookup and snapshot checks, including combined numbers', async () => {
  for (const [service, trainNum] of [['N3', 'N3'], ['V1066/7', 'V1066']]) {
    const ticket = record({ service, departureDate: '2026-11-25' });
    const day = { numberFull: [trainNum], rundays: ['20261125'] };
    const result = await lookupRailDetails(railQuery(ticket), { enrich: false, fetcher: async url => {
      const params = new URL(url).searchParams;
      assert.equal(params.get('trainNum'), trainNum);
      assert.equal(params.get('date'), '20261125');
      return Response.json(payload(day));
    } });
    const [saved] = readArchive(archive([createRecord({ ...ticket, ...railCompletion(ticket, result) })]));
    assert.equal(saved.railJourney.query.trainNum, trainNum);
    assert.equal(saved.service, service);
    const wrongRoute = payload(day);
    wrongRoute.data.timetable[0].station = '杭州东';
    await assert.rejects(lookupRailDetails(railQuery(ticket), {
      enrich: false, fetcher: async () => Response.json(wrongRoute),
    }), /已返回时刻表.*缺少「北京南」/);
  }
});

test('a train that left before renumbering keeps its number and references stay on the same side of the cutoff', async () => {
  const ticket = record({ service: 'T109', departureDate: '2026-11-25' });
  const oldRun = payload({ numberFull: ['T109'], rundays: ['20261124'], timetable: [
    { station: '北京南', day: 0, depart: '23:55' },
    { station: '南京南', day: 1, arrive: '00:00', depart: '00:00' },
    { station: '上海虹桥', day: 1, arrive: '05:00' },
  ] });
  const fetcher = async () => Response.json(oldRun);
  await assert.rejects(lookupRailDetails(railQuery(ticket), { enrich: false, fetcher }), /未确认所查日期/);
  const overnight = { ...ticket, origin: '南京南' };
  const result = await lookupRailDetails(railQuery(overnight), { enrich: false, fetcher });
  assert.equal(calendarDate(result.railJourney.query.startDate), '2026-11-24');
  assert.equal(result.railJourney.query.referenceFor, undefined);
  assert.equal(result.departureTime, '00:00');
  const reused = railQuery({ ...ticket, service: 'Z3' });
  const dates = payload({ numberFull: ['Z3'], rundays: ['20261124', '20261128'] });
  assert.throws(() => railDetails(dates, reused), { referenceDate: '2026-11-28' });
});

test('RailGo fills from the closest run day, preserves the ticket date, and keeps the reference label after saving', async () => {
  const ticket = record({ departureTime: '07:10', lockedFields: ['departureTime'] }), calls = [];
  const timetable = [
    {station:'北京南',day:0,depart:'23:50'},
    {station:'上海虹桥',day:1,arrive:'05:30'}
  ];
  const dom = new JSDOM('<form>' + railLookupMarkup(ticket) + '<input name="service"><button type="submit">保存</button></form>');
  const form = dom.window.document.querySelector('form');
  const cleanup = bindRailLookup(form, {
    getRecord: () => ticket, canQuery: () => true,
    scannedRailQR: structuredClone(ticket),
    apply: (changes, source) => applyLookupValues(ticket, changes, !!source, source),
    lookup: (query, options) => lookupRailDetails(query, { ...options, fetcher: async url => {
      const date = new URL(url).searchParams.get('date');
      calls.push(date);
      return Response.json(payload({ timetable, rundays: date === '20261117' ? ['20261118', '20261002', '20261131', '20261116'] : ['20261116'] }));
    } })
  });
  try {
    await new Promise(done => setImmediate(done));
    assert.deepEqual(calls, ['20261117', '20261116']);
    const results = form.querySelector('[data-rail-result]');
    const diagnostics = form.querySelector('[data-rail-diagnostics]');
    assert.equal(results.hidden, false);
    assert.equal(results.open, false);
    assert.equal(results.contains(diagnostics), false);
    assert.equal(diagnostics.hidden, false);
    assert.equal(diagnostics.open, false);
    assert.match(diagnostics.textContent, /首次查询 · G1 · 2026-11-17 · HTTP 200/);
    assert.match(diagnostics.textContent, /参考日期复查 · G1 · 2026-11-16 · HTTP 200/);
    const [initial, fallback] = diagnostics.querySelectorAll('pre');
    assert.ok(initial.textContent.includes('rundays: ["20261118","20261002","20261131","20261116"]'));
    assert.ok(fallback.textContent.includes('rundays: ["20261116"]'));
    const reference = form.querySelector('[data-rail-reference]');
    assert.equal(reference.hidden, false);
    assert.match(reference.textContent, /非乘车当日 · 仅供参考.*参考开行日 2026-11-16.*乘车日 2026-11-17/);
    assert.equal(calendarDate(ticket.departureDate), '2026-11-17');
    assert.equal(ticket.departureTime, '07:10');
    assert.equal(ticket.arrivalTime, '05:30');
    assert.equal(calendarDate(ticket.arrivalDate), '2026-11-18');
    assert.equal(ticket.railModel, 'CR400BF-S');
    const backup = archive([ticket]);
    const [saved] = readArchive(backup);
    assert.doesNotMatch(JSON.stringify(backup), /rundays|20261131/);
    assert.equal(saved.fieldSources.railModel, 'railgo-reference');
    assert.equal(calendarDate(saved.railJourney.stops.at(-1).arrivalDate), '2026-11-17');
    assert.match(railLookupMarkup(saved), /非乘车当日 · 仅供参考/);
    const confirmed = railDetails(payload({ car: 'CR400AF' }), railQuery(saved));
    const fresh = railCompletion(saved, confirmed);
    applyLookupValues(saved, fresh, true, { kind: 'rail-lookup' });
    assert.equal(saved.fieldSources.railModel, 'railgo');
    assert.equal(saved.railModel, 'CR400AF');
    assert.doesNotMatch(railLookupMarkup(saved), /非乘车当日/);
    assert.deepEqual(railCompletion(saved, {query: railQuery(saved, '2026-11-16'), railJourney: ticket.railJourney}), {});
    ticket.service = 'G2';
    form.elements.service.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(reference.hidden, true);
    assert.equal(diagnostics.hidden, true);
    assert.equal(results.hidden, true);
    assert.equal(ticket.railModel, '');
    assert.equal(ticket.arrivalDate, '');
  } finally { cleanup(); dom.window.close(); }
});

test('an explicitly selected RailGo start date can fill reference data without a prompt to change the date', async t => {
  const ticket = record({ departureDate: '2025-09-30' }), calls = [];
  const dom = new JSDOM('<form>' + railLookupMarkup(ticket) + '</form>');
  const form = dom.window.document.querySelector('form');
  const cleanup = bindRailLookup(form, {
    getRecord: () => ticket, canQuery: () => true,
    apply: (changes, source) => applyLookupValues(ticket, changes, !!source, source),
    lookup: (query, options) => lookupRailDetails(query, { ...options, fetcher: async url => {
      calls.push(new URL(url).searchParams.get('date'));
      return Response.json(payload({ rundays: ['20251001', '20250930'] }));
    } })
  });
  t.after(() => { cleanup(); dom.window.close(); });

  const start = form.querySelector('[data-rail-start]');
  start.value = '2025-10-01';
  start.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  form.querySelector('[data-rail-lookup]').click();
  await new Promise(done => setImmediate(done));

  assert.deepEqual(calls, ['20251001']);
  assert.equal(start.value, '2025-10-01');
  assert.equal(calendarDate(ticket.departureDate), '2025-09-30');
  assert.equal(calendarDate(ticket.arrivalDate), '2025-09-30');
  assert.equal(ticket.fieldSources.railModel, 'railgo-reference');
  assert.match(form.querySelector('[data-rail-reference]').textContent, /仅供参考.*参考开行日 2025-10-01.*乘车日 2025-09-30/);
  assert.doesNotMatch(form.querySelector('[data-rail-status]').textContent, /后重查/);
});

test('RailGo diagnostics remain available when a response is rejected and reset on the next lookup', async t => {
  const ticket = record({ origin: '深圳北' });
  const dom = new JSDOM('<form>' + railLookupMarkup(ticket) + '</form>');
  const form = dom.window.document.querySelector('form');
  let fetchCount = 0;
  const cleanup = bindRailLookup(form, {
    getRecord: () => ticket, canQuery: () => true, apply: () => assert.fail('Rejected data must stay out of the ticket'),
    lookup: (query, options) => lookupRailDetails(query, { ...options, enrich: false, fetcher: async () => {
      if (++fetchCount === 2) return new Response(null, { status: 429 });
      return Response.json({ ...payload(), msg: '<b>example</b>' });
    } })
  });
  t.after(() => { cleanup(); dom.window.close(); });

  const button = form.querySelector('[data-rail-lookup]');
  const result = form.querySelector('[data-rail-result]');
  const diagnostics = form.querySelector('[data-rail-diagnostics]');
  const status = form.querySelector('[data-rail-status]');
  assert.equal(result.hidden, true);
  assert.equal(diagnostics.hidden, true);
  button.click();
  await new Promise(done => setImmediate(done));
  assert.match(status.textContent, /缺少「深圳北」/);
  assert.equal(result.hidden, true);
  assert.equal(diagnostics.hidden, false);
  const raw = diagnostics.querySelector('pre');
  assert.match(raw.textContent, /numberFull: \["G1"\]/);
  assert.ok(raw.textContent.includes('timetable[].station: ["北京南","南京南","上海虹桥"]'));
  assert.ok(raw.textContent.includes('msg: "<b>example</b>"'));
  assert.equal(raw.querySelector('b'), null);

  button.click();
  await new Promise(done => setImmediate(done));
  assert.match(status.textContent, /请求较频繁/);
  assert.equal(result.hidden, true);
  assert.equal(diagnostics.hidden, false);
  assert.match(diagnostics.textContent, /HTTP 429/);
  assert.equal(diagnostics.querySelector('pre'), null);
  diagnostics.open = true;
  cleanup();
  assert.equal(diagnostics.hidden, true);
  assert.equal(diagnostics.open, false);
  assert.equal(diagnostics.querySelector('[data-rail-responses]').textContent, '');
});

test('rail metadata persists through backups, is absent from printed tickets, and aggregates only included rail journeys', () => {
  const ticket=record({railBureau:'中国铁路上海局集团有限公司',railModel:'ｃｒ４００ｂｆ－ｓ'});
  assert.equal(ticket.railBureau,'上海局');assert.equal(ticket.railModel,'CR400BF-S');
  assert.equal(readArchive(archive([ticket]))[0].railModel,ticket.railModel);
  assert.equal(ticketSVG(ticket),ticketSVG({...ticket,railBureau:'',railModel:''}));
  const rows=[ticket,record({railBureau:'上局',railModel:'cr400bf-s'}),record({railBureau:'京局',railModel:'CR400AF'}),record({railBureau:'未来局',departureDate:'2027-01-01'}),record({railBureau:'退票局',template:'rail-refund-receipt'}),record({railBureau:'删除局',deleted:true}),createRecord({type:'flight',template:'air-boarding-pass',departureDate:'2026-11-17',railBureau:'飞机局',railModel:'AIR'})];
  const data=journeyStatistics(rows,{dateTo:'2026-11-17'});
  assert.deepEqual(data.railBureaus,[{name:'上海局',count:2},{name:'北京局',count:1}]);
  assert.deepEqual(data.railModels,[{name:'CR400BF-S',count:2},{name:'CR400AF',count:1}]);
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root'),cleanup=mountStatistics(root,rows,{options:{dateTo:'2026-11-17'}});
  assert.match(root.querySelector('[data-stat-ranking="rail-bureaus"]').textContent,/上海局2 次/);
  assert.match(root.querySelector('[data-stat-ranking="rail-models"]').textContent,/CR400BF-S2 次/);
  assert.doesNotMatch(root.textContent,/查看图表数据/);cleanup();dom.window.close();
});

test('rail lookup refreshes on an explicit click, blocks duplicate requests while busy and refuses stale or unavailable editor results', async () => {
  for (const invalidation of ['', 'changed', 'closed', 'saving', 'offline']) {
    const dom=new JSDOM(`<form>${railLookupMarkup(record())}<button type="submit">保存</button></form>`),form=dom.window.document.querySelector('form');
    let ticket=record(),count=0,resolve,allowed=true,signal;
    const apply=changes=>Object.assign(ticket,changes);
    const cleanup = bindRailLookup(form, { getRecord: () => ticket, canQuery: () => allowed, apply, lookup: (query, options) => {
      count++;
      signal = options.signal;
      options.onTimetableResponse({ trainNum: query.trainNum, date: query.date, httpStatus: 200, payload: payload() });
      return new Promise(done => resolve = () => done(railDetails(payload(), query)));
    } });
    const diagnostics = form.querySelector('[data-rail-diagnostics]');
    form.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(count,0);
    form.querySelector('[data-rail-lookup]').click();assert.equal(count,1);
    assert.equal(diagnostics.hidden, true);
    form.querySelector('[data-rail-lookup]').click();assert.equal(count,1);
    if(invalidation==='changed')ticket.service='G2';
    if(invalidation==='closed')cleanup();
    if(invalidation==='saving')form.querySelector('[type="submit"]').disabled=true;
    if(invalidation==='offline')allowed=false;
    resolve();await new Promise(done=>setTimeout(done,0));
    assert.equal(ticket.railModel,invalidation?'':'CR400BF-S');
    assert.equal(diagnostics.hidden, ['closed', 'changed'].includes(invalidation));
    if(!invalidation){form.querySelector('[data-rail-lookup]').click();assert.equal(count,2);resolve();await new Promise(done=>setTimeout(done,0));}
    if(invalidation==='closed')assert.equal(signal.aborted,true);
    cleanup();dom.window.close();
  }
});

test('a matching photo with a departure time or a complete QR trip triggers one automatic RailGo lookup', async () => {
  for (const scenario of ['valid', 'noTime', 'noDate', 'noTrain', 'noOrigin', 'noDestination', 'edited', 'conflict', 'manual', 'qrNoTime', 'qrNoDestination']) {
    const ticket = record({ departureTime: '06:30' });
    const scannedRail = scenario === 'manual' ? undefined : structuredClone(ticket);
    const missing = { noTime:'departureTime', noDate:'departureDate', noTrain:'service', noOrigin:'origin', noDestination:'destination', qrNoTime:'departureTime', qrNoDestination:'destination' }[scenario];
    if (missing) scannedRail[missing] = '';
    if (scenario === 'edited') ticket.departureTime = '06:31';
    if (scenario === 'qrNoTime') ticket.departureTime = '';
    const dom = new JSDOM('<form>' + railLookupMarkup(ticket) + '<button type="submit">保存</button></form>');
    const form = dom.window.document.querySelector('form');
    let count = 0;
    const dispose = bindRailLookup(form, {
      getRecord: () => ticket, canQuery: () => true,
      ...(scenario.startsWith('qr') ? { scannedRailQR: scannedRail } : { scannedRail }),
      apply: changes => Object.assign(ticket, changes),
      lookup: async query => {
        count++;
        return railDetails(payload({ timetable: [
          { station:'北京南', day:0, arrive:'', depart:scenario === 'conflict' ? '06:31' : '06:30' },
          { station:'上海虹桥', day:0, arrive:'11:24', depart:'' }
        ] }), query);
      }
    });
    form.dispatchEvent(new dom.window.Event('input', { bubbles:true }));
    await new Promise(done => setImmediate(done));
    assert.equal(count, ['valid','conflict','qrNoTime'].includes(scenario) ? 1 : 0, scenario);
    assert.equal(ticket.railModel, ['valid','qrNoTime'].includes(scenario) ? 'CR400BF-S' : '', scenario);
    if (scenario === 'conflict') assert.match(form.querySelector('[data-rail-status]').textContent, /发车时间与票面不同/);
    dispose();
    dom.window.close();
  }
});
