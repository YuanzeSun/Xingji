import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { STATIONS, AIRPORTS } from '../src/data/location-reference.js';
import { AIRPORT_LABELS } from '../src/data/airport-labels.js';
import { resolvePlace, railwayStop } from '../src/places.js';
import { resolveCity } from '../src/locations.js';
import { createRecord, archive, readArchive, deduplicateRecords } from '../src/model.js';
import { ticketSVG } from '../src/tickets.js';

test('every reference station resolves by name and telecode, independently of initials', () => {
  for (const [name, city, code, pinyin] of STATIONS) {
    for (const values of [{ origin:name }, { originCode:code }, { origin:code.toLowerCase() }]) {
      const record = { type:'rail', ...values };
      assert.equal(resolvePlace(record,'origin').code, code, name);
      assert.equal(resolveCity(record,'origin').city, city, name);
      assert.equal(railwayStop(record,'origin').pinyin.toLowerCase(), pinyin.toLowerCase(), name);
    }
  }
  assert.equal(resolvePlace({ type:'rail', originCode:'ＢＪＰ' },'origin').name, '北京');
  assert.equal(resolvePlace({ type:'rail', origin:'fuzhou' },'origin').status, 'ambiguous');
  const fuzhou = STATIONS.find(row=>row[0]==='福州');
  assert.equal(resolvePlace({ type:'rail', origin:'fuzhou', originCode:fuzhou[2] },'origin').name, '福州');
  assert.equal(railwayStop({ type:'rail', origin:'北京南站' },'origin').name, '北京南站');
  assert.equal(railwayStop({ type:'rail', origin:'四站' },'origin').name, '四站');
});

test('all reference airport codes and their English names remain unambiguous with an explicit code', () => {
  for (const [code,,,english] of AIRPORTS) {
    for (const values of [{ originCode:code.toLowerCase() }, { origin:english, originCode:code }]) {
      const place = resolvePlace({ type:'flight', ...values },'origin');
      assert.equal(place.status, 'matched', code);
      assert.equal(place.code, code);
      assert.ok(place.fullName, code);
    }
  }
  assert.equal(resolvePlace({ type:'flight', originCode:'ｐｅｋ' },'origin').name, '北京首都');
  assert.equal(resolvePlace({ type:'flight', origin:'北京首都', originCode:'PKX' },'origin').status, 'conflict');
});

test('localized aliases support mainland and international airports without treating a city as an airport', () => {
  assert.ok(AIRPORT_LABELS.length > 4000);
  for (const [origin, code] of [['昆明长水','KMG'],['武汉天河','WUH'],['巴中恩阳','BZX'],['毕节飞雄','BFJ'],['香港国际机场','HKG'],['臺灣桃園國際機場','TPE'],['新加坡樟宜','SIN'],['伦敦希思罗','LHR'],['旧金山国际机场','SFO'],['旧金山国际機場','SFO']]) {
    assert.equal(resolvePlace({ type:'flight', origin },'origin').code, code, origin);
  }
  for (const origin of ['北京','纽约','旧金山','巴黎','伦敦','圣萨尔瓦多']) assert.notEqual(resolvePlace({ type:'flight', origin },'origin').status, 'matched', origin);
  const gru = AIRPORTS.find(row=>row[0]==='GRU');
  const unaccented = gru[3].normalize('NFKD').replace(/\p{M}/gu,'');
  assert.equal(resolvePlace({ type:'flight', origin:unaccented },'origin').code, 'GRU');
});

test('long international airport headers keep the complete name across bounded, readable lines', () => {
  const longest = [...AIRPORTS].sort((a,b)=>b[3].length-a[3].length).slice(0,8);
  for (const [code,,,name] of [...longest, AIRPORTS.find(row=>row[0]==='ELU')]) {
    const r = createRecord({ type:'flight', template:'air-boarding-pass', origin:name, originCode:code, destination:'北京首都', destinationCode:'PEK' });
    const before = structuredClone(r);
    const dom = new JSDOM(ticketSVG(r), { contentType:'image/svg+xml' });
    const document = dom.window.document;
    for (const [side,maxLines] of [['main',2],['stub',3]]) {
      const group = document.querySelector(`[data-airport-heading="${side}"]`);
      assert.equal(group.getAttribute('aria-label'), name);
      assert.equal(group.textContent.replace(/\s+/g,' ').trim(), name.replace(/\s+/g,' ').trim());
      assert.ok(group.querySelectorAll('text').length <= maxLines, code);
      assert.ok([...group.querySelectorAll('text')].every(text=>Number(text.getAttribute('font-size'))>=10), code);
    }
    assert.deepEqual(r,before);
    dom.window.close();
  }
});

test('Chinese airport inputs retain their stored language while overseas departures render in English', () => {
  for (const [origin, code] of [['新加坡樟宜机场','SIN'],['新加坡樟宜機場','SIN'],['伦敦希思罗','LHR'],['旧金山国际机场','SFO'],['圣保罗/瓜鲁柳斯－安德烈·弗朗哥·蒙托罗州长国际机场','GRU']]) {
    const r = createRecord({ type:'flight', template:'air-boarding-pass', origin, destination:'新加坡樟宜机场', passenger:'张三', airline:'中国国际航空', departureDate:'2023-05-26', service:'CA1501' });
    assert.equal(r.origin, origin);
    assert.equal(r.originCode, code);
    assert.equal(r.destination, '新加坡樟宜机场');
    assert.equal(r.destinationCode, 'SIN');
    assert.deepEqual(readArchive(archive([r])), [r]);
    const english = AIRPORTS.find(row=>row[0]===code)[3];
    assert.equal(deduplicateRecords([r,createRecord({ ...r, id:'english-alias', origin:english })]).length, 1);
    const dom = new JSDOM(ticketSVG(r), { contentType:'image/svg+xml' });
    const document = dom.window.document;
    const header = document.querySelector('[data-airport-heading="main"]');
    assert.equal(header.getAttribute('aria-label'), english);
    const main = document.querySelector('[data-boarding-section="main"]');
    const routeText = [...main.querySelectorAll('text')].filter(t=>['281','293','302'].includes(t.getAttribute('y'))).map(t=>t.textContent).join('');
    assert.doesNotMatch(routeText, /\p{Script=Han}/u);
    assert.match(routeText, /Singapore/);
    for (const side of ['main','stub']) assert.match(document.querySelector(`[data-boarding-section="${side}"]`).textContent, /张三/);
    assert.match(document.querySelector('[data-boarding-header]').textContent, /Air China/);
    dom.window.close();
  }
});

test('long domestic station names and automatic pinyin use smaller type instead of stretching glyphs', () => {
  for (const template of ['rail-blue','rail-receipt','rail-red','rail-red-classic']) {
    const r = createRecord({ template, origin:'郑州航空港', destination:'中川机场东', service:'G1' });
    const dom = new JSDOM(ticketSVG(r), { contentType:'image/svg+xml' });
    const document = dom.window.document;
    assert.match(document.documentElement.textContent,/Zhengzhouhangkonggang/);
    assert.match(document.documentElement.textContent,/Zhongchuanjichangdong/);
    assert.equal(document.querySelector('[lengthAdjust="spacingAndGlyphs"]'), null);
    const origin = [...document.querySelectorAll('text')].find(text=>text.textContent==='郑州航空港');
    assert.ok(Number(origin.getAttribute('font-size'))<54);
    dom.window.close();
  }
});
