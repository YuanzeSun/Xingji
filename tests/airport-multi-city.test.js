import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord,archive,readArchive} from '../src/model.js';
import {resolveCities,cityLabel,cityOverview,placesInCity} from '../src/locations.js';
import {searchAirports,resolvePlace} from '../src/places.js';
import {searchTickets} from '../src/search.js';
import {suggestCities} from '../src/reference-suggestions.js';
import {bindAirportPicker} from '../src/airport-picker.js';
import {searchPanel} from '../src/search-panel.js';
import {journeyStatistics} from '../src/statistics-model.js';
import {journeyNetwork,mapPoint} from '../src/journey-map-model.js';

const cases=[['XIY','西安','咸阳'],['XNN','西宁','海东'],['LXA','拉萨','山南'],['YTY','扬州','泰州'],['JGN','嘉峪关','酒泉'],['PKX','北京','廊坊'],['WHA','芜湖','宣城'],['TEN','铜仁','湘西'],['XAI','信阳','驻马店']];
const flight=extra=>createRecord({id:'out',type:'flight',template:'air-boarding-pass',origin:'XNN',destination:'SHA',departureDate:'2026-11-16',service:'CA1234',...extra});

test('all nine named or cross-city airports display both cities and match either city in searches and directional filters',()=>{
  for(const [code,...cities] of cases){
    const out=flight({origin:code}),back=flight({id:'back',origin:'SHA',destination:code}),rows=[out,back];
    assert.deepEqual(resolveCities(out,'origin'),cities);assert.equal(out.originCity,cities.join(' / '));assert.equal(cityLabel(out,'origin'),out.originCity);
    for(const name of [code,searchAirports(code)[0].name,searchAirports(code)[0].chineseFullName])assert.deepEqual(resolveCities({type:'flight',origin:name},'origin'),cities,name);
    for(const city of cities){
      assert.ok(searchAirports(city,20).some(place=>place.code===code),code+' airport candidate for '+city);
      assert.ok(suggestCities(code).some(row=>row.name===city),code+' city candidate for '+city);
      assert.equal(searchTickets(rows,{city}).records.length,2);assert.equal(searchTickets(rows,{query:city}).records.length,2);
      assert.deepEqual(searchTickets(rows,{originCity:city,destinationCity:'上海'}).records.map(row=>row.id),['out']);
      assert.equal(searchTickets(rows,{originCity:city,destinationCity:'上海',bothDirections:true}).records.length,2);
      assert.deepEqual(placesInCity(rows,city),[out.origin]);
      assert.equal(resolvePlace({type:'flight',origin:city},'origin').status,'unknown','a city name does not silently select one airport');
    }
    assert.equal(readArchive(archive([out]))[0].originCity,out.originCity);
    assert.equal(readArchive(archive([back]))[0].destinationCity,back.destinationCity);
  }
  const conflict=flight({origin:'西宁曹家堡',originCode:'LXA'});assert.deepEqual(resolveCities(conflict,'origin'),[]);
});

test('secondary city spellings and county aliases find the right airport without changing airport identity or timezones',()=>{
  for(const [code,query] of [['XIY','xianyang'],['XNN','haidong'],['LXA','shannan'],['PKX','langfang'],['WHA','xuancheng'],['TEN','凤凰'],['TEN','fenghuang'],['XAI','zhumadian']]){
    const record=flight({origin:code});assert.equal(searchTickets([record],{query}).records.length,1,query);
    assert.equal(searchTickets([record],{originCity:query}).records.length,1,query);
    assert.ok(searchAirports(query,20).some(row=>row.code===code),query);
    assert.equal(record.originCode,code);assert.equal(record.departureZone,'Asia/Shanghai');
  }
  const candidate=searchAirports('XNN')[0];candidate.cities.push('错误城市');assert.deepEqual(searchAirports('XNN')[0].cities,['西宁','海东']);
});

test('multi-city airport suggestions and common routes show both cities without creating duplicate trips or airport nodes',()=>{
  const dom=new JSDOM('<label class="field"><span>出发机场</span><span class="airport-picker"><input><span role="listbox" hidden></span></span></label>'),input=dom.window.document.querySelector('input');
  bindAirportPicker(input,()=>{});input.focus();input.value='海东';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.match(dom.window.document.querySelector('[role="option"] small').textContent,/^西宁 \/ 海东/);dom.window.close();
  const rows=[flight(),flight({id:'back',origin:'SHA',destination:'XNN'}),createRecord({id:'rail',origin:'西宁',destination:'上海虹桥',departureDate:'2026-11-16'})];
  const overview=cityOverview(rows);assert.deepEqual(overview.cities.find(([city])=>city==='西宁'),['西宁',3]);assert.deepEqual(overview.cities.find(([city])=>city==='海东'),['海东',2]);
  assert.equal(overview.routes.length,1);assert.equal(overview.routes[0].count,3);
  const html=searchPanel(rows,{},searchTickets(rows));assert.match(html,/西宁 \/ 海东/);
  const stats=journeyStatistics(rows,{dateTo:'2026-11-17'});assert.equal(stats.flight,2);assert.equal(stats.airports.length,2);assert.equal(stats.routes.length,1);assert.equal(stats.routes[0].count,2);
  const network=journeyNetwork(rows,{type:'flight'});assert.equal(network.mapped,2);assert.equal(network.nodes.length,2);assert.equal(network.routes.length,1);assert.equal(network.routes[0].records.length,2);
  assert.equal(mapPoint(rows[0],'origin').id,'airport:XNN');
});
