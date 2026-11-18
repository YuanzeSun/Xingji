import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord, archive, readArchive, mergeThreeWay } from '../src/model.js';
import { lookupRailDetails, matchingRailTrainsets } from '../src/rail-data.js';
import { railQuery, railDetails, railCompletion } from '../src/rail-lookup-model.js';
import { normalizeRailJourney } from '../src/rail-journey.js';
import {markManualFields,applyLookupValues} from '../src/lookup-values.js';
import { railJourneyMarkup, bindRailJourney } from '../src/rail-journey-ui.js';
import { railLookupMarkup, bindRailLookup } from '../src/rail-lookup.js';
import { ticketSVG } from '../src/tickets.js';

const at='2026-11-17T02:00:00.000Z';
const ticket=extra=>createRecord({type:'rail',service:'G1',origin:'南京南',destination:'上海虹桥',departureDate:'2026-11-17',carriage:'03',...extra});
const main=(extra={})=>({success:true,data:{bureau:'H',bureauShortName:'上局',car:'CR400BF-S',carOwner:'上海动车段',runner:'上海客运段',numberFull:['G1'],rundays:['20261116','20261117'],timetable:[{station:'北京南',day:0,arrive:'19:00',depart:'19:00',stopTime:0},{station:'南京南',day:1,arrive:'00:03',depart:'00:05',stopTime:2},{station:'苏州北',day:1,arrive:'01:00',depart:'01:02',stopTime:2},{station:'上海虹桥',day:1,arrive:'02:00',depart:'02:00',stopTime:0}],...extra}});
const runs=rows=>({success:true,data:rows});
const stock=(id='CR400BF-5033')=>({success:true,data:{id,model:'CR400BF',sub_model:'二阶段',manufacture_month:'2018-04',trainset_manufacturer:'中车长客股份',depot:'天津动车所',train_depot:'天津动车客车段'}});
const picture='https://res.railgo.zenglingkun.cn/resourcecenter/cateringimages/example.png';
const coach=()=>({success:true,data:{trainStyle:'CR400BF-A',carCode:'CR400BF-A-5053',carInfo:[{pictureName:'餐车',pictureValue:'09车'}],coachPicList:[{pictureName:'02车 一等 60',pictureUrl:picture},{pictureName:'03车 二等 90',pictureUrl:picture+'?three'}],coachDetailPicList:[],carPic:picture}});
function fetcher(calls,runData=runs([{runDate:'2026-11-16',trainNum:'G1',trainCode:['CR400BF-5033'],coupling:false}])) {
  return async (url,options)=>{calls.push({url:new URL(url),options});const u=new URL(url);
    if(u.pathname.endsWith('getTrainMain'))return Response.json(main());
    if(u.pathname==='/api/query')return Response.json(runData);
    if(u.pathname==='/api/car/info')return Response.json(stock(u.searchParams.get('id')));
    if(u.pathname.endsWith('mapLine'))return Response.json({success:true,data:{stations:[{南京南:[118.8,32]},{苏州北:[120.6,31.4]},{上海虹桥:[121.3,31.2]}],train:{'南京南-苏州北':{index:1,line:[[118.8,32],[120.6,31.4]]},'苏州北-上海虹桥':{index:2,line:[[120.6,31.4],[121.3,31.2]]}}}});
    if(u.pathname.endsWith('getCoachPic'))return Response.json(coach());
    throw new Error('Unexpected '+url);
  };
}
async function completed() { const record=ticket(),result=await lookupRailDetails(railQuery(record),{fetcher:fetcher([])});return createRecord({...record,...railCompletion(record,result)}); }

test('refresh keeps compatible RailGo details and discards only stale automatic values for a changed timetable',async()=>{
  const record = ticket(), first = main();
  const names = first.data.timetable.map(stop => stop.station);
  const points = [[116.38, 39.86], [118.8, 32], [120.6, 31.4], [121.3, 31.2]];
  const ids = ['CR400BF-5033', 'CR400BF-5034'];
  const query = railQuery(record, '2026-11-16');
  const response = phase => async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('getTrainMain')) {
      const timetable = structuredClone(first.data.timetable);
      if (phase === 'changed') timetable.at(-1).arrive = '01:59';
      return Response.json(main({timetable}));
    }
    if (phase === 'unavailable' || phase === 'changed') return new Response('', {status:503});
    if (path === '/api/query') return Response.json(runs([{
      runDate:'2026-11-16', trainNum:'G1', trainCode:ids, coupling:true,
    }]));
    if (path === '/api/car/info') {
      const id = new URL(url).searchParams.get('id');
      if (phase === 'partial' && id === ids[1]) return new Response('', {status:503});
      const data = stock(id);
      if (phase === 'partial') data.data.depot = '北京动车所';
      return Response.json(data);
    }
    if (path.endsWith('getCoachPic')) {
      return Response.json(phase === 'partial'
        ? {success:true, data:{trainStyle:'CR400BF-A'}}
        : coach());
    }
    if (path.endsWith('getExit')) return Response.json({success:true,data:phase === 'full'
      ? {entrance:['16A检票口'],platform:'13'}
      : {platform:'18'}});
    if (path.endsWith('mapLine')) {
      const start = phase === 'full' ? 0 : 1;
      return Response.json({success:true,data:{
        stations:names.slice(start).map((name, i) => ({[name]: points[i + start]})),
        train:Object.fromEntries(names.slice(start + 1).map((name, i) => {
          const j = start + i;
          return [names[j] + '-' + name, {index:j, line:points.slice(j, j + 2)}];
        })),
      }});
    }
    if (path === '/api/train/query' && phase === 'full') {
      return Response.json({data:{
        ...first.data, timetable:first.data.timetable.map((stop, i) => ({...stop, distance:[0, 1023, 1225, 1302][i]})),
      }});
    }
    return new Response('', {status:503});
  };
  const initial = await lookupRailDetails(query,{fetcher:response('full')});
  applyLookupValues(record,railCompletion(record,initial));
  assert.equal(record.railMileage,'279');
  assert.ok(record.railRoute.fullRoute);
  const saved = {railJourney:record.railJourney,railRoute:record.railRoute};
  const unchanged = await lookupRailDetails(query,{...saved,fetcher:response('unavailable')});
  assert.deepEqual(unchanged.railRoute,record.railRoute);
  assert.deepEqual(unchanged.railJourney.trainsets,record.railJourney.trainsets);
  assert.deepEqual(unchanged.railJourney.coaches,record.railJourney.coaches);
  assert.deepEqual(unchanged.railJourney.access,record.railJourney.access);
  assert.equal(unchanged.railMileage,'279');

  const updated = await lookupRailDetails(query,{...saved,fetcher:response('partial')});
  assert.deepEqual(updated.railRoute.fullRoute,record.railRoute.fullRoute);
  assert.equal(updated.railJourney.trainsets[0].depot,'北京动车所');
  assert.deepEqual(updated.railJourney.trainsets[1],record.railJourney.trainsets[1]);
  assert.deepEqual(updated.railJourney.coaches.cars,record.railJourney.coaches.cars);
  assert.equal(updated.gate,'16A');
  assert.equal(updated.railPlatform,'18');
  assert.equal(updated.railJourney.distanceQueriedAt,record.railJourney.distanceQueriedAt);

  record.railPlatform = '手填';
  markManualFields(record,['railPlatform']);
  const changed = await lookupRailDetails(query,{...saved,fetcher:response('changed')});
  const changes = railCompletion(record,changed);
  assert.deepEqual(changes.railJourney.trainsets,[]);
  assert.equal(changes.railJourney.coaches,'');
  assert.equal(changes.railJourney.distanceQueriedAt,'');
  for (const key of ['railRoute','railMileage','railTrainsets','gate']) assert.equal(changes[key],'',key);
  assert.equal(changes.railPlatform,undefined);
});

test('explicit metadata refresh fetches route coordinates even when the ticket already has a saved route',async()=>{
  const saved=await completed(),calls=[];
  const result=await lookupRailDetails(railQuery(saved),{fetcher:fetcher(calls),railRoute:saved.railRoute});
  assert.ok(saved.railRoute);assert.deepEqual(result.railRoute.segments,saved.railRoute.segments);
  assert.equal(calls.filter(call=>call.url.pathname.endsWith('mapLine')).length,1);
});

test('middle-station boarding automatically retries the inferred first-station date and fills only the selected interval',async()=>{
  const record=ticket(),calls=[],result=await lookupRailDetails(railQuery(record),{fetcher:fetcher(calls)});
  assert.deepEqual(calls.filter(c=>c.url.pathname.endsWith('getTrainMain')).map(c=>c.url.searchParams.get('date')),['20261117','20261116']);
  assert.equal(calendarDate(result.railJourney.query.startDate),'2026-11-16');
  assert.deepEqual(result.railJourney.stops.map(stop=>stop.station),['北京南','南京南','苏州北','上海虹桥']);
  assert.equal(result.departureTime,'00:05');assert.equal(result.arrivalTime,'02:00');assert.equal(calendarDate(result.arrivalDate),'2026-11-17');
  assert.equal(result.railRunner,'上海客运段');assert.equal(result.railCarOwner,'上海动车段');
  assert.equal(result.railJourney.trainsets[0].id,'CR400BF-5033');assert.equal(result.railJourney.trainsets[0].manufactureMonth,'2018-04');
  assert.equal(result.railJourney.coaches.cars[1].number,'03');
  for(const call of calls){assert.equal(call.options.credentials,'omit');assert.equal(call.options.referrerPolicy,'no-referrer');assert.ok([...call.url.searchParams.keys()].every(key=>['trainNum','date','keyword','id','train','stationTelecode','kind'].includes(key)));}
  const changes=railCompletion({...record,departureTime:'00:06',railRunner:'手动担当段',lockedFields:['railCarOwner']},result);
  assert.equal(changes.departureTime,undefined);assert.equal(changes.railRunner,undefined);assert.equal(changes.railCarOwner,undefined);assert.equal(changes.arrivalTime,'02:00');
});

test('specific trainsets require an unambiguous matching first-station date and train number; coupled units stay distinct',()=>{
  const query=railQuery(ticket(),'2026-11-16'),row={runDate:'2026-11-16 19:00',trainNum:'G1',trainCode:['CR400BF-5033'],coupling:false};
  assert.equal(matchingRailTrainsets(runs([{...row,runDate:'2026-11-17'}]),query),null);
  assert.equal(matchingRailTrainsets(runs([{...row,trainNum:'G2'}]),query),null);
  assert.equal(matchingRailTrainsets(runs([row,{...row,trainCode:['CR400BF-5034']}]),query),null);
  assert.deepEqual(matchingRailTrainsets(runs([{...row,trainNum:'G1/G4',coupling:true,trainCode:['CR400BF-5033','CR400BF-5034']}]),query),{ids:['CR400BF-5033','CR400BF-5034'],coupling:true});
});

test('conventional trains preserve passenger and rolling-stock depots without inventing an EMU depot or consist ID',async()=>{
  const record=ticket({service:'Z22',origin:'拉萨',destination:'北京西'}),calls=[];
  const result=await lookupRailDetails(railQuery(record),{fetcher:async(url)=>{calls.push(new URL(url));return Response.json(new URL(url).pathname.endsWith('getTrainMain') ? main({car:'25TDC600V',bureau:'O',bureauShortName:'青藏',runner:'西宁客运段',carOwner:'西宁车辆段',numberFull:['Z22'],timetable:[{station:'拉萨',day:0,arrive:'15:50',depart:'15:50'},{station:'北京西',day:2,arrive:'08:43',depart:'08:43'}]}) : {success:false});}});
  assert.equal(result.railRunner,'西宁客运段');assert.equal(result.railCarOwner,'西宁车辆段');assert.equal(calendarDate(result.arrivalDate),'2026-11-19');
  assert.equal(calls.some(call=>call.hostname.startsWith('emu.')),false);
  const markup=railJourneyMarkup({...record,...railCompletion(record,result)});assert.doesNotMatch(markup,/动车所|乘坐的车组/);
});

test('missing historical trainsets and failed optional requests do not replace them with current identities or lose timetable data',async()=>{
  const calls=[],result=await lookupRailDetails(railQuery(ticket()),{fetcher:fetcher(calls,runs([{runDate:'2026-11-17',trainNum:'G1',trainCode:['CR400BF-A-5053']}]))});
  assert.deepEqual(result.railJourney.trainsets,[]);assert.equal(result.railJourney.coaches.code,'CR400BF-A-5053');
  const markup=railJourneyMarkup({...ticket(),...railCompletion(ticket(),result)});
  assert.doesNotMatch(markup,/乘坐的车组/);assert.match(markup,/当前编组参考/);
  const partial=await lookupRailDetails(railQuery(ticket()),{fetcher:async(url)=>{if(new URL(url).pathname.endsWith('getTrainMain'))return Response.json(main());throw new Error('Unavailable');}});
  assert.equal(partial.departureTime,'00:05');assert.equal(partial.partial,true);
});

test('rail snapshots survive JSON and independent cloud edits; a changed journey drops stale snapshots',async()=>{
  const record=await completed();
  assert.deepEqual(readArchive(archive([record]))[0].railJourney,record.railJourney);
  assert.equal(readArchive(archive([record]))[0].railTrainsets,'CR400BF-5033');
  const merged=mergeThreeWay([record],[createRecord({...record,seat:'09A'})],[createRecord({...record,price:'100'})]);
  assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.records[0].railJourney,record.railJourney);
  assert.equal(createRecord({...record,departureDate:'2026-11-18'}).railJourney,'');
  assert.equal(createRecord({...record,service:'G2'}).railJourney,'');
  assert.equal(createRecord({...record,destination:'苏州北',destinationCode:''}).railJourney,'');
  assert.equal(createRecord({...record,deleted:true}).railJourney,'');
  assert.equal(ticketSVG(record),ticketSVG({...record,railJourney:'',railRunner:'',railCarOwner:''}));
});

test('manually entered trainset IDs normalize, round-trip and remain protected when cleared or refreshed',async()=>{
  const record=await completed(),result=await lookupRailDetails(railQuery(record),{fetcher:fetcher([])});
  record.railTrainsets=' cr400af-0001，CR400AF-0002 / cr400af-0001';markManualFields(record,['railTrainsets']);
  const saved=createRecord(record);assert.equal(saved.railTrainsets,'CR400AF-0001 / CR400AF-0002');
  assert.equal(railCompletion(saved,result).railTrainsets,undefined);
  assert.equal(readArchive(archive([saved]))[0].railTrainsets,saved.railTrainsets);
  assert.equal(ticketSVG(saved),ticketSVG({...saved,railTrainsets:''}));
  saved.railTrainsets='';markManualFields(saved,['railTrainsets']);assert.equal(railCompletion(saved,result).railTrainsets,undefined);
  const automatic=ticket();applyLookupValues(automatic,railCompletion(automatic,result),true,{kind:'rail-lookup'});
  assert.equal(automatic.fieldSources.railTrainsets,'railgo');assert.equal(automatic.lookupValues.railTrainsets,'CR400BF-5033');
});

test('snapshot normalization limits remote images and rejects a mismatched boarding section',async()=>{
  const record=await completed(),snapshot=structuredClone(record.railJourney);
  snapshot.coaches.cars.push({name:'恶意图片',url:'https://example.com/track.png',number:'04'});
  snapshot.coaches.picture='javascript:alert(1)';
  const cleaned=normalizeRailJourney(snapshot);assert.equal(cleaned.coaches.cars.length,2);assert.equal(Object.hasOwn(cleaned.coaches,'picture'),false);assert.equal(Object.hasOwn(cleaned.coaches,'interiors'),false);
  snapshot.query.boardingDate='2026-11-18';assert.throws(()=>normalizeRailJourney(snapshot),/乘车区间/);
});

test('unwanted carriage facilities and trainset fields are dropped from saved data and detail display',async()=>{
  const record=await completed(),snapshot=structuredClone(record.railJourney);
  Object.assign(snapshot.trainsets[0],{toilet:'坐便',businessSeat:'旋转座椅'});
  snapshot.coaches.info=[{name:'餐车',value:'09车'},...['婴儿护理台','列车办公席','无障碍车厢和卫生间','商务座'].map(name=>({name,value:'01车'}))];
  const saved=createRecord({...record,railJourney:snapshot});
  assert.equal(Object.hasOwn(saved.railJourney.trainsets[0],'toilet'),false);
  assert.equal(Object.hasOwn(saved.railJourney.trainsets[0],'businessSeat'),false);
  assert.deepEqual(saved.railJourney.coaches.info,[{name:'餐车',value:'09车'}]);
  assert.doesNotMatch(railJourneyMarkup(saved),/婴儿护理台|办公席|无障碍|卫生间|商务座|坐便|旋转座椅/);
  assert.match(railJourneyMarkup(saved),/餐车/);
});

test('detail view highlights the ticket carriage, switches diagrams and links only confirmed same-trainset encounters',async()=>{
  const record=await completed(),other=createRecord({...record,id:'another',departureDate:'2026-11-16',railJourney:{...record.railJourney,query:{...record.railJourney.query,boardingDate:'2026-11-16'},stops:record.railJourney.stops.map(stop=>({...stop,arrivalDate:stop.arrivalDate ? new Date(Date.parse(calendarDate(stop.arrivalDate)+'T00:00:00Z')-86400000).toISOString().slice(0,10) : '',departureDate:stop.departureDate ? new Date(Date.parse(calendarDate(stop.departureDate)+'T00:00:00Z')-86400000).toISOString().slice(0,10) : ''}))}});
  const unrelated=createRecord({...other,id:'unrelated',railTrainsets:'CR400BF-9999',railJourney:{...other.railJourney,trainsets:[{id:'CR400BF-9999'}]}});
  const dom=new JSDOM(railJourneyMarkup(record,[record,other,unrelated])),root=dom.window.document.body,cleanup=bindRailJourney(root,()=>record);
  assert.equal(root.querySelector('.ticket-carriage').getAttribute('aria-pressed'),'true');
  assert.match(root.querySelector('[data-rail-coach-image]').alt,/03车/);
  assert.doesNotMatch(root.textContent,/查看列车编组原图|车厢与设施照片/);
  root.querySelector('[data-rail-coach="0"]').click();assert.match(root.querySelector('[data-rail-coach-image]').alt,/02车/);
  assert.ok(root.querySelector('[data-action="view"][data-id="another"]'));assert.equal(root.querySelector('[data-id="unrelated"]'),null);
  assert.doesNotMatch(root.textContent,/NKH|AOH|查看图表数据/);cleanup();dom.window.close();
});

test('lookup becomes available after the four necessary fields are complete without sending requests on input',()=>{
  let record=ticket({service:'',departureDate:''}),calls=0;
  const dom=new JSDOM(`<form>${railLookupMarkup(record)}</form>`),form=dom.window.document.querySelector('form');
  const cleanup=bindRailLookup(form,{getRecord:()=>record,canQuery:()=>true,apply:()=>{},lookup:()=>{calls++;}});
  assert.equal(form.querySelector('[data-rail-lookup]').disabled,true);
  record=ticket();form.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(form.querySelector('[data-rail-lookup]').disabled,false);assert.equal(calls,0);assert.equal(form.querySelector('[data-rail-start]').value,'');
  cleanup();dom.window.close();
});

test('changing query conditions clears untouched automatic completions while keeping edits made after the query',async()=>{
  let record=ticket({origin:'北京南'}),clears=0;
  const dom=new JSDOM(`<form><input name="arrivalTime"/><input name="service"/>${railLookupMarkup(record)}<button type="submit">保存</button></form>`),form=dom.window.document.querySelector('form');
  const cleanup=bindRailLookup(form,{getRecord:()=>record,canQuery:()=>true,lookup:async query=>railDetails(main({timetable:[{station:'北京南',day:0,arrive:'06:30',depart:'06:30'},{station:'上海虹桥',day:0,arrive:'11:24',depart:'11:24'}]}),query,at),apply:(changes,source)=>{Object.assign(record,changes);if(!source)clears++;}});
  form.querySelector('[data-rail-lookup]').click();await new Promise(done=>setTimeout(done,0));assert.equal(record.departureTime,'06:30');
  record.arrivalTime='11:30';form.elements.arrivalTime.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  record.service='G2';form.elements.service.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal(clears,1);assert.equal(record.railModel,'');assert.equal(record.departureTime,'');assert.equal(record.railJourney,'');assert.equal(record.arrivalTime,'11:30');
  cleanup();dom.window.close();
});

test('a date-confirmed specific trainset model takes priority over the less specific timetable model snapshot',async()=>{
  const result=await lookupRailDetails(railQuery(ticket()),{fetcher:fetcher([])});
  assert.equal(result.railModel,'CR400BF');
  assert.equal(result.railJourney.trainsets[0].model,'CR400BF');
});

test('a temporary line-name source outage retains saved names only for identical route geometry',async()=>{
  const saved=await completed();saved.railRoute.lineLabels=[{name:'京沪高速线',coordinates:[120,31.6]}];
  const result=await lookupRailDetails(railQuery(saved),{fetcher:fetcher([]),railRoute:saved.railRoute});
  assert.equal(result.railRoute.fullRoute, undefined);
  assert.deepEqual(result.railRoute.lineLabels,saved.railRoute.lineLabels);
  assert.notEqual(result.railRoute.lineLabels,saved.railRoute.lineLabels);
  const changed=structuredClone(saved.railRoute);changed.segments[0][0][0]+=.001;
  const fresh=await lookupRailDetails(railQuery(saved),{fetcher:fetcher([]),railRoute:changed});
  assert.equal(fresh.railRoute.lineLabels,undefined);
});
