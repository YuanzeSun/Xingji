import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { ticketSVG } from '../src/tickets.js';
import { layoutFontFiles } from '../src/ticket-layouts.js';
import { PINYIN_ADVANCES, PINYIN_TRACKING } from '../src/data/rail-pinyin-metrics.js';
test('station pinyin has independent embedded metrics and fits long names without stretching glyphs or sale-code text',()=>{
 for(const template of ['rail-red-classic','rail-red','rail-blue','rail-receipt','rail-refund-receipt']){
  const r=createRecord({template,origin:'柳州',destination:'来宾北',originCode:'Liuzhou',destinationCode:'Laibinbei'});
  const dom=new JSDOM(ticketSVG(r),{contentType:'image/svg+xml'}),labels=[...dom.window.document.querySelectorAll('[data-rail-pinyin]')];
  assert.equal(labels.length,2);
  for(const label of labels){assert.match(label.getAttribute('font-family'),/^TicketRailPinyin,/);assert.equal(label.getAttribute('textLength'),null);const size=+label.getAttribute('font-size'),spacing=+label.getAttribute('letter-spacing');assert.ok(Math.abs(spacing-size*PINYIN_TRACKING)<1e-8);}
  assert.ok(layoutFontFiles(template).some(([name,file])=>name==='TicketRailPinyin'&&file==='ticket-rail-pinyin.woff2'));
  assert.ok(layoutFontFiles(template).some(([name])=>name==='TicketRailNarrow'));
  dom.window.close();
 }
 assert.ok(PINYIN_ADVANCES.i<PINYIN_ADVANCES.m);
 assert.equal(layoutFontFiles('air-boarding-pass').some(([name])=>name==='TicketRailPinyin'),false);
});
