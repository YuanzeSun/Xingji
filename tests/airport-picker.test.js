import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { AIRPORTS } from '../src/data/location-reference.js';
import { searchAirports, resolvePlace } from '../src/places.js';
import { bindAirportPicker } from '../src/airport-picker.js';

test('every IATA code has one exact suggestion, including lower-case and full-width input', () => {
  for (const [code] of AIRPORTS) assert.deepEqual(searchAirports(code.toLowerCase()).map(place=>place.code), [code]);
  assert.deepEqual(searchAirports(' ｐｅｋ ').map(place=>place.code), ['PEK']);
  assert.equal(searchAirports('SFO')[0].englishName, 'San Francisco International Airport');
  const suggestion = searchAirports('PEK')[0]; suggestion.name = 'changed';
  assert.equal(resolvePlace({ type:'flight', originCode:'PEK' }, 'origin').name, '北京首都');
});

test('suggestions retain Chinese, English, aliases and city lookup without guessing a city identity', () => {
  for (const [query, code] of [['北京','PEK'],['北京','PKX'],['首都国际','PEK'],['新加坡樟宜','SIN'],['Heathrow','LHR'],['臺灣桃園國際機場','TPE']]) assert.ok(searchAirports(query).some(place=>place.code===code), query);
  assert.ok(searchAirports('PE', 20).every(place=>place.code.startsWith('PE')));
  assert.ok(searchAirports('a').length <= 8);
  assert.deepEqual(searchAirports(''), []);
  assert.deepEqual(searchAirports('并不存在的机场名称'), []);
  assert.notEqual(resolvePlace({ type:'flight', origin:'北京' }, 'origin').status, 'matched');
});

function picker() {
  const dom = new JSDOM('<label class="field"><span>出发机场</span><span class="airport-picker"><input name="origin"><span role="listbox" hidden></span></span></label>');
  const { window } = dom, input = window.document.querySelector('input'), list = window.document.querySelector('[role="listbox"]'), chosen = [];
  bindAirportPicker(input, place => { chosen.push(place); input.value = place.code; });
  input.focus();
  const type = value => { input.value = value; input.dispatchEvent(new window.Event('input', { bubbles:true })); };
  const key = value => { const event = new window.KeyboardEvent('keydown', { key:value, bubbles:true, cancelable:true }); input.dispatchEvent(event); return event; };
  return { dom, window, input, list, chosen, type, key };
}

test('airport combobox offers results during typing and accepts explicit keyboard or pointer choices', () => {
  const p = picker();
  p.type('pek');
  assert.equal(p.input.value, 'pek'); assert.equal(p.chosen.length, 0);
  assert.equal(p.input.getAttribute('role'), 'combobox');
  assert.equal(p.input.getAttribute('aria-expanded'), 'true');
  assert.equal(p.list.querySelectorAll('[role="option"]').length, 1);
  assert.match(p.list.textContent, /PEK.*北京首都国际机场/);
  assert.ok(p.key('Enter').defaultPrevented);
  assert.equal(p.chosen[0].code, 'PEK'); assert.equal(p.list.hidden, true);
  p.type('北京');
  p.key('ArrowDown');
  const selected = p.list.querySelector('[aria-selected="true"]');
  assert.equal(p.input.getAttribute('aria-activedescendant'), selected.id);
  p.key('Escape'); assert.equal(p.list.hidden, true);
  p.type('sfo');
  p.list.querySelector('[role="option"]').click();
  assert.equal(p.chosen.at(-1).code, 'SFO'); assert.equal(p.list.hidden, true);
  p.type(''); p.key('ArrowUp');
  assert.equal(p.list.hidden, true); assert.equal(p.input.getAttribute('aria-activedescendant'), null);
  p.dom.window.close();
});

test('composition, unknown inputs and dismissal preserve manual entry', () => {
  const p = picker();
  p.window.document.body.addEventListener('keydown', event => assert.notEqual(event.key, 'Escape'));
  p.input.dispatchEvent(new p.window.Event('compositionstart'));
  p.type('pe'); assert.equal(p.list.hidden, true);
  p.type('PEK'); p.input.dispatchEvent(new p.window.Event('compositionend'));
  assert.equal(p.list.hidden, false);
  assert.ok(p.key('Escape').defaultPrevented);
  p.type('自填机场');
  assert.match(p.list.textContent, /未找到匹配机场/);
  assert.equal(p.list.querySelector('[role="option"]'), null);
  assert.equal(p.input.value, '自填机场'); assert.equal(p.chosen.length, 0);
  p.input.blur(); assert.equal(p.list.hidden, true);
  p.dom.window.close();
});
