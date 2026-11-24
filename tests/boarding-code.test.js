import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { normalizeBoardingCode, renderBoardingCode } from '../src/boarding-code.js';
import { ticketCodeEditor, bindTicketCodeEditor } from '../src/code-editor.js';
import { createRecord, archive, readArchive, applyImport, mergeThreeWay } from '../src/model.js';
import { ticketSVG, exportSVG } from '../src/tickets.js';
import { DEMO_BOARDING_CODE as code } from '../src/demo-boarding-code.js';
const flight = extra => createRecord({ id: 'flight-code', type: 'flight', template: 'air-boarding-pass', origin: '北京首都', destination: '东京羽田', service: 'CA181', departureDate: '2025-01-01', boardingCodeSource: 'original', boardingLegIndex: '0', ...extra });

test('archived boarding codes require their source and leg index', () => {
  const current = archive([flight({ boardingCode: code })]);
  for (const [field, error] of [['boardingCodeSource', /条码来源/], ['boardingLegIndex', /条码航段/]]) {
    const record = { ...current.records[0] };
    delete record[field];
    assert.throws(() => readArchive({ ...current, records: [record] }), error);
  }
});
const png = (width, height) => 'data:image/png;base64,' + new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/></svg>`).render().asPng().toString('base64');
test('flight codes accept payload data and reject all stored images', () => {
  assert.deepEqual(normalizeBoardingCode(code), code);
  for (const value of ['https://example.com/code.png', 'data:image/svg+xml,<svg/>', png(120,120), {}, {...code,rawBytes:'bad'}]) assert.throws(() => normalizeBoardingCode(value), /条码/);
});
test('original boarding codes render without stretching and survive import, backup, sync and deletion', async () => {
  const record=flight({ boardingCode:code,lockedFields:['boardingCode'] }); const dom=new JSDOM(ticketSVG(record),{contentType:'image/svg+xml'});
  const image=dom.window.document.querySelector('svg[data-boarding-code]');assert.ok(image.querySelector('path'));assert.equal(image.querySelector('image'),null);assert.match(image.getAttribute('preserveAspectRatio'),/meet/);assert.ok(Number(image.getAttribute('width')) > Number(image.getAttribute('height')));dom.window.close();
  assert.deepEqual(readArchive(archive([record]))[0].boardingCode,code);
  assert.deepEqual(applyImport([flight()],[record]).records[0].boardingCode,code);
  const merged=mergeThreeWay([flight()],[record],[flight({seat:'24K'})]);assert.deepEqual(merged.records[0].boardingCode,code);assert.equal(merged.records[0].seat,'24K');
  assert.equal(createRecord({...record,deleted:true}).boardingCode,'');
  globalThis.location={href:'https://example.com/'};globalThis.fetch=async()=>new Response('font fixture');assert.ok((await exportSVG(record)).includes('data-boarding-code'));
});

test('boarding codes render as transparent vectors with black ink', () => {
  const markup=renderBoardingCode(flight({boardingCode:code}),0,0,400,100);
  assert.match(markup, /fill="#000"/); assert.doesNotMatch(markup,/<rect|background|image|data:image/);
  const transparent = new Resvg(markup).render(); assert.equal(transparent.pixels[3], 0);
  const paper = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100"><rect width="400" height="100" fill="#a5cbd2"/>${markup}</svg>`).render();
  assert.deepEqual([...paper.pixels.slice(0,4)], [165,203,210,255]);
});
test('flight code editor reads and rebuilds the barcode without manual crop controls', async () => {
  const draft = flight(), dom = new JSDOM(`<form>${ticketCodeEditor(draft)}</form>`), form = dom.window.document.querySelector('form');
  let changes = 0;
  const dispose = bindTicketCodeEditor(form, draft, () => changes++, { loadRebuilder: async () => async (file, type) => { assert.equal(type, 'flight'); return { codes: [{ format: 'PDF417', data: code, verified: true }], issues: [] }; } });
  Object.defineProperty(form.querySelector('#code-photo'), 'files', { value: [{}] }); form.querySelector('#code-photo').dispatchEvent(new dom.window.Event('change')); await new Promise(r => setTimeout(r, 0));
  assert.equal(form.querySelector('canvas'), null); assert.equal(form.querySelector('[type="range"]'), null);
  assert.deepEqual(draft.boardingCode, code); assert.equal(changes, 1); assert.match(form.querySelector('#code-status').textContent, /PDF417/);
  form.querySelector('#code-remove').click(); assert.equal(draft.boardingCode, ''); dispose(); dom.window.close();
});
