import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText } from '../src/scan-engine.js';
import { parseFlightScreenshot } from '../src/flight-screenshot.js';
import { parseText, parseSingleTicket, mapFlightResult } from '../src/importers.js';
import { archive, readArchive, createRecord } from '../src/model.js';
import { ticketSVG } from '../src/tickets.js';
import { JSDOM } from 'jsdom';

const detail=`航旅纵横
11:27
厦门航空 MF8123
北京大兴-西宁曹家堡T3
计划 2025-06-05 18:00-20:30
波音737-85C(WL)
机龄13.1年 编号B0000
实际到达时间21:37
客票已使用
含税票价:100CNY
座位号:12A
舱位 经济舱(Z)
客票号 0000*****1234
订座编号 A1B2C3
购票证件 身份证(*000)
前序MU5103已起飞 预计11:20到达
航班已到达 2025-06-05 21:37
本次飞行数据报告`;
const row=(text,left,top,width=100,height=24)=>`5\t1\t1\t1\t1\t1\t${left}\t${top}\t${width}\t${height}\t90\t${text}`;

test('Umetrip details use the planned journey and keep aircraft metadata and visible masked values',()=>{
  for(const read of [text=>parseText(text),text=>[parseSingleTicket(text)]]){
    const records=read(detail);assert.equal(records.length,1);const r=records[0];
    assert.deepEqual([r.type,r.service,r.originCode,r.destinationCode],['flight','MF8123','PKX','XNN']);
    assert.deepEqual([calendarDate(r.departureDate),r.departureTime,r.arrivalTime],['2025-06-05','18:00','20:30']);
    assert.equal(calendarDate(r.arrivalDate),'');assert.equal(r.seat,'12A');assert.equal(r.seatClass,'Z');assert.equal(r.price,'100');
    assert.equal(r.aircraft,'737-85C(WL)');assert.equal(r.aircraftRegistration,'B0000');
    assert.equal(r.ticketNumber,'0000*****1234');assert.equal(r.pnr,'A1B2C3');assert.equal(r.identity,'*000');
    assert.equal(r.boardingCode,'');assert.ok(!JSON.stringify(r).includes('data:image'));
  }
});

test('history cards stay separate, retain only visible years, and reject unrelated times and registrations as flights',()=>{
  const text=`历史行程
09:41 AM 100%
下单时间 2025-01-01
CZ381
21:48   08:18
白云机场T2   布里斯班机场T1
航班点评
CZ3706
18:06   19:31
天河机场T3   白云机场T2
航班点评
2019-06-13 星期四
MU2544
22:18   23:40
浦东机场T1   天河机场T3
前序MU5103 预计11:20
航班点评`;
  const rows=parseText(text);
  assert.deepEqual(rows.map(r=>r.service),['CZ381','CZ3706','MU2544']);
  assert.deepEqual(rows.map(r=>calendarDate(r.departureDate)),['','','2019-06-13']);
  assert.deepEqual(rows.map(r=>[r.originCode,r.destinationCode]),[['CAN','BNE'],['WUH','CAN'],['PVG','WUH']]);
  assert.deepEqual(rows.map(r=>r.departureTime),['21:48','18:06','22:18']);
  assert.equal(parseSingleTicket(text),null);assert.deepEqual(parseScanText(text,'camera',{singleTicket:true}),[]);
});

test('OCR positions restore reversed columns and label-value tables without mistaking baggage weight for a seat or fare',()=>{
  const layout=[row('航旅纵横',30,20),row('MF8123',30,60),row('北京大兴-西宁草家堡T3',30,100,320),row('计划2025-06-0518:00-20:30',30,150,450),row('含税票价',30,210),row('座位号',250,210),row('已托运',500,210),row('1件9KG',500,250),row('GIA',250,250),row('100CNY',30,250),row('舱位经济舱(Z)',30,300),row('订座编号A1B2C3O',30,350)].reverse().join('\n');
  const [r]=parseFlightScreenshot('航旅纵横 MF8123','text','local',{layout,supplementalText:'0000*****1234 A1B2C3'});
  assert.equal(r.service,'MF8123');assert.equal(r.destinationCode,'XNN');assert.equal(r.seat,'61A');assert.equal(r.price,'100');
  assert.equal(r.departureTime,'18:00');assert.equal(r.arrivalTime,'20:30');assert.equal(r.ticketNumber,'0000*****1234');assert.equal(r.pnr,'A1B2C3');
});

test('unknown dates, ambiguous cities and missing fields are left for review rather than invented',()=>{
  const [r]=parseText('航旅纵横\nCA1234\n北京-上海\n06月05日\n18:00 20:30\n订座编号A1B2C3');
  assert.equal(calendarDate(r.departureDate),'');assert.equal(r.originCode,'');assert.equal(r.destinationCode,'');
  assert.equal(r.aircraft,'');assert.equal(r.aircraftRegistration,'');assert.equal(r.seat,'');
  const [overnight]=parseText('航旅纵横\nCA1234 2025-06-05\nPEK -> LHR\n23:00 06:30 +1天');
  assert.equal(calendarDate(overnight.arrivalDate),'2025-06-06');
});

test('aircraft and registration survive backups and imports and render only when supplied in both boarding languages',()=>{
  const r=createRecord({type:'flight',template:'air-boarding-pass',service:'MF8123',origin:'PKX',destination:'XNN',aircraft:'Boeing 737-85C(WL)',aircraftRegistration:'B0000'});
  assert.equal(readArchive(archive([r]))[0].aircraftRegistration,'B0000');
  assert.equal(mapFlightResult([{aircraft:'A350',aircraftRegistration:'G-TEST'}])[0].aircraftRegistration,'G-TEST');
  assert.equal(parseText('航班:CA1234\n机型:A350\n飞机编号:G-TEST')[0].aircraftRegistration,'G-TEST');
  for(const [origin,label] of [['PKX','飞机编号'],['LHR','REG']]){
    const dom=new JSDOM(ticketSVG({...r,origin,originCode:origin}),{contentType:'image/svg+xml'});
    const metadata=dom.window.document.querySelector('[data-boarding-aircraft]');
    assert.ok(metadata.textContent.includes(label));assert.ok(metadata.textContent.includes(r.aircraft));assert.ok(metadata.textContent.includes('B0000'));
    dom.window.close();
  }
  const absent=new JSDOM(ticketSVG({...r,aircraft:'',aircraftRegistration:''}),{contentType:'image/svg+xml'});
  assert.equal(absent.window.document.querySelector('[data-boarding-aircraft]'),null);absent.window.close();
});


test('screen chrome, damaged aircraft labels and unlabelled registrations cannot split a single itinerary',()=>{
  const text=`行程详情
全 Bi ft 90+
厦门航空MF8123
北京大兴 - 西于曹家堡T3   WE737-85C(WL)
StH2025-06-0518:00-20:30
2513年索瑟 B0000
实际到达时间21:37
含税票价   座位号   已托运
100CNY   6G1A   1件9KG
身份证000
经济舱(Z)`;
  const rows=parseFlightScreenshot(text,'text','local',{supplementalText:'100CNY 61A 1件9KG\n波音737-85C(WL)\n编号B0000\n身份证(*000)'});
  assert.equal(rows.length,1);const r=rows[0];
  assert.deepEqual([r.service,r.originCode,r.destinationCode],['MF8123','PKX','XNN']);
  assert.deepEqual([calendarDate(r.departureDate),r.departureTime,r.arrivalTime],['2025-06-05','18:00','20:30']);
  assert.equal(r.seat,'61A');assert.equal(r.aircraftRegistration,'B0000');assert.equal(r.identity,'*000');
});
