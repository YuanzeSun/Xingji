import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecord,archive,readArchive} from '../src/model.js';
import {lookupRailDetails} from '../src/rail-data.js';
import {railQuery,railCompletion} from '../src/rail-lookup-model.js';
import {railJourneyMarkup} from '../src/rail-journey-ui.js';
import {calendarDate} from '../src/journey-date.js';

test('station access follows the booked station day and the pre-change train number and queries only the departure platform',async()=>{
  const ticket=createRecord({service:'Z83',origin:'南京南',destination:'上海虹桥',departureDate:'2026-11-17'}),calls=[];
  const timetable=[{station:'北京南',day:0,arrive:'',depart:'19:00',trainCode:'Z83'},{station:'南京南',day:0,arrive:'23:58',depart:'00:05',trainCode:'Z82'},{station:'上海虹桥',day:1,arrive:'02:00',depart:'',trainCode:'Z82'}];
  const fetcher=async url=>{
    const request=new URL(url);calls.push(request);
    if(request.pathname.endsWith('/getTrainMain'))return Response.json({success:true,data:{numberFull:['Z83','Z82'],rundays:['20261116'],car:'25TDC600V',timetable}});
    if(request.pathname.endsWith('/getExit'))return Response.json({success:true,data:request.searchParams.get('kind')==='departure'?{entrance:['二层12检票口','二层13检票口','快速进站厅12、13检票口'],platform:'13',exit:['不保存的出口']}:{entrance:['不采用的到达检票口'],platform:'5',exit:['不保存的出口']}});
    return Response.json({success:false});
  };
  const result=await lookupRailDetails(railQuery(ticket,'2026-11-16'),{fetcher}),requests=calls.filter(url=>url.pathname.endsWith('/getExit'));
  assert.equal(requests.length,1);assert.equal(requests[0].searchParams.get('trainNum'),'Z83');assert.equal(requests[0].searchParams.get('kind'),'departure');
  assert.ok(requests.every(url=>url.searchParams.get('date')==='2026-11-17'));
  assert.equal(result.gate,'12 / 13');assert.equal(result.railPlatform,'13');assert.equal(result.railArrivalPlatform,undefined);assert.equal(result.railJourney.access.length,1);
  const changes=railCompletion(ticket,result,'2026-11-16');assert.equal(changes.gate,'12 / 13');
  const saved=createRecord({...ticket,...changes}),restored=readArchive(archive([saved]))[0];assert.equal(calendarDate(restored.railJourney.access[0].date),'2026-11-17');assert.equal(restored.railPlatform,'13');
  const protectedValues=railCompletion({...ticket,gate:'手填A1',railPlatform:'8',lockedFields:['gate','railPlatform']},result,'2026-11-16');assert.equal(protectedValues.gate,undefined);assert.equal(protectedValues.railPlatform,undefined);
  assert.doesNotMatch(JSON.stringify(restored),/不保存的出口|不采用的到达检票口/);assert.match(JSON.stringify(restored.railJourney),/二层12检票口/);
  assert.doesNotMatch(railJourneyMarkup(restored),/检票与站台|二层12检票口/);
});

test('identified stock keeps model and individual remarks as escaped persisted text without adding excluded facility fields',async()=>{
  const ticket=createRecord({service:'G1',origin:'北京南',destination:'上海虹桥',departureDate:'2026-11-17'});
  const fetcher=async url=>{
    const request=new URL(url);
    if(request.pathname.endsWith('/getTrainMain'))return Response.json({success:true,data:{numberFull:['G1'],rundays:['20261117'],car:'CR400BF',timetable:[{station:'北京南',day:0,arrive:'',depart:'09:00'},{station:'上海虹桥',day:0,arrive:'13:00',depart:''}]}});
    if(request.hostname.startsWith('emu.')&&request.pathname==='/api/query')return Response.json({success:true,data:[{trainNum:'G1',runDate:'2026-11-17',trainCode:['CR400BF-5033'],coupling:false}]});
    if(request.pathname==='/api/car/info')return Response.json({success:true,data:{id:'CR400BF-5033',model:'CR400BF',custom_type:'定制批次',remark:{model:'车型说明 <script>bad</script>',car:{note:'本车改造备注\n第二行'}},business_seat_type:'不保存的商务座'}});
    return Response.json({success:false});
  };
  const result=await lookupRailDetails(railQuery(ticket),{fetcher}),record=createRecord({...ticket,...railCompletion(ticket,result)}),stock=record.railJourney.trainsets[0];
  assert.equal(stock.modelRemark,'车型说明 <script>bad</script>');assert.equal(stock.carRemark,'本车改造备注\n第二行');assert.equal(stock.customType,'定制批次');
  assert.equal(readArchive(archive([record]))[0].railJourney.trainsets[0].carRemark,stock.carRemark);
  const markup=railJourneyMarkup(record);assert.match(markup,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(markup,/<script>|不保存的商务座/);
});
