import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord, archive, readArchive, csv } from '../src/model.js';
import { parseCSV, parseText } from '../src/importers.js';
import { railQuery, railDetails, railCompletion } from '../src/rail-lookup-model.js';
import { lookupRailDetails } from '../src/rail-data.js';
import { railLookupMarkup, bindRailLookup } from '../src/rail-lookup.js';
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
  assert.throws(()=>railDetails(payload(),{...query,origin:'深圳北'}),/乘车区间/);
  await assert.rejects(lookupRailDetails(query,{fetcher:async()=>Response.json({success:false},{status:400})}),/未查到/);
  await assert.rejects(lookupRailDetails(query,{fetcher:async()=>new Response('',{status:429})}),/较频繁/);
});

test('a boarding day is checked against the first-station date, including an after-midnight station departure', () => {
  const ticket=record({origin:'南京南'}), wrong=railQuery(ticket);
  const data=payload({timetable:[{station:'北京南',day:0,arrive:'19:00',depart:'19:00'},{station:'南京南',day:0,arrive:'23:58',depart:'00:05'},{station:'上海虹桥',day:1,arrive:'02:00',depart:'02:00'}]});
  assert.throws(()=>railDetails(data,wrong),/2026-11-16/);
  const query=railQuery(ticket,'2026-11-16'), result=railDetails(data,query);
  const completion=railCompletion(ticket,result,'2026-11-16');
  assert.equal(completion.departureTime,'00:05');assert.equal(calendarDate(completion.arrivalDate),'2026-11-17');assert.equal(completion.arrivalTime,'02:00');
  assert.equal(calendarDate(completion.railJourney.query.startDate),'2026-11-16');assert.equal(completion.railBureau,'上海局');assert.equal(completion.railModel,'CR400BF-S');
  const protectedFields=railCompletion({...ticket,railBureau:'北京局',lockedFields:['railModel','departureTime']},result,'2026-11-16');
  assert.equal(protectedFields.railBureau,undefined);assert.equal(protectedFields.railModel,undefined);assert.equal(protectedFields.departureTime,undefined);
  assert.deepEqual(railCompletion({...ticket,destination:'苏州北'},result,'2026-11-16'),{});
});

test('rail metadata persists through imports and backups, is absent from printed tickets, and aggregates only included rail journeys', () => {
  const ticket=record({railBureau:'中国铁路上海局集团有限公司',railModel:'ｃｒ４００ｂｆ－ｓ'});
  assert.equal(ticket.railBureau,'上海局');assert.equal(ticket.railModel,'CR400BF-S');
  assert.equal(readArchive(archive([ticket]))[0].railModel,ticket.railModel);
  assert.equal(parseCSV(csv([ticket]))[0].railBureau,ticket.railBureau);
  assert.equal(parseCSV('车次,担当路局,车型\nG1,上局,cr400bf-s')[0].railBureau,'上海局');
  assert.equal(parseText('车次：G1 日期：2026-11-17 出发：北京南 到达：上海虹桥 担当路局：上局 车型：CR400BF-S')[0].railModel,ticket.railModel);
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
    const cleanup=bindRailLookup(form,{getRecord:()=>ticket,canQuery:()=>allowed,apply,lookup:async(query,options)=>{count++;signal=options.signal;return new Promise(done=>resolve=()=>done(railDetails(payload(),query)));}});
    form.dispatchEvent(new dom.window.Event('input',{bubbles:true}));assert.equal(count,0);
    form.querySelector('[data-rail-lookup]').click();assert.equal(count,1);
    form.querySelector('[data-rail-lookup]').click();assert.equal(count,1);
    if(invalidation==='changed')ticket.service='G2';
    if(invalidation==='closed')cleanup();
    if(invalidation==='saving')form.querySelector('[type="submit"]').disabled=true;
    if(invalidation==='offline')allowed=false;
    resolve();await new Promise(done=>setTimeout(done,0));
    assert.equal(ticket.railModel,invalidation?'':'CR400BF-S');
    if(!invalidation){form.querySelector('[data-rail-lookup]').click();assert.equal(count,2);resolve();await new Promise(done=>setTimeout(done,0));}
    if(invalidation==='closed')assert.equal(signal.aborted,true);
    cleanup();dom.window.close();
  }
});
