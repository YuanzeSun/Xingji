import test from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import { createRecord, archive, readArchive } from '../src/model.js';
import { reviewTicketImport } from '../src/ticket-import-review.js';
import { parseScanText } from '../src/scan-engine.js';
import { ticketSVG } from '../src/tickets.js';
import { layoutFontFiles } from '../src/ticket-layouts.js';
import { validateTicketForm } from '../src/ticket-form.js';
import { journeyStatistics, tripSeries } from '../src/statistics-model.js';
import { journeyNetwork } from '../src/journey-map-model.js';
import { loadRailwayNetwork } from '../src/railway-network.js';
import { cityOverview } from '../src/locations.js';
import { timeline } from '../src/timeline.js';
import { airlineLogo } from '../src/airline-logo.js';
import { AIRLINE_LOGOS } from '../src/data/airline-logos.js';
import { refineRailReceipt } from '../src/rail-ocr.js';

const fields = { origin:'上海虹桥', destination:'济南西', service:'G104', departureDate:'2024-06-18', departureTime:'07:13', passenger:'示例旅客', identity:'P000001', seatClass:'二等座', carriage:'08', seat:'08A', price:'41.5' };

test('receipt OCR recovers omitted fee labels and prices from the left text block and restores segmentation', async () => {
  const tsv='1\t1\t0\t0\t0\t0\t0\t0\t771\t515\t-1\t\n5\t1\t1\t1\t1\t1\t57\t114\t219\t28\t64\tShanghaihonggiao\n5\t1\t1\t1\t1\t2\t548\t121\t82\t24\t75\tJinanzi';
  const original={text:'G104\nShanghaihonggiao Jinanzi',tsv};
  const settings=[], worker={setParameters:async value=>settings.push(value),recognize:async(image,{rectangle})=>{assert.ok(rectangle.left>=0 && rectangle.top>140 && rectangle.width<500);return {data:{text:'¥ 41.5%\n退票费\n',confidence:60}};}};
  const data={...original};await refineRailReceipt(worker,{},data);
  const record=parseScanText(data.text,'photo',{layout:data.tsv})[0];
  assert.equal(record.template,'rail-refund-receipt');assert.equal(record.price,'41.5');
  assert.deepEqual(settings.at(-1),{tessedit_char_whitelist:'',tessedit_pageseg_mode:'3'});
  const uncertain={...original};await refineRailReceipt({...worker,recognize:async()=>({data:{text:'¥ 41.5元 退票费',confidence:40}})},{},uncertain);assert.equal(uncertain.text,original.text);
  const known={...original,text:'￥38.0元\n'+original.text};await refineRailReceipt(worker,{},known);assert.equal(parseScanText(known.text,'photo',{layout:known.tsv})[0].price,'38.0');
  const failed={...original};await refineRailReceipt({...worker,recognize:async()=>{throw Error('unreadable');}},{},failed);assert.equal(failed.text,original.text);
  assert.deepEqual(settings.at(-1),{tessedit_char_whitelist:'',tessedit_pageseg_mode:'3'});
});

test('receipt and refund-fee layouts never print travel restrictions; refund amount remains a fee', () => {
  for (const template of ['rail-receipt', 'rail-refund-receipt']) {
    const record = createRecord({ ...fields, template }), svg = ticketSVG(record);
    assert.doesNotMatch(svg, /限乘当日当次车/);
    assert.match(svg, /仅供报销使用/); assert.match(svg, />41.5</);
    const doc = new JSDOM(svg, { contentType:'image/svg+xml' }).window.document;
    const fee = [...doc.querySelectorAll('text')].find(node => node.textContent === '退票费');
    assert.equal(!!fee, template === 'rail-refund-receipt');
    if (fee) assert.equal(fee.getAttribute('y'), '301');
    assert.ok(layoutFontFiles(template).some(([family]) => family === 'TicketFang'));
  }
  assert.match(ticketSVG(createRecord({ ...fields, template:'rail-blue' })), /限乘当日当次车/);
});

test('refund fee survives OCR and JSON without merging into the original journey', async () => {
  const text = 'R063196\n上海虹桥站 G104 济南西站\nShanghaihongqiao Jinanxi\n2024年06月18日 07:13开 08车08A号\n￥41.5元 二等座\n退票费\n仅供报销使用\n报销凭证 遗失不补\n退票改签时须交回车站';
  const refund = parseScanText(text)[0];
  assert.equal(refund.template, 'rail-refund-receipt'); assert.equal(refund.price, '41.5');
  const ticket = createRecord({ ...fields, id:'original', template:'rail-receipt' });
  const fee = createRecord({ ...fields, id:'refund', template:'rail-refund-receipt' });
  const rows = [ticket, fee];
  const matches = reviewTicketImport(rows, { ...fee, id:'refund-scan' });
  assert.deepEqual(matches.map(match => match.record.id), [fee.id]);
  assert.equal(readArchive(archive(rows)).find(row => row.id === 'refund').template, fee.template);
  assert.doesNotThrow(() => validateTicketForm({ ...fee, seat:'', carriage:'', seatClass:'', departureTime:'' }));
  assert.throws(() => validateTicketForm({ ...fee, price:'' }), /退票费/);
  assert.equal(journeyStatistics([fee], { dateTo:'2026-11-17' }).rail, 0);
  assert.deepEqual(tripSeries([fee]), []); assert.equal(journeyNetwork([fee]).records.length, 0);
  assert.equal(cityOverview([fee]).cities.length, 0); assert.match(timeline([fee], () => ''), /退票费凭证/);
  const network = await loadRailwayNetwork([fee], { loader:() => assert.fail('A fee is not a travelled railway') });
  assert.equal(network.records.length, 0);
});

test('the unified local SVG library matches explicit airline names and codes, without flight-prefix guesses', () => {
  assert.equal(Object.keys(AIRLINE_LOGOS).length, 180);
  for (const name of ['国航', '中国国际航空', 'Air China', 'ca', 'CCA', '中国国际航空股份有限公司']) assert.equal(airlineLogo(name)?.code, 'CA');
  for (const [name, code] of [['中国东方航空','MU'],['南航','CZ'],['海南航空','HU'],['吉祥航空','HO'],['厦航','MF'],['Cathay Pacific','CX'],['Singapore Airlines','SQ'],['ANA','NH']]) assert.equal(airlineLogo(name)?.code, code, name);
  for (const name of ['西藏航空', '西藏航空有限公司', '藏航', 'Tibet Airlines', 'Xizang Airlines', 'TV', 'TBA']) assert.equal(airlineLogo(name)?.code, 'TV', name);
  assert.equal(airlineLogo('不存在的航空'), null); assert.equal(airlineLogo('SL'), null);
  const record = createRecord({ type:'flight', template:'air-boarding-pass', airline:'国航', origin:'PEK', destination:'HND', service:'CA181', departureTime:'08:40' });
  const before = JSON.stringify(record), svg = ticketSVG(record), doc = new JSDOM(svg, { contentType:'image/svg+xml' }).window.document;
  const header = doc.querySelector('[data-airline-logo="CA"] image').getAttribute('href');
  assert.ok(header.startsWith('data:image/svg+xml;base64,'));
  assert.equal(doc.querySelector('[data-airline-watermark="CA"] image').getAttribute('href'), header);
  assert.deepEqual([...doc.querySelectorAll('path[data-boarding-pen]')].map(path => path.getAttribute('data-boarding-pen')), ['destination', 'departure']);
  assert.equal(doc.querySelectorAll('image[href^="http"]').length, 0);
  assert.doesNotMatch(ticketSVG({ ...record, airline:'' }), /data-airline-logo=/);
  assert.doesNotMatch(ticketSVG({ ...record, airline:'未知航空' }), /data-airline-(?:logo|watermark)=/);
  assert.doesNotMatch(ticketSVG({ ...record, departureTime:'', destination:'', destinationCode:'' }), /data-boarding-pen=/);
  assert.equal(JSON.stringify(record), before);
});

test('every embedded airline mark uses the same square SVG and retains transparent space', () => {
  for (const [slug, { image }] of Object.entries(AIRLINE_LOGOS)) {
    const svg = Buffer.from(image.split(',')[1], 'base64');
    assert.match(svg.toString(), /viewBox="0 0 24 24"/, slug);
    const { pixels } = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
    assert.equal(pixels.length, 24 * 24 * 4, slug);
    const corners = [0, 23, 23 * 24, 24 * 24 - 1];
    assert.ok(corners.some(index => pixels[index * 4 + 3] === 0), slug);
  }
});
