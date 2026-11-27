import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { suggestAirlines, bindAirlinePicker } from '../src/reference-suggestions.js';

test('airline suggestions include Chinese names, aliases, international names, IATA and ICAO codes', () => {
  for (const query of ['MU', 'CES', '东航', 'China Eastern']) assert.ok(suggestAirlines(query).some(row => row.name === '中国东方航空'), query);
  assert.equal(suggestAirlines('MU')[0].name, '中国东方航空');
  assert.ok(suggestAirlines('ANA').some(row => /全日本|全日空/.test(row.name)));
  assert.ok(suggestAirlines('阿联酋').some(row => /阿联酋/.test(row.name)));
  assert.deepEqual(suggestAirlines('没有这家航空公司'), []);
});

test('airline popup supports keyboard and pointer selection while retaining custom input', () => {
  const dom = new JSDOM('<label class="field"><span>航司</span><span class="airport-picker"><input name="airline"/><span role="listbox" hidden></span></span></label>');
  const airline = dom.window.document.querySelector('input');
  bindAirlinePicker(airline);
  airline.focus(); airline.value = 'MU'; airline.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(airline.getAttribute('aria-expanded'), 'true');
  airline.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(airline.value, '中国东方航空');
  airline.value = 'CA'; airline.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  airline.closest('.airport-picker').querySelector('[role="option"]').click(); assert.equal(airline.value, '中国国际航空');
  airline.value = '自己的名称'; airline.dispatchEvent(new dom.window.Event('input', { bubbles: true })); airline.blur(); assert.equal(airline.value, '自己的名称');
  dom.window.close();
});
