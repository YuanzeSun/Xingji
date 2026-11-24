import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { ticketSVG, ticketDimensions, exportPNG } from '../src/tickets.js';
import { layoutFontFiles } from '../src/ticket-layouts.js';
import { DEMO_RAIL_LINEAR_CODE, DEMO_TICKET_CODE } from '../src/demo-code.js';
import { codeSize } from '../src/barcode-data.js';

const record = (template, extra = {}) => createRecord({ id: 'layout-test', type: template.startsWith('air-') ? 'flight' : 'rail', template, origin: '北京南', destination: '天津', originCode: 'Beijingnan', destinationCode: 'Tianjin', service: 'C2021', departureDate: '2017-09-10', departureTime: '10:35', identity: '110101199001011234', passenger: '示例旅客', seat: '02A', carriage: '01', price: '57.0', ...extra });
test('airline layout has its own long boarding-pass aspect ratio and side stub', () => {
  const r = record('air-boarding-pass');
  const dimensions = ticketDimensions(r);
  assert.ok(dimensions.width / dimensions.height > 2.4);
  const svg = ticketSVG(r);
  assert.match(svg, /viewBox="0 0 1230 500"/);
  assert.match(svg, /data-boarding-section="stub"/);
  assert.match(svg, /登机牌/);
});
test('red stock and blue magnetic stock have independent dimensions', () => {
  assert.deepEqual(ticketDimensions(record('rail-red-classic')), { width: 900, height: 600 });
  assert.deepEqual(ticketDimensions(record('rail-red')), { width: 900, height: 600 });
  assert.deepEqual(ticketDimensions(record('rail-blue')), { width: 856, height: 540 });
});

test('boarding passes emphasize the departure airport and print bare booking codes and dates without years', () => {
  for (const [departureDate, printedDate] of [['2023-05-26', '26MAY'], ['2023', '—']]) {
    const r = record('air-boarding-pass', { origin:'北京首都', destination:'上海虹桥', originCode:'PEK', destinationCode:'SHA', service:'CA1501', airline:'中国国际航空', departureDate, seatClass:'Y舱' });
    const dom = new JSDOM(ticketSVG(r), { contentType:'image/svg+xml' });
    const document = dom.window.document;
    const header = document.querySelector('[data-boarding-header]');
    const headings = [...header.querySelectorAll('text')];
    assert.equal(headings[0].textContent, '北京首都国际机场');
    assert.equal(headings[3].textContent, '北京首都国际机场');
    assert.ok(!header.textContent.includes('PEK'));
    assert.equal(headings[1].textContent, '中国国际航空');
    assert.ok(Number(headings[0].getAttribute('font-size')) > Number(headings[1].getAttribute('font-size')));
    for (const side of ['main','stub']) {
      const content = document.querySelector(`[data-boarding-section="${side}"]`).textContent;
      assert.ok(content.includes(printedDate));
      assert.ok(!content.includes('2023'));
    }
    const cabin = document.querySelector('text[x="710"][y="242"]');
    assert.equal(cabin.textContent, 'Y');
    assert.equal(calendarDate(r.departureDate), departureDate);
    dom.window.close();
  }
});

test('boarding headers resolve full airport names without inventing suffixes for manual names', () => {
  for (const [origin, originCode, fullName] of [
    ['上海虹桥','SHA','上海虹桥国际机场'],
    ['广州白云','CAN','广州白云国际机场'],
    ['','PEK','北京首都国际机场'],
    ['自填机场','','自填机场'],
    ['', 'SFO', 'San Francisco International Airport']
  ]) {
    const r = record('air-boarding-pass', { origin, originCode, destination:'上海浦东', destinationCode:'PVG', service:'CA1501' });
    const dom = new JSDOM(ticketSVG(r), { contentType:'image/svg+xml' });
    const heading = dom.window.document.querySelector('[data-boarding-header] text');
    assert.equal(heading.textContent, fullName);
    dom.window.close();
  }
});
test('2015 rail layout aligns identity and name, uses smaller station suffix and a notice block', () => {
  const svg = ticketSVG(record('rail-blue'));
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  const texts = [...dom.window.document.querySelectorAll('text')];
  const identity = texts.find(t => t.textContent === '1101011990****1234');
  const passenger = texts.find(t => t.textContent === '示例旅客');
  assert.equal(identity.getAttribute('y'), passenger.getAttribute('y'));
  assert.ok(Number(passenger.getAttribute('x')) > Number(identity.getAttribute('x')));
  assert.ok(texts.some(t => t.textContent === '站' && Number(t.getAttribute('font-size')) < 40));
  assert.ok(dom.window.document.querySelector('rect[stroke-dasharray]'));
  dom.window.close();
});
test('old red and new reimbursement layouts preserve their distinct label placement', () => {
  const classic = ticketSVG(record('rail-red-classic', { issuer: '西安', gate: '2' }));
  assert.match(classic, /TicketRailHei/);
  assert.doesNotMatch(classic, /买票请到12306/);
  const receipt = ticketSVG(record('rail-receipt'));
  assert.match(receipt, /仅供报销使用/);
  assert.match(receipt, /退票改签时须交回车站/);
  assert.doesNotMatch(receipt, /fill="#c45766"[^>]*>报销凭证/);
  assert.doesNotMatch(receipt, /ARCHIVE/);
});
test('paper receipts only print the issuing station on an explicit opt-in', () => {
  for (const template of ['rail-receipt', 'rail-refund-receipt']) {
    const values = { issuer: '无锡', saleCode: '30497000000910X000002' };
    for (const flag of [undefined, false, 'true']) {
      const hidden = record(template, { ...values, railShowIssuer: flag });
      assert.equal(Object.hasOwn(hidden, 'railShowIssuer'), false);
      assert.equal(hidden.issuer, '无锡');
      assert.match(ticketSVG(hidden), /30497000000910X000002/);
      assert.doesNotMatch(ticketSVG(hidden), /无锡站售/);
    }
    assert.match(ticketSVG(record(template, { ...values, railShowIssuer: true })), /无锡站售/);
  }
  const magnetic = record('rail-blue', { issuer: '无锡', railShowIssuer: true });
  assert.equal(Object.hasOwn(magnetic, 'railShowIssuer'), false);
  assert.match(ticketSVG(magnetic), /无锡站售/);
});
test('anonymous red versions use the old stock without printing personal details', () => {
  const values = { issuer: '北京南', ticketCode: DEMO_TICKET_CODE };
  const linear = ticketSVG(record('rail-red-barcode', values));
  const qr = ticketSVG(record('rail-red-qr', values));
  for (const svg of [linear, qr]) {
    assert.match(svg, /viewBox="0 0 900 600"/);
    assert.doesNotMatch(svg, /示例旅客|\*\*\*\*1234|买票请到12306/);
    assert.match(svg, />售<\/text>/);
  }
  assert.doesNotMatch(linear, /data-ticket-code/);
  assert.match(qr, /data-ticket-code/);
  const saleCode = '10000000000000X0000100000000000000000000000';
  const original = ticketSVG(record('rail-red-barcode', { ticketCode: DEMO_RAIL_LINEAR_CODE, saleCode }));
  assert.match(original, /data-ticket-code="reencoded"[^>]*width="811"[^>]*preserveAspectRatio="none"[^>]*aria-label="Code128/);
  const dom = new JSDOM(original, { contentType: 'image/svg+xml' });
  const barcode = dom.window.document.querySelector('[data-ticket-code]');
  const caption = [...dom.window.document.querySelectorAll('text')].find(node => node.textContent === saleCode);
  const { width, quiet } = codeSize(DEMO_RAIL_LINEAR_CODE);
  const barcodeWidth = Number(barcode.getAttribute('width'));
  const quietWidth = quiet * barcodeWidth / width;
  assert.equal(Number(caption.getAttribute('x')), Number(barcode.getAttribute('x')) + quietWidth);
  assert.equal(Number(caption.getAttribute('textLength')), barcodeWidth - quietWidth * 2);
  assert.equal(caption.getAttribute('lengthAdjust'), 'spacing');
  dom.window.close();
  assert.doesNotMatch(ticketSVG(record('rail-red-qr', { ticketCode: DEMO_RAIL_LINEAR_CODE })), /data-ticket-code/);
});
test('the mobile supplement prints date and charges in their own rows', () => {
  const svg = ticketSVG(record('rail-supplement', {
    issuer:'沈阳客运段', railSupplementReason:'越站', railSupplementFee:'5.0', railSupplementSurcharge:'0.0', ticketCode:DEMO_TICKET_CODE
  }));
  assert.match(svg, /viewBox="0 0 900 600"/);
  assert.match(svg, /中途下车失效/);
  assert.match(svg, /事由:越站/);
  assert.match(svg, /含手续费:5\.0元　加收:0\.0元/);
  assert.match(svg, /沈阳客运段补/);
  assert.doesNotMatch(svg, /10:35|data-rail-pinyin|买票请到12306/);
});
test('every ticket text face is embedded for standalone export, including receipt station names', () => {
  for (const template of ['rail-red-classic', 'rail-red', 'rail-blue', 'rail-receipt', 'air-boarding-pass']) {
    const dom = new JSDOM(ticketSVG(record(template, { ticketMarks: [{ text: '孩', shape: 'plain' }] })), { contentType: 'image/svg+xml' });
    const embedded = new Set(layoutFontFiles(template).map(([family]) => family));
    for (const node of dom.window.document.querySelectorAll('[font-family]')) {
      const family = node.getAttribute('font-family').split(',')[0];
      assert.ok(embedded.has(family), `${template}: missing ${family} in standalone export`);
    }
    dom.window.close();
  }
});
test('carriage and seat digits use the date face at the same printed height, with seat letters separate', () => {
  for (const template of ['rail-red-classic', 'rail-red', 'rail-blue', 'rail-receipt']) {
    const dom = new JSDOM(ticketSVG(record(template)), { contentType: 'image/svg+xml' });
    const doc = dom.window.document;
    const date = doc.querySelector('[data-rail-departure] text');
    const seatParts = [...doc.querySelectorAll('[data-rail-seat] text')];
    const digits = seatParts.filter(node => /^\d+$/.test(node.textContent));
    assert.deepEqual(digits.map(node => node.textContent), ['01', '02']);
    for (const node of digits) {
      assert.equal(node.getAttribute('font-family'), date.getAttribute('font-family'));
      const scale = template === 'rail-receipt' ? .92 : 1;
      assert.ok(Math.abs(Number(node.getAttribute('font-size')) - Number(date.getAttribute('font-size')) * scale) < .001);
    }
    assert.equal(seatParts.find(node => node.textContent === 'A').getAttribute('font-family').split(',')[0], 'TicketOCR');
    dom.window.close();
  }
});
test('all refined layouts escape content and keep literal price precision', () => {
  for (const template of ['rail-red-classic', 'rail-red', 'rail-blue', 'rail-receipt', 'air-boarding-pass']) {
    const svg = ticketSVG(record(template, { origin: '<script>alert(1)</script>', passenger: '<img onerror=bad>', price: '57.0' }));
    assert.doesNotMatch(svg, /<script>|<img /);
    if (!template.startsWith('air-')) assert.match(svg, />57\.0</);
  }
});
test('PNG export uses the selected template dimensions instead of forcing the railway ratio', async () => {
  globalThis.location = { href: 'https://example.com/archive/' };
  globalThis.fetch = async () => new Response('font fixture');
  globalThis.Image = class { async decode() {} };
  let canvas;
  globalThis.document = { createElement: tag => {
    assert.equal(tag, 'canvas');
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })) };
    return canvas;
  } };
  const output = await exportPNG(record('air-boarding-pass'));
  assert.equal(output.type, 'image/png');
  assert.equal(canvas.width, 2460);
  assert.equal(canvas.height, 1000);
  await exportPNG(record('rail-red'));
  assert.equal(canvas.width, 1800);
  assert.equal(canvas.height, 1200);
  await exportPNG(record('rail-red'),{width:1024});
  assert.equal(canvas.width,1024);
  assert.equal(canvas.height,683);
  await exportPNG(record('air-boarding-pass'),{width:1024});
  assert.equal(canvas.width,1024);
  assert.equal(canvas.height,416);
});
