import { parseScanText } from '../src/scan-engine.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, archive, readArchive } from '../src/model.js';
import { normalizeSeatClass } from '../src/seat-classes.js';

test('common seat class aliases are stored consistently across entry, imports and export', () => {
  for (const value of ['二等', '二等座', ' 二 等 座 ']) assert.equal(createRecord({ seatClass: value }).seatClass, '二等座');
  assert.equal(parseScanText('日期：2026-11-15 车次：G103 出发：北京南 到达：上海虹桥 二等座')[0].seatClass, '二等座');
  assert.throws(() => createRecord({ seatClass: '站票' }), /单独选择无座/);
  const [record] = parseScanText('车次：G103 日期：2026-11-15 出发：北京南 到达：上海虹桥 二等座 05车无座');
  const saved = readArchive(archive([record]))[0];
  assert.equal(saved.seatClass, '二等座');
  assert.equal(saved.railStanding, true);
  assert.equal(saved.carriage, '05');
  assert.equal(saved.seat, '');
  assert.equal(normalizeSeatClass('商务舱', 'flight'), '公务舱');
  assert.equal(normalizeSeatClass('商务', 'rail'), '商务座');
  assert.equal(normalizeSeatClass('特别观景包厢', 'rail'), '特别观景包厢');
  assert.equal(normalizeSeatClass('Y', 'flight'), 'Y');
  assert.equal(normalizeSeatClass('constructor', 'rail'), 'constructor');
});

test('a standing ticket keeps its class and does not require an assigned place',async()=>{
  const { missingTicketFields } = await import('../src/ticket-form.js');
  const { ticketSVG } = await import('../src/tickets.js');
  const ticket = createRecord({railStanding:true,seatClass:'二等座'});
  assert.ok(!missingTicketFields(ticket).includes('seat'));
  assert.ok(!missingTicketFields(ticket).includes('carriage'));
  assert.match(ticketSVG(ticket), />无座</);
  assert.match(ticketSVG(ticket), />二等座</);
  assert.ok(missingTicketFields(createRecord({railStanding:true})).includes('seatClass'));
});

 test('flight booking codes preserve explicit letters without inferring them from a cabin name', () => {
  for (const value of ['Y','y','Y舱','Y 舱','经济舱（Y）','Y（经济舱）']) assert.equal(normalizeSeatClass(value,'flight'),'Y');
  assert.equal(normalizeSeatClass('M1','flight'),'M1');
  assert.equal(normalizeSeatClass('经济舱','flight'),'经济舱');
  const imported = createRecord({ type: 'flight', template: 'air-boarding-pass', service: 'CA181', seatClass: 'M1', identity: 'E12****89', gate: '32A' });
  assert.equal(imported.seatClass,'M1'); assert.equal(imported.identity,'E12****89'); assert.equal(imported.gate,'32A');
  assert.equal(parseScanText('车次：D3759 日期：2023-05-26 出发：柳州 到达：来宾北 检票:5B')[0].gate,'5B');
  const record=createRecord({type:'flight',template:'air-boarding-pass',seatClass:'j'});
  assert.equal(readArchive(archive([record]))[0].seatClass,'J');
});

test('timeline describes flight cabin codes with 舱 while printed passes retain bare codes and rail classes stay unchanged',async()=>{
  const {timeline}=await import('../src/timeline.js'),{ticketSVG}=await import('../src/tickets.js');
  const flight=createRecord({type:'flight',template:'air-boarding-pass',departureDate:'2026-01-01',seatClass:'Y'}),rail=createRecord({departureDate:'2026-01-01',seatClass:'二等座'});
  assert.match(timeline([flight,rail],()=>''),/>Y舱</);assert.match(timeline([flight,rail],()=>''),/>二等座</);
  assert.doesNotMatch(ticketSVG(flight),/Y舱/);assert.match(ticketSVG(flight),/>Y</);
  const named=createRecord({...flight,seatClass:'经济舱'});assert.match(timeline([named],()=>''),/>经济舱</);assert.doesNotMatch(ticketSVG(named),/>经济舱</);assert.match(ticketSVG(named),/>经济</);
});
