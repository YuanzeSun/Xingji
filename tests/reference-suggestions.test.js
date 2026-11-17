import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { suggestCities, suggestAirlines, bindReferenceFields } from '../src/reference-suggestions.js';

test('city suggestions recognize Chinese, pinyin, initials, airport codes and manually recorded cities', () => {
  for (const query of ['北京', 'beijing', 'bj', 'PEK']) assert.ok(suggestCities(query).some(row => row.name === '北京'), query);
  assert.ok(suggestCities('sjz').some(row => row.name === '石家庄'));
  assert.ok(suggestCities('New York').some(row => row.name === '纽约'));
  assert.equal(suggestCities('私人小城', [{ originCity: '私人小城' }])[0].name, '私人小城');
  assert.deepEqual(suggestCities(''), []); assert.ok(suggestCities('a').length <= 8);
});

test('airline suggestions include Chinese names, aliases, international names, IATA and ICAO codes', () => {
  for (const query of ['MU', 'CES', '东航', 'China Eastern']) assert.ok(suggestAirlines(query).some(row => row.name === '中国东方航空'), query);
  assert.equal(suggestAirlines('MU')[0].name, '中国东方航空');
  assert.ok(suggestAirlines('ANA').some(row => /全日本|全日空/.test(row.name)));
  assert.ok(suggestAirlines('阿联酋').some(row => /阿联酋/.test(row.name)));
  assert.deepEqual(suggestAirlines('没有这家航空公司'), []);
});

test('city and airline popup supports keyboard and pointer selection while retaining custom input', () => {
  const dom = new JSDOM('<form><label class="field"><span>城市</span><span class="airport-picker"><input name="originCity"/><span role="listbox" hidden></span></span></label><label class="field"><span>航司</span><span class="airport-picker"><input name="airline"/><span role="listbox" hidden></span></span></label></form>');
  const form = dom.window.document.querySelector('form'); bindReferenceFields(form, []);
  const city = form.elements.originCity; city.focus(); city.value = 'beijing'; city.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(city.getAttribute('aria-expanded'), 'true'); city.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); assert.equal(city.value, '北京');
  const airline = form.elements.airline; airline.focus(); airline.value = 'MU'; airline.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  form.querySelector('[name="airline"]').closest('.airport-picker').querySelector('[role="option"]').click(); assert.equal(airline.value, '中国东方航空');
  airline.value = '自己的名称'; airline.dispatchEvent(new dom.window.Event('input', { bubbles: true })); airline.blur(); assert.equal(airline.value, '自己的名称');
  dom.window.close();
});
