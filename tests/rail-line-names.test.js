import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateRailLines,matchRailLineNames,loadRailLineNames,railLineAnnotations} from '../src/rail-line-names.js';
import {railWgs84Point,railMapPoint} from '../src/rail-projection.js';
import {normalizeRailRoute} from '../src/rail-route-snapshot.js';
import {createRecord,archive,readArchive} from '../src/model.js';
import {savedRailwayNetwork,railwayGeometry} from '../src/railway-network.js';

const a=[116,39],b=[116.2,39],c=[116.4,39];
const geometry=()=>({segments:[[a,b,c]],stops:[{name:'甲站',coordinates:a},{name:'乙站',coordinates:b},{name:'丙站',coordinates:c}]});
const line=(name,points,stations)=>({name,segments:[points.map(railWgs84Point)],stations});

test('line names require sustained geometric agreement rather than matching station names alone',()=>{
  const shape=geometry(),sources=[line('甲客专',[a,b],['甲站','乙站']),line('乙线',[b,c],['乙站','丙站']),line('平行线',[[116,39.005],[116.4,39.005]],['甲站','丙站'])];
  const labels=matchRailLineNames(shape,sources);
  assert.deepEqual([...new Set(labels.map(row=>row.name))],['甲客专','乙线']);
  assert.ok(labels.every(label=>label.coordinates[0]>=116&&label.coordinates[0]<=116.4));
  assert.deepEqual(matchRailLineNames(shape,[sources[2]]),[]);
  assert.deepEqual(matchRailLineNames(shape,[line('歧义甲线',[a,c],['甲站','丙站']),line('歧义乙线',[a,c],['甲站','丙站'])]),[]);
  assert.deepEqual(matchRailLineNames(shape,[line('仅站前共线',[a,[116.03,39]],['甲站','丙站'])]),[]);
});

test('catalog directions are deduplicated, source downloads are bounded and cached, and name failure keeps the route',async()=>{
  const shape=geometry(),catalog={A:{name:'甲客专(甲-丙)',stations:['甲站','乙站','丙站']},B:{name:'甲客专(丙-甲)',stations:['丙站','乙站','甲站']},C:{name:'无关线路',stations:['丁站']}};
  assert.equal(candidateRailLines(shape,catalog).length,1);
  const requests=[],fetcher=async url=>{requests.push(url);return Response.json(url.endsWith('rails.json')?catalog:{features:[{geometry:{type:'LineString',coordinates:[a,b,c].map(railWgs84Point)}}]});};
  const named=await loadRailLineNames(shape,{fetcher});assert.equal(named.lineLabels[0].name,'甲客专');assert.equal(requests.length,2);
  await loadRailLineNames(shape,{fetcher});assert.equal(requests.length,2);
  const offline=async()=>{throw Error('offline');};assert.equal(await loadRailLineNames(shape,{fetcher:offline}),shape);
});

test('names persist through backups and the offline journey map only uses labels in the traveled geometry',()=>{
  const shape=geometry(),route=normalizeRailRoute({service:'G123',origin:'乙',destination:'丙',queriedAt:'2026-11-17T01:00:00Z',segments:[[b,c]],stops:shape.stops.slice(1),lineLabels:[{name:'乙线',coordinates:[116.3,39]}],fullRoute:{...shape,segments:[[a,b],[b,c]],lineLabels:[{name:'甲客专',coordinates:[116.1,39]},{name:'乙线',coordinates:[116.3,39]}]}});
  // Stop labels are normalized with the same trailing 站 rule used by normal routes.
  const record=createRecord({service:'G123',origin:'乙',destination:'丙',departureDate:'2026-11-17',railRoute:route});
  assert.deepEqual(readArchive(archive([record]))[0].railRoute.lineLabels,route.lineLabels);
  const network=savedRailwayNetwork([record]),map=railwayGeometry(network);
  assert.deepEqual(map.lineLabels.map(row=>row.name),['乙线']);
  const point=railMapPoint([116.3,39]),viewport={x:point[0],y:point[1],zoom:100};
  const annotations=railLineAnnotations([...map.lineLabels,...map.lineLabels],viewport,600,400);
  assert.equal(annotations.length,1);assert.equal(annotations[0].name,'乙线');
  assert.equal(railLineAnnotations(map.lineLabels,viewport,600,400,[[0,0,600,400]]).length,0);
  assert.throws(()=>normalizeRailRoute({...route,lineLabels:[{name:'bad',coordinates:[999,39]}]}),/线路名称/);
});
