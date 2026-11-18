import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, archive, readArchive, applyImport, mergeThreeWay } from '../src/model.js';
import { resolveCity, cityOverview, placesInCity, sameCity, LOCATION_REFERENCE } from '../src/locations.js';
import { searchTickets } from '../src/search.js';
import { STATIONS } from '../src/data/location-reference.js';
import {AIRPORT_SERVICE_CITIES,AIRPORT_CITY_REFERENCE} from '../src/data/airport-cities.js';
import {searchAirports} from '../src/places.js';
import {suggestCities} from '../src/reference-suggestions.js';
const record = (values = {}) => createRecord({ id: 'city-test', origin: '清河', destination: '上海虹桥', service: 'G1', departureDate: '2026-11-15', ...values });

test('railway city lookup uses exact official records, including stations without a city prefix', () => {
  for (const [origin, city] of [['清河', '北京'], ['清河城', '邢台'], ['清河西', '邢台'], ['八达岭长城', '北京'], ['虎门', '东莞'], ['上海虹桥', '上海']]) {
    assert.equal(resolveCity(record({ origin }), 'origin').city, city, origin);
  }
  assert.ok(LOCATION_REFERENCE.railway.count >= 3000);
  assert.equal(resolveCity(record({ origin: '清河站' }), 'origin').city, '北京');
  assert.equal(resolveCity(record({ origin: '', originCode: 'QIP' }), 'origin').city, '北京');
  assert.equal(resolveCity(record({ origin: '', originCode: 'qinghe' }), 'origin').city, '北京');
  assert.equal(resolveCity(record({ origin: '北京某个未知站' }), 'origin').city, '', 'city prefixes are never guessed');
});

test('every unambiguous official station name resolves to its recorded city', () => {
  const names = new Map();
  for (const [name, city] of STATIONS) { if (!names.has(name)) names.set(name, new Set()); names.get(name).add(city); }
  for (const [name, cities] of names) {
    const actual = resolveCity({ type: 'rail', origin: name }, 'origin');
    assert.equal(actual.city, cities.size === 1 ? [...cities][0] : '', name);
  }
});

test('ambiguous, conflicting and unknown references stay unassigned even when a city is supplied', () => {
  assert.equal(resolveCity(record({ origin: '清河', originCode: 'QYP' }), 'origin').status, 'conflict');
  assert.equal(resolveCity(record({ origin: '清河', originCode: 'QYP' }), 'origin').city, '');
  const manual = resolveCity(record({ origin: '已停用的历史站名', originCity: '北京市' }), 'origin');
  assert.equal(manual.city, ''); assert.equal(manual.status, 'unknown');
  assert.equal(sameCity('beijing', '北京市'), true);
  assert.equal(sameCity('北京', '南京'), false);
});

test('airport lookup uses the IATA namespace and groups different airports in the same city', () => {
  for (const [originCode, city] of [['PEK', '北京'], ['PKX', '北京'], ['SHA', '上海'], ['PVG', '上海'], ['TFU', '成都'], ['CTU', '成都'], ['HND', '东京']]) {
    assert.equal(resolveCity(record({ type: 'flight', template: 'air-boarding-pass', origin: '', originCode }), 'origin').city, city, originCode);
  }
  assert.equal(resolveCity(record({ type: 'flight', template: 'air-boarding-pass', origin: '北京首都', originCode: 'SHA' }), 'origin').status, 'conflict');
  for (const [origin, city] of [['北京大兴', '北京'], ['成都天府', '成都'], ['广州白云', '广州']]) assert.equal(resolveCity(record({ type: 'flight', template: 'air-boarding-pass', origin }), 'origin').city, city);
  assert.equal(resolveCity(record({ type: 'flight', template: 'air-boarding-pass', origin: '', originCode: 'QIP' }), 'origin').city, '', 'rail telecodes are not airport codes');
  const london = code => resolveCity(record({ type: 'flight', template: 'air-boarding-pass', origin: '', originCode: code }), 'origin').city;
  assert.notEqual(london('LHR'), london('YXU'), 'same-named cities in different regions cannot be merged');
});

test('city searches include same-city stations and airports, keep direction consistent and expose pending cities', () => {
  const rows = [record(), record({ id: 'capital', origin: '北京南' }), record({ id: 'xingtai', origin: '清河城' }), record({ id: 'flight', type: 'flight', template: 'air-boarding-pass', origin: '北京首都', originCode: 'PEK', destination: '上海虹桥', destinationCode: 'SHA' }), record({ id: 'return', origin: '上海虹桥', destination: '清河' }), record({ id: 'unknown', origin: '从未收录的站名' })];
  const ids = filters => searchTickets(rows, filters).records.map(r => r.id).sort();
  assert.deepEqual(ids({ city: '北京' }), ['capital', 'city-test', 'flight', 'return']);
  assert.deepEqual(ids({ originCity: '北京', destinationCity: '上海' }), ['capital', 'city-test', 'flight']);
  assert.deepEqual(ids({ originCity: '北京', destinationCity: '上海', bothDirections: true }), ['capital', 'city-test', 'flight', 'return']);
  assert.deepEqual(ids({ originCity: '北京', destinationCity: '上海', origin: '上海虹桥', bothDirections: true }), [], 'city and station predicates must share one direction');
  assert.deepEqual(ids({ city: '__unknown__' }), ['unknown']);
  assert.deepEqual(ids({ query: '北京', origin: 'qinghe' }), ['city-test']);
  assert.deepEqual(ids({ origin: '北京' }), ['capital', 'flight'], 'station keywords do not match a hidden city alias');
  assert.deepEqual(placesInCity(rows, '北京'), ['北京南', '北京首都', '清河']);
  const overview = cityOverview(rows);
  assert.equal(overview.cities.find(([city]) => city === '北京')[1], 4);
  assert.equal(overview.routes.find(r => [r.originCity, r.destinationCity].includes('北京')).count, 4);
});

test('derived cities follow the database through edits, imports, backups and independent synchronization edits', () => {
  const r=record({originCity:'南京',destinationCity:'北京',lockedFields:['originCity']});
  assert.equal(r.originCity,'北京');assert.equal(r.destinationCity,'上海');assert.equal(r.lockedFields.includes('originCity'),false);
  assert.deepEqual(readArchive(JSON.parse(JSON.stringify(archive([r])))),[r]);
  const imported=readArchive(archive([r]))[0];assert.equal(imported.originCity,'北京');assert.equal(imported.destinationCity,'上海');
  assert.equal(record({...r,origin:'清河城',originCode:''}).originCity,'邢台');
  assert.equal(applyImport([r],[record({originCity:'邢台'})]).records[0].originCity,'北京');
  const base=record(),merged=mergeThreeWay([base],[r],[{...base,issuer:'北京南站'}]);
  assert.equal(merged.conflicts.length,0);assert.equal(merged.records[0].originCity,'北京');assert.equal(merged.records[0].issuer,'北京南站');
});

test('domestic airports use the CAAC named service city across codes, localized names and suggestions',()=>{
  assert.ok(AIRPORT_CITY_REFERENCE.matchedAirports>=250);
  for(const [code,city]of [['XNN','西宁'],['LXA','拉萨'],['XIY','西安'],['TFU','成都'],['YIW','义乌'],['JHG','西双版纳'],['LUM','德宏']]){
    assert.equal(AIRPORT_SERVICE_CITIES[code],city);
    const place=searchAirports(code)[0];assert.equal(place.city,city);
    for(const origin of [code,place.name,place.chineseFullName])assert.equal(resolveCity({type:'flight',origin},'origin').city,city,origin);
    assert.ok(searchAirports(city,20).some(row=>row.code===code),city);
    assert.ok(suggestCities(code).some(row=>row.name===city),code);
  }
  assert.equal(searchAirports('XNN')[0].municipality,'Haidong','physical geography is retained separately');
  assert.equal(resolveCity({type:'flight',origin:'西宁曹家堡',originCode:'LXA'},'origin').status,'conflict');
});

test('Xining flights are found by city filters and share common city routes with Xining train journeys',()=>{
  const out=record({id:'out',type:'flight',template:'air-boarding-pass',origin:'XNN',destination:'PEK',service:'CA1234'});
  const back=record({...out,id:'back',origin:'PEK',originCode:'PEK',destination:'XNN',destinationCode:'XNN'});
  const train=record({id:'train',origin:'西宁',destination:'北京西'}),rows=[out,back,train];
  assert.equal(out.originCity,'西宁 / 海东');assert.equal(back.destinationCity,'西宁 / 海东');
  for(const filters of [{city:'西宁'},{query:'西宁'},{originCity:'西宁',destinationCity:'北京',bothDirections:true}])assert.equal(searchTickets(rows,filters).records.length,3);
  assert.equal(searchTickets(rows,{originCity:'西宁'}).records.length,2);assert.equal(searchTickets(rows,{city:'海东'}).records.length,2);
  const overview=cityOverview(rows);assert.equal(overview.routes.length,1);assert.equal(overview.routes[0].count,3);assert.equal(overview.cities.find(([city])=>city==='海东')[1],2);
  assert.equal(readArchive(archive([out]))[0].originCity,'西宁 / 海东');
});
