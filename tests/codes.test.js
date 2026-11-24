import { MAX_CODE_BYTES } from '../src/barcode-data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { createRecord, archive, readArchive, applyImport, mergeThreeWay } from '../src/model.js';
import { ticketSVG, exportSVG, exportPNG } from '../src/tickets.js';
import { normalizeTicketCode } from '../src/ticket-code.js';
import { ticketCodeEditor, bindTicketCodeEditor } from '../src/code-editor.js';
import { DEMO_TICKET_CODE as code } from '../src/demo-code.js';

const sample = (values = {}) => createRecord({ id: 'code-test', origin: '北京南', destination: '天津', service: 'C2021', departureDate: '2017-09-10', ...values });
const png = (width = 16, height = width) => 'data:image/png;base64,' + new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/></svg>`).render().asPng().toString('base64');

test('ticket codes accept only bounded payload data and reject images, matrices and malformed parameters', () => {
  assert.equal(sample().ticketCode, ''); assert.deepEqual(normalizeTicketCode(code), code);
  for (const value of ['https://example.com/code.png', png(), {modules:'AA=='}, {...code, rawBytes:'bad'}, {...code, rawBytes:'A'.repeat(MAX_CODE_BYTES*2)}, {...code, parameters:{mask:9}}, {...code, eci:[{offset:-1,value:26}]}]) assert.throws(() => sample({ ticketCode:value }), /条码/);
  const oldArchive = { ...archive([]), records: [{ ...sample(), ticketCode: png() }] };
  assert.throws(() => readArchive(oldArchive), /条码/);
  assert.doesNotMatch(JSON.stringify(archive([sample({ticketCode:code})])), /data:image|modules|pixels|<svg/);
});

test('rail codes appear in the lower-right region and are embedded in standalone SVG and PNG exports', async () => {
  for (const template of ['rail-blue', 'rail-receipt', 'rail-red', 'rail-red-classic']) {
    const record = sample({ template, ticketCode: code });
    const dom = new JSDOM(ticketSVG(record), { contentType: 'image/svg+xml' });
    const img = dom.window.document.querySelector('svg[data-ticket-code]');
    assert.ok(img.querySelector('path')); assert.equal(img.querySelector('image'), null); assert.equal(img.querySelector('rect'), null); assert.ok(Number(img.getAttribute('x')) > 600); assert.ok(Number(img.getAttribute('y')) >= 335);
    assert.doesNotMatch(ticketSVG(record), /票码未收录/); dom.window.close();
    assert.doesNotMatch(ticketSVG(sample({ template })), /票码未收录|data-ticket-code/);
  }
  assert.doesNotMatch(ticketSVG(sample({ type: 'flight', template: 'air-boarding-pass', ticketCode: code })), /data-ticket-code/);
  globalThis.location = { href: 'https://example.com/' }; globalThis.fetch = async () => new Response('font fixture');
  assert.ok((await exportSVG(sample({ ticketCode: code }))).includes('data-ticket-code'));
  const oldImage = globalThis.Image, oldDocument = globalThis.document, oldCreate = URL.createObjectURL, oldRevoke = URL.revokeObjectURL;
  let exported;
  try {
    URL.createObjectURL = blob => { exported = blob; return 'blob:test'; }; URL.revokeObjectURL = () => {};
    globalThis.Image = class { async decode() {} };
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }), toBlob: fn => fn(new Blob(['png'], { type: 'image/png' })) }) };
    assert.equal((await exportPNG(sample({ ticketCode: code }))).type, 'image/png');
    assert.ok((await exported.text()).includes('data-ticket-code'));
  } finally { globalThis.Image = oldImage; globalThis.document = oldDocument; URL.createObjectURL = oldCreate; URL.revokeObjectURL = oldRevoke; }
});

test('backup, import locks and three-way sync preserve complete code data', () => {
  const record = sample({ ticketCode: code, lockedFields: ['ticketCode'] });
  assert.deepEqual(readArchive(JSON.parse(JSON.stringify(archive([record])))), [record]);
  const empty = sample();
  assert.deepEqual(applyImport([empty], [record]).records[0].ticketCode, code);
  assert.equal(applyImport([{ ...empty, lockedFields: ['ticketCode'] }], [record]).records[0].ticketCode, '');
  const independent = mergeThreeWay([empty], [record], [{ ...empty, issuer: '北京南站' }]);
  assert.equal(independent.conflicts.length, 0); assert.deepEqual(independent.records[0].ticketCode, code); assert.equal(independent.records[0].issuer, '北京南站');
  const conflict = mergeThreeWay([empty], [record], [{ ...empty, ticketCode: {...code,rawBytes:btoa('OTHER PAYLOAD')} }]);
  assert.deepEqual(conflict.conflicts.map(c => c.field), ['ticketCode']);
});

test('code editor rebuilds automatically, blocks pending saves and preserves existing codes on failure', async () => {
  const record = sample(), dom = new JSDOM(`<form>${ticketCodeEditor(record)}</form>`), form = dom.window.document.querySelector('form');
  let changed = 0, finish;
  const dispose = bindTicketCodeEditor(form, record, () => changed++, { loadRebuilder: async () => () => new Promise(resolve => { finish = resolve; }) });
  const choose = async () => { Object.defineProperty(form.querySelector('#code-photo'), 'files', { value: [{}], configurable: true }); form.querySelector('#code-photo').dispatchEvent(new dom.window.Event('change')); await new Promise(r => setTimeout(r, 0)); };
  await choose();
  assert.equal(form.querySelector('#code-cropper'), null); assert.equal(form.querySelector('[type="range"]:not([data-code-zoom-slider])'), null);
  const blocked = new dom.window.Event('submit', { bubbles: true, cancelable: true }); form.dispatchEvent(blocked); assert.equal(blocked.defaultPrevented, true);
  finish({ codes: [{ format: 'QRCode', data: code, verified: true }], issues: [] }); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(record.ticketCode, code); assert.equal(changed, 1); assert.match(form.querySelector('#code-status').textContent, /重新编码后信息已核对/);
  await choose(); finish({ codes: [], issues: ['未能确认原码格'] }); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(record.ticketCode, code); assert.match(form.querySelector('#code-error').textContent, /原码格/);
  await choose(); const late = finish; dispose(); late({ codes: [{ format: 'QRCode', data: code, verified: true }], issues: [] }); await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(record.ticketCode, code); assert.equal(changed, 1); dom.window.close();
});

test('multiple detected codes require a choice before the draft changes', async () => {
  const record = sample(), dom = new JSDOM(`<form>${ticketCodeEditor(record)}</form>`), form = dom.window.document.querySelector('form'), other = {...code,rawBytes:btoa('OTHER PAYLOAD')};
  const dispose = bindTicketCodeEditor(form, record, () => {}, { loadRebuilder: async () => async () => ({ codes: [{ format: 'QRCode', data: code, verified: true }, { format: 'QRCode', data: other, verified: true }], issues: [] }) });
  Object.defineProperty(form.querySelector('#code-photo'), 'files', { value: [{}] }); form.querySelector('#code-photo').dispatchEvent(new dom.window.Event('change')); await new Promise(r => setTimeout(r, 0));
  assert.equal(record.ticketCode, ''); assert.equal(form.querySelectorAll('.code-choice').length, 2);
  const blocked = new dom.window.Event('submit', { bubbles: true, cancelable: true }); form.dispatchEvent(blocked); assert.equal(blocked.defaultPrevented, true);
  form.querySelectorAll('.code-choice')[1].click(); assert.deepEqual(record.ticketCode, other);
  form.querySelector('#code-remove').click(); assert.equal(record.ticketCode, ''); dispose(); dom.window.close();
});

test('a single verified QR from the rail photo is attached even when it contains a URL', { timeout: 3000 }, async t => {
  const record = sample(), dom = new JSDOM();
  t.after(() => dom.window.close());
  const domainCode = { ...code, rawBytes: btoa('https://example.invalid/t') };
  let reads = 0;
  const options = {
    referenceURL: 'data:image/png;base64,AA==', autoRead: true,
    loadRebuilder: async () => async () => {
      reads++;
      return { codes: [{ format: 'QRCode', data: domainCode, verified: true, isLink: true }], issues: [] };
    }
  };
  const bind = changed => {
    dom.window.document.body.innerHTML = `<form>${ticketCodeEditor(record, { fromScan: true })}</form>`;
    const form = dom.window.document.querySelector('form');
    return { form, dispose: bindTicketCodeEditor(form, record, changed, options) };
  };
  let resolve;
  const codeAdded = new Promise(done => { resolve = done; });
  const { form, dispose } = bind(resolve);
  await codeAdded;
  assert.deepEqual(record.ticketCode, domainCode);
  assert.equal(record.fieldSources.ticketCode, 'barcode');
  assert.equal(form.querySelector('#code-use-scan').hidden, true);
  assert.equal(form.querySelector('#code-choices').hidden, true);

  form.querySelector('#code-remove').click();
  dispose();
  const reopened = bind(() => assert.fail('Removed codes must stay removed'));
  t.after(reopened.dispose);
  await new Promise(done => setImmediate(done));
  assert.equal(record.ticketCode, '');
  assert.equal(reads, 1);
});
