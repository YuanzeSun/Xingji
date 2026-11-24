import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText } from '../src/scan-engine.js';
import { mapFlightResult } from '../src/importers.js';
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
test('rail scan ignores flight itineraries and boarding passes', () => {
  assert.deepEqual(parseScanText(detail), []);
  assert.deepEqual(parseScanText('BOARDING PASS\nFLIGHT: BA321\nFROM: JFK\nTO: LHR'), []);
});

test('aircraft and registration survive backups and imports and render only when supplied in both boarding languages',()=>{
  const r=createRecord({type:'flight',template:'air-boarding-pass',service:'MF8123',origin:'PKX',destination:'XNN',aircraft:'Boeing 737-85C(WL)',aircraftRegistration:'B0000'});
  assert.equal(readArchive(archive([r]))[0].aircraftRegistration,'B0000');
  assert.equal(mapFlightResult([{aircraft:'A350',aircraftRegistration:'G-TEST'}])[0].aircraftRegistration,'G-TEST');
  for(const [origin,label] of [['PKX','飞机编号'],['LHR','REG']]){
    const dom=new JSDOM(ticketSVG({...r,origin,originCode:origin}),{contentType:'image/svg+xml'});
    const metadata=dom.window.document.querySelector('[data-boarding-aircraft]');
    assert.ok(metadata.textContent.includes(label));assert.ok(metadata.textContent.includes(r.aircraft));assert.ok(metadata.textContent.includes('B0000'));
    dom.window.close();
  }
  const absent=new JSDOM(ticketSVG({...r,aircraft:'',aircraftRegistration:''}),{contentType:'image/svg+xml'});
  assert.equal(absent.window.document.querySelector('[data-boarding-aircraft]'),null);absent.window.close();
});
