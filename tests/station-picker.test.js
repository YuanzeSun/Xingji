import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {searchStations,resolvePlace} from '../src/places.js';
import {bindStationPicker} from '../src/station-picker.js';

test('station suggestions match Chinese, pinyin and initials, retain manual input, and keep internal codes out of display',()=>{
  for(const query of ['北京南','北京南站','beijingnan'])assert.equal(searchStations(query)[0].name,'北京南',query);
  assert.ok(searchStations('BJn').some(place=>place.name==='北京南'));assert.ok(searchStations('BJn').some(place=>place.name==='宝鸡南'));
  assert.ok(searchStations('北京').some(place=>place.name==='北京南'));assert.deepEqual(searchStations(''),[]);assert.deepEqual(searchStations('不存在的火车站'),[]);
  const copy=searchStations('北京南')[0];copy.name='changed';assert.equal(searchStations('北京南')[0].name,'北京南');
  const dom=new JSDOM('<label class="field"><span>出发站</span><span class="airport-picker"><input name="origin"><span role="listbox" hidden></span></span></label>');
  const {window}=dom,input=window.document.querySelector('input'),list=window.document.querySelector('[role="listbox"]');let chosen;
  bindStationPicker(input,place=>{chosen=place;input.value=place.name;});input.focus();
  const type=value=>{input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));};
  type('beijingnan');assert.equal(list.hidden,false);assert.match(list.textContent,/北京南/);assert.doesNotMatch(list.textContent,/VNP|Beijingnan/i);
  input.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(input.value,'北京南');assert.equal(list.hidden,true);
  assert.equal(resolvePlace({type:'rail',origin:chosen.name},'origin').status,'matched');
  input.dispatchEvent(new window.Event('compositionstart'));type('nan');assert.equal(list.hidden,true);type('南京南');input.dispatchEvent(new window.Event('compositionend'));assert.equal(list.hidden,false);
  list.querySelector('[role="option"]').click();assert.equal(input.value,'南京南');
  type('自填车站');assert.match(list.textContent,/未找到匹配车站/);assert.equal(input.value,'自填车站');
  dom.window.close();
});
