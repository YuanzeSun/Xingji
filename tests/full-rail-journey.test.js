import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord,archive,readArchive} from '../src/model.js';
import { csv } from './helpers/ticket-csv.js';
import {parseCSV} from '../src/importers.js';
import {railQuery,railCompletion,railDetails} from '../src/rail-lookup-model.js';
import {lookupRailDetails} from '../src/rail-data.js';
import {railJourneyMarkup} from '../src/rail-journey-ui.js';
import {splitRailModel,parseRailGoModel} from '../src/rail-details.js';
import {journeyStatistics} from '../src/statistics-model.js';

const ticket=extra=>createRecord({service:'T109',origin:'天津西',destination:'南京',departureDate:'2026-11-17',...extra});
const timetable=()=>[
  {station:'北京',arrive:'20:00',depart:'20:00',day:0,distance:0},
  {station:'天津西',arrive:'21:00',depart:'21:02',day:0,distance:148,stopTime:2},
  {station:'南京',arrive:'06:00',depart:'06:02',day:1,distance:1162,stopTime:2},
  {station:'上海',arrive:'09:00',depart:'09:00',day:1,distance:1463}
];
function fetcher(change=rows=>rows,mainChange=rows=>rows){return async url=>{
  const path=new URL(url).pathname;
  const data={numberFull:['T109'],rundays:['20261117'],car:'25K',timetable:mainChange(timetable())};
  if(path.endsWith('getTrainMain'))return Response.json({success:true,data:{...data,timetable:data.timetable.map(({distance,...stop})=>stop)}});
  if(path==='/api/train/query')return Response.json({...data,timetable:change(data.timetable)});
  return Response.json({success:false});
};}
test('a complete train timetable highlights only the booked section and saves matched cumulative mileage',async()=>{
  const original=ticket(),result=await lookupRailDetails(railQuery(original),{fetcher:fetcher()});
  assert.equal(result.railMileage,'1014');assert.equal(result.departureTime,'21:02');assert.equal(calendarDate(result.arrivalDate),'2026-11-18');
  assert.equal(result.railJourney.stops.length,4);assert.deepEqual(result.railJourney.stops.map(stop=>stop.distanceKm),[0,148,1162,1463]);
  const saved=createRecord({...original,...railCompletion(original,result)}),dom=new JSDOM(railJourneyMarkup(saved)),root=dom.window.document.body;
  assert.deepEqual([...root.querySelectorAll('[data-my-segment="true"] th>span')].map(node=>node.textContent),['天津西','南京']);
  assert.deepEqual([...root.querySelectorAll('[data-my-segment="false"] th>span')].map(node=>node.textContent),['北京','上海']);
  assert.match(root.textContent,/列车全程/);assert.match(root.querySelector('.rail-my-range').textContent,/1014 km/);
  assert.deepEqual(readArchive(archive([saved]))[0].railJourney,saved.railJourney);assert.equal(parseCSV(csv([saved]))[0].railMileage,'1014');
  assert.equal(railCompletion({...original,railMileage:'999'},result).railMileage,undefined);dom.window.close();
  assert.equal(createRecord({...saved,origin:'北京',originCode:''}).railMileage,'');
  assert.equal(createRecord({...saved,origin:'北京',originCode:'',railMileage:'999',lockedFields:['railMileage']}).railMileage,'999');
});
test('unmatched present-day stops or times and placeholder mileage never populate historical or unknown mileage',async()=>{
  for(const alter of [rows=>rows.map((row,i)=>i===1?{...row,depart:'21:03'}:row),rows=>rows.map((row,i)=>i===2?{...row,station:'南京南'}:row),rows=>rows.map(row=>({...row,distance:0}))]){
    const result=await lookupRailDetails(railQuery(ticket()),{fetcher:fetcher(alter)});
    assert.equal(result.railMileage,undefined);assert.ok(result.railJourney.stops.every(stop=>stop.distanceKm===null));
  }
});

test('mileage matching permits absent arrival at the first station and departure at the terminal',async()=>{
  const endpoints=rows=>rows.map((row,i)=>i===0?{...row,arrive:'--:--'}:i===rows.length-1?{...row,depart:'--:--'}:row);
  const result=await lookupRailDetails(railQuery(ticket()),{fetcher:fetcher(rows=>rows,endpoints)});
  assert.equal(result.railMileage,'1014');
  assert.equal(calendarDate(result.railJourney.stops[0].arrivalDate),'');assert.equal(result.railJourney.stops.at(-1).departureDate,'');
});
test('rolling stock model and explicit power supply are independent; identical models share one ranking',()=>{
  for(const [input,model,power] of [['25TDC600V','25T','DC600V'],['25GAC380V','25G','AC380V'],['25K','25K',''],['25B','25B',''],['CR400BF-A','CR400BF-A',''],['25T AC380V/DC600V','25T','AC380V / DC600V']])assert.deepEqual(splitRailModel(input),{model,powerSupply:power});
  const dc=ticket({railModel:'25GDC600V'}),ac=ticket({railModel:'25GAC380V'});
  assert.equal(dc.railModel,'25G');assert.equal(dc.railPowerSupply,'DC600V');assert.equal(ac.railPowerSupply,'AC380V');
  const stats=journeyStatistics([dc,ac],{dateTo:'2026-11-17'});assert.deepEqual(stats.railModels,[{name:'25G',count:2}]);
  assert.equal(parseCSV(csv([dc]))[0].railPowerSupply,'DC600V');
});
test('rail mileage follows the statistics date range, omits missing distances and excludes refunds',()=>{
  const rows=[ticket({railMileage:'1014'}),ticket({railMileage:''}),ticket({railMileage:'999',departureDate:'2200-01-01'}),ticket({railMileage:'999',template:'rail-refund-receipt'})];
  const result=journeyStatistics(rows,{dateTo:'2026-11-17'});assert.equal(result.railMileage,1014);assert.equal(result.railMileageTrips,1);assert.equal(result.rail,2);
  for(const value of ['-1','NaN','100001','0.0001'])assert.throws(()=>ticket({railMileage:value}),/里程/);
});

test('RailGo-specific BSP and domestic labels follow its provider dictionary and keep power supply separate',()=>{
  for(const [raw,model,powerSupply] of [['BSTAC380V','25T (BSP)','AC380V'],['BST','25T (BSP)',''],['25TAC380V','25T (BSP)','AC380V'],['25TDC600V','25T (国产)','DC600V'],['25T (BSP)','25T (BSP)','']])assert.deepEqual(parseRailGoModel(raw),{model,powerSupply});
  assert.deepEqual(splitRailModel('25TAC380V'),{model:'25T',powerSupply:'AC380V'});
  const original=ticket({service:'Z83',origin:'北京',destination:'齐齐哈尔'}),query=railQuery(original);
  const response={success:true,data:{car:'BSTAC380V',numberFull:['Z83'],rundays:['20261117'],timetable:[{station:'北京',day:0,arrive:'18:00',depart:'18:00'},{station:'齐齐哈尔',day:1,arrive:'12:00',depart:'12:00'}]}};
  const result=railDetails(response,query),saved=createRecord({...original,...railCompletion(original,result)});assert.equal(saved.railModel,'25T (BSP)');assert.equal(saved.railPowerSupply,'AC380V');
  response.data.rundays=['20261125'];assert.throws(()=>railDetails(response,query),/未确认/);
});
