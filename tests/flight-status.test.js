import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord, archive, readArchive, csv, applyImport } from '../src/model.js';
import { parseCSV, parseText, mapFlightResult } from '../src/importers.js';
import { validateTicketForm } from '../src/ticket-form.js';
import { ticketSVG } from '../src/tickets.js';
import { journeyStatistics, tripSeries } from '../src/statistics-model.js';
import { journeyNetwork } from '../src/journey-map-model.js';
import { timeline } from '../src/timeline.js';
import { cityOverview } from '../src/locations.js';
import { GitHubStore, synchronize } from '../src/github.js';
import { MemoryGitHub } from './helpers/cloud.js';
const flight = extra => createRecord({type:'flight',template:'air-boarding-pass',origin:'PEK',destination:'SHA',service:'CA1234',departureDate:'2023-11-18',departureTime:'08:00',passenger:'TEST/USER',identity:'P000001',seat:'12A',seatClass:'Y',aircraft:'DHC-8',...extra});

test('open and invalid flights can archive undetermined details while ordinary flights retain their required fields',()=>{
 for(const flightStatus of ['open','invalid']){
  const r=flight({flightStatus,service:'',departureDate:'',departureTime:'',seat:'',identity:'',seatClass:''});
  assert.doesNotThrow(()=>validateTicketForm(r));assert.equal(r.flightStatus,flightStatus);
 }
 assert.throws(()=>validateTicketForm(flight({service:''})),/航班号/);
 assert.throws(()=>flight({flightStatus:'invented'}),/状态/);
 assert.equal(flight({}).flightStatus,'normal');
});
test('main coupon and stub visibly mark special tickets in both boarding languages',()=>{
 for(const flightStatus of ['open','invalid'])for(const origin of ['PEK','LHR']){
  const r=flight({flightStatus,origin,originCode:origin,service:'',departureDate:''});
  const dom=new JSDOM(ticketSVG(r),{contentType:'image/svg+xml'});
  assert.equal(dom.window.document.querySelectorAll(`[data-flight-status="${flightStatus}"]`).length,2);
  assert.match(dom.window.document.querySelector('[data-boarding-section="main"]').textContent,flightStatus==='open'?/OPEN/:/VOID/);
  dom.window.close();
 }
 assert.doesNotMatch(ticketSVG(flight({})),/data-flight-status/);
});
test('special tickets remain in the archive but never contribute to any journey dimension, map or city count',()=>{
 const normal=flight({id:'normal'}),special=['open','invalid'].map((flightStatus,i)=>flight({id:'special-'+i,flightStatus,origin:'LHR',destination:'SYD',aircraft:'E195-E2'}));
 const data=journeyStatistics([normal,...special],{dateTo:'2023-12-31'});
 assert.equal(data.flight,1);assert.equal(data.records.length,1);assert.deepEqual(data.aircraft,[{name:'DHC-8',count:1}]);
 assert.deepEqual(data.countries.map(x=>x.code),['CN']);assert.equal(data.airports.length,2);assert.equal(data.routes.length,1);
 assert.equal(journeyNetwork([normal,...special]).records.length,1);
 assert.equal(cityOverview([normal,...special]).cities.length,2);
 assert.equal(tripSeries([normal,...special])[0].flight,1);
 assert.match(timeline([normal,...special],()=>''),/data-id="special-0"/);assert.match(timeline([normal,...special],()=>''),/data-id="special-1"/);
 assert.equal(journeyStatistics(special,{dateTo:'2023-12-31'}).omittedDates,0);
});
test('JSON, CSV, text and cloud round trips preserve state, and automatic deduplication cannot change a normal journey into an invalid one',async()=>{
 const invalid=flight({id:'invalid',flightStatus:'invalid'}),normal=flight({id:'normal'});
 for(const r of [readArchive(archive([invalid]))[0],parseCSV(csv([invalid]))[0],mapFlightResult([{flightStatus:'invalid'}])[0]])assert.equal(r.flightStatus,'invalid');
 assert.equal(parseText('航班: CA1234\n出发机场:PEK\n到达机场:SHA\n机票状态:OPEN')[0].flightStatus,'open');
 assert.equal(parseText('OPEN\nPEK -> SHA\n姓名:TEST/USER')[0].type,'flight');
 assert.equal(parseText('车次:G103\n日期:2023-11-18\n票据状态:无效\n出发站:柳州\n到达站:来宾北')[0].type,'rail');
 assert.equal(applyImport([normal],[invalid]).records.length,2);
 const server=new MemoryGitHub([normal,invalid]),store=new GitHubStore({owner:'user',repo:'data',branch:'main',id:77},'fake-key',server.fetch);
 const snapshot=await store.read();assert.equal(snapshot.records.find(r=>r.id==='invalid').flightStatus,'invalid');
 const result=await synchronize(store,snapshot.records,snapshot.records,{}, {baseHead:snapshot.head,baseSettings:snapshot.settings,localSettings:snapshot.settings});
 assert.equal(result.conflicts.length,0);assert.equal(result.records.length,2);assert.equal(result.records.find(r=>r.id==='invalid').flightStatus,'invalid');
});
