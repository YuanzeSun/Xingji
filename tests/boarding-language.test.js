import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord, archive, readArchive } from '../src/model.js';
import { boardingPresentation } from '../src/boarding-language.js';
import { ticketSVG } from '../src/tickets.js';
import { DEMO_BOARDING_CODE } from '../src/demo-boarding-code.js';

const flight = extra => createRecord({ type:'flight', template:'air-boarding-pass', origin:'北京首都', destination:'伦敦希思罗', passenger:'ZHANG/SAN', airline:'中国国际航空', departureDate:'2023-05-26', service:'CA937', seatClass:'Y', boardingCode:DEMO_BOARDING_CODE, boardingCodeSource:'original', boardingLegIndex:'0', ...extra });

test('departure airport chooses the whole pass language, independently of destination or input language', () => {
  for (const [origin, destination, language, airport] of [
    ['北京首都','伦敦希思罗','zh','北京首都国际机场'],
    ['Beijing Capital International Airport','Singapore Changi Airport','zh','北京首都国际机场'],
    ['伦敦希思罗','北京首都','en','London Heathrow Airport'],
    ['新加坡樟宜机场','北京首都','en','Singapore Changi Airport'],
    ['东京羽田','上海虹桥','en','Tokyo Haneda International Airport']
  ]) {
    const presentation = boardingPresentation(flight({ origin, destination }));
    assert.equal(presentation.language, language);
    assert.equal(presentation.airport, airport);
    assert.equal(presentation.airline, language === 'zh' ? '中国国际航空' : 'Air China');
    assert.equal(/\p{Script=Han}/u.test(presentation.destination), language === 'zh');
  }
  const fromCode = boardingPresentation(flight({ origin:'', originCode:'SFO', destination:'北京首都' }));
  assert.equal(fromCode.language, 'en');
  assert.equal(fromCode.airport, 'San Francisco International Airport');
  assert.equal(fromCode.destination, 'Beijing');
});

test('mainland, Hong Kong, Macau and Taiwan use Chinese; other reference regions use English', () => {
  for (const code of ['PEK','HKG','MFM','TPE']) assert.equal(boardingPresentation(flight({ origin:'', originCode:code })).language, 'zh', code);
  for (const code of ['HND','SIN','LHR','SFO','GRU','SYD','NBO']) assert.equal(boardingPresentation(flight({ origin:'', originCode:code })).language, 'en', code);
});

test('main pass and stub use matching labels and preserve names, dates, cabin and barcode data', () => {
  for (const [origin, language, title, name, from, to] of [['北京首都','zh','登机牌','姓名','北京首都','希思罗'],['伦敦希思罗','en','BOARDING PASS','NAME','London','Beijing']]) {
    const r = flight({ origin, destination:language === 'en' ? '北京首都' : '伦敦希思罗', passenger:'张三' });
    const before = structuredClone(r);
    const dom = new JSDOM(ticketSVG(r), { contentType:'image/svg+xml' });
    const document = dom.window.document;
    assert.equal(document.querySelector('[data-boarding-language]').getAttribute('data-boarding-language'), language);
    assert.match(document.querySelector('[data-boarding-header]').textContent, new RegExp(title));
    for (const side of ['main','stub']) {
      const section = document.querySelector(`[data-boarding-section="${side}"]`);
      assert.equal(section.querySelector('text').textContent, name);
      assert.match(section.textContent, /张三/);
      assert.match(section.textContent, /26MAY/);
      assert.doesNotMatch(section.textContent, /2023/);
    }
    assert.equal(document.querySelector('text[x="35"][y="293"]').textContent, from);
    assert.equal(document.querySelector('text[x="265"][y="293"]').textContent, to);
    assert.equal(document.querySelector('text[x="710"][y="242"]').textContent, 'Y');
    assert.ok(document.querySelector('[data-boarding-code] path'));
    assert.deepEqual(r, before);
    assert.deepEqual(readArchive(archive([r])), [r]);
    dom.window.close();
  }
});

test('unknown or conflicting airports retain supplied names instead of guessing their country', () => {
  for (const [origin, originCode] of [['自填机场',''],['北京首都','SFO'],['Unknown airfield','ZZZ']]) {
    const r = flight({ origin, originCode });
    const presentation = boardingPresentation(r);
    assert.equal(presentation.airport, origin);
    assert.equal(presentation.origin, origin);
    assert.equal(r.origin, origin);
  }
});

test('airline names use verified bilingual aliases without inferring an operator from a flight prefix', () => {
  assert.equal(boardingPresentation(flight({ origin:'伦敦希思罗', airline:'中国国际航空  AIR CHINA' })).airline, 'Air China');
  assert.equal(boardingPresentation(flight({ airline:'Singapore Airlines' })).airline, '新加坡航空');
  assert.equal(boardingPresentation(flight({ origin:'伦敦希思罗', service:'CA937', airline:'新加坡航空' })).airline, 'Singapore Airlines');
  assert.equal(boardingPresentation(flight({ origin:'伦敦希思罗', airline:'自填航司' })).airline, '自填航司');
});
