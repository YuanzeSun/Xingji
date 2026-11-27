import {calendarDate} from '../src/journey-date.js';
import { codeDataFromResult, symbolFromCodeData, codeBytes, renderCodeData } from '../src/barcode-data.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareZXingModule, readBarcodes, writeBarcode } from 'zxing-wasm';
import { prepareCodeReader, rebuildCodeSymbols } from '../src/code-reader.js';
import { encodeBCBP, readBoardingCode } from '../src/bcbp.js';
import { readBCBP } from '../src/bcbp-reader.js';
import { createRecord } from '../src/model.js';
import { applyReviewedTicket } from '../src/ticket-import-review.js';
import { ticketCodeEditor, bindTicketCodeEditor } from '../src/code-editor.js';
import {boardingGeneratorMarkup} from '../src/boarding-code-generator.js';
import { BOARDING_SHARED_FIELDS } from '../src/boarding-code-state.js';
import { JSDOM } from 'jsdom';
import {taggedBoardingPayload} from './helpers/tagged-boarding-code.js';
import { multilegCode, multilegPayload } from './helpers/multileg-boarding-code.js';
import { BOARDING_METADATA_FIELDS } from '../src/boarding-metadata.js';
import {boardingPresentation} from '../src/boarding-language.js';
import {seatClassField,bindSeatClassFields} from '../src/seat-class-field.js';
import {ticketFieldLocked} from '../src/barcode-fields.js';
import { symbolImage } from '../src/barcode-symbols.js';
import { Resvg } from '@resvg/resvg-js';
import { DEMO_BOARDING_CODE } from '../src/demo-boarding-code.js';
import { DEMO_TICKET_CODE } from '../src/demo-code.js';
import bwip from 'bwip-js/generic';

await Promise.all([
  prepareCodeReader({ wasmBinary: await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') }),
  prepareZXingModule({ overrides: { wasmBinary: await readFile('node_modules/zxing-wasm/dist/full/zxing_full.wasm') }, fireImmediately: true })
]);
const payload = new Uint8Array([0, 1, 29, 65, 66, 67, 127, 128, 200, 255, 49, 50, 51]);
test('compact and MicroPDF417 boarding passes rebuild into verified standard PDF417', async () => {
  const text = encodeBCBP({ passenger: 'EXAMPLE/TRAVELER', pnr: 'ABC123', origin: 'JFK', destination: 'LHR', carrier: 'BA', flightNumber: '321', date: '2026-05-18', cabin: 'Y', seat: '12A', sequence: '42', status: '1' });
  for (const bcid of ['pdf417compact', 'micropdf417']) {
    const [raw] = bwip.raw({ bcid, text });
    const width = raw.pixx, height = raw.pixy, rowScale = width * height / raw.pixs.length;
    const image = symbolImage({ width, height, data: Uint8ClampedArray.from({ length: width * height },
      (_, i) => raw.pixs[Math.floor(Math.floor(i / width) / rowScale) * width + i % width] ? 0 : 255) }, 'flight');
    const { codes: [rebuilt] } = await rebuildCodeSymbols(image, 'flight', { boardingPass: true });
    const restored = rebuilt?.data;
    assert.equal(restored?.format, 'PDF417', bcid);
    assert.equal(atob(restored.rawBytes), text);
    assert.equal(readBoardingCode(restored).seat, '12A');
  }
});

test('boarding QR codes preserve Chinese or binary extensions and autofill fields while clearing only the electronic marker',async()=>{
  const header=encodeBCBP({passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1',electronic:'E'});
  const utf8=text=>new TextEncoder().encode(text);
  const examples=[
    {conditional:utf8('>6'.padEnd(43,' ')),tail:utf8('旅客/测试 出发/纽约 到达/伦敦')},
    {conditional:new Uint8Array([...utf8('附加信息'),0,255,128]),tail:new Uint8Array()}
  ];
  for(const {conditional,tail} of examples){
    // A carrier can use a nonstandard cabin code. It must be retained, not replaced by the new Y default.
    const prefix=header.slice(0,47)+'Z'+header.slice(48,58)+conditional.length.toString(16).toUpperCase().padStart(2,'0');
    const bytes=new Uint8Array([...utf8(prefix),...conditional,...tail]);
    const expected=bytes.slice();expected[22]=32;
    const made=await writeBarcode(bytes,{format:'QRCode'}),image=symbolImage(made.symbol,'flight');
    const result=await rebuildCodeSymbols(image,'flight',{boardingPass:true});
    assert.deepEqual(result.issues,[]);assert.equal(result.codes.length,1);
    const code=result.codes[0].data,parsed=readBoardingCode(code);
    assert.equal(code.format,'PDF417');assert.equal(result.codes[0].format,'PDF417');
    const [converted]=await readBarcodes(result.codes[0].image,{formats:['PDF417'],textMode:'Plain'});assert.deepEqual(converted.bytes,expected);
    assert.deepEqual(codeBytes(code.rawBytes),expected);assert.equal(parsed.service,'BA321');assert.equal(parsed.cabin,'Z');assert.equal(parsed.electronic,'');
    assert.equal(readBCBP(String.fromCharCode(...bytes)).passenger,'EXAMPLE/TRAVELER');
    assert.equal(readBCBP(String.fromCharCode(...bytes.slice(0,60+conditional.length-1))),null,'truncated extensions are still rejected');

    const draft=createRecord({type:'flight',template:'air-boarding-pass'});
    const dom=new JSDOM('<form>'+BOARDING_SHARED_FIELDS.map(key=>`<input name="${key}" value="${draft[key]}">`).join('')+ticketCodeEditor(draft)+boardingGeneratorMarkup(draft)+'</form>'),form=dom.window.document.querySelector('form');
    const cleanup=bindTicketCodeEditor(form,draft,()=>{},{loadRebuilder:async()=>async()=>result});
    try{
      const photo=form.querySelector('#code-photo');Object.defineProperty(photo,'files',{value:[new Blob(['synthetic QR'])]});photo.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,0));
      for(const [key,value] of Object.entries({passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',service:'BA321',originCode:'JFK',destinationCode:'LHR',seat:'12A'})){
        assert.equal(draft[key],value);assert.equal(form.elements[key].value,value);
      }
      assert.equal(calendarDate(draft.departureDate),'');assert.equal(draft.seatClass,'Z');assert.equal(draft.airline,'英国航空');assert.equal(draft.boardingCodeSource,'original');
      assert.equal(form.querySelector('[data-bcbp="cabin"]'),null);assert.equal(draft.seatClass,'Z');assert.equal(form.querySelector('[data-bcbp="electronic"]').value,'');
      assert.equal(form.querySelector('[data-bcbp-fields]').disabled,true);assert.deepEqual(codeBytes(draft.boardingCode.rawBytes),expected);
    }finally{cleanup();dom.window.close();}
  }
});

test('every supported boarding-code format becomes PDF417 and loses only the electronic ticket marker',async()=>{
  const text=encodeBCBP({passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1',electronic:'E'});
  for(const format of ['QRCode','PDF417','Aztec','DataMatrix','Code128']){
    const made=await writeBarcode(text,{format}),image=symbolImage(made.symbol,'flight');
    const {codes,issues}=await rebuildCodeSymbols(image,'flight',{boardingPass:true});
    assert.deepEqual(issues,[],format);assert.equal(codes.length,1,format);
    const code=codes[0];assert.equal(code.format,'PDF417',format);assert.equal(code.data.format,'PDF417');assert.equal(code.verified,true);
    assert.equal(readBoardingCode(code.data).service,'BA321');
    const [before]=await readBarcodes(image,{formats:[format]}),[after]=await readBarcodes(code.image,{formats:['PDF417']});
    const expected=before.bytes.slice();expected[22]=32;
    assert.equal(before.bytes[22],69);assert.deepEqual(after.bytes,expected,format);assert.deepEqual(codeBytes(code.data.rawBytes),expected,format);
  }
});

test('tagged Chinese names, ticket numbers and gates autofill from QR while recorded boarding times remain separate',async()=>{
  const bytes=new TextEncoder().encode(taggedBoardingPayload()),made=await writeBarcode(bytes,{format:'QRCode'}),image=symbolImage(made.symbol,'flight');
  const result=await rebuildCodeSymbols(image,'flight',{boardingPass:true});assert.deepEqual(result.issues,[]);assert.equal(result.codes.length,1);
  const draft=createRecord({type:'flight',template:'air-boarding-pass',boardingTime:'17:30'});
  const fields=[...BOARDING_SHARED_FIELDS.filter(key=>key!=='seatClass'),'ticketNumber','gate','boardingTime','airline'];
  const dom=new JSDOM('<form>'+fields.map(key=>`<input name="${key}" value="${draft[key]}">`).join('')+seatClassField(draft)+ticketCodeEditor(draft)+boardingGeneratorMarkup(draft)+'</form>'),form=dom.window.document.querySelector('form');
  bindSeatClassFields(form);
  const cleanup=bindTicketCodeEditor(form,draft,()=>{},{loadRebuilder:async()=>async()=>result});
  try{
    const photo=form.querySelector('#code-photo');Object.defineProperty(photo,'files',{value:[new Blob(['synthetic QR'])]});photo.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(draft.passenger,'张三');assert.equal(form.elements.passenger.value,'张三');assert.equal(draft.ticketNumber,'1230000000001');assert.equal(form.elements.gate.value,'A101');
    assert.equal(draft.seatClass,'Z');assert.equal(form.elements.seatClass.value,'Z');assert.equal(form.querySelector('[data-seat-preset]').value,'Z');assert.equal(form.elements.seatClass.hidden,true);
    assert.equal(draft.airline,'中国国际航空');assert.equal(form.elements.airline.value,'中国国际航空');
    assert.equal(draft.boardingTime,'17:30');assert.equal(calendarDate(draft.departureDate),'');assert.equal(readBoardingCode(draft.boardingCode).recordedBoardingTime,'18:21');
    assert.equal(form.querySelector('[data-bcbp="passenger"]').value,'ZHANG/SAN');assert.equal(form.querySelector('[data-bcbp="electronic"]').value,'');assert.equal(form.querySelector('[data-bcbp-fields]').disabled,true);
    for(const origin of ['PEK','LHR']){const presentation=boardingPresentation({...draft,origin,originCode:origin});assert.equal(presentation.language,origin==='PEK'?'zh':'en');assert.equal(presentation.passenger,'张三');}
    const expected=bytes.slice();expected[22]=32;assert.deepEqual(codeBytes(draft.boardingCode.rawBytes),expected);
    for(const key of ['passenger','service','origin','destination','seat','seatClass','airline','ticketNumber','gate','departureDate'])assert.equal(draft.fieldSources[key],'barcode',key);
    assert.equal(ticketFieldLocked(draft,'seat'),true);
    assert.equal(ticketFieldLocked(draft,'boardingTime'),false);
  }finally{cleanup();dom.window.close();}
});

test('a boarding QR fills available baggage, loyalty and marketing fields and leaves absent fields blank', async () => {
  const payload = multilegPayload({ count: 1 });
  const withMetadata = payload.replace('>8', '>6').replace('0123456789002', '0123456789000').replace('20K', '40l');
  const withoutMetadata = payload.slice(0, 58) + '00';
  const metadata = {
    baggageTagNumbers: '0123456789', checkedBaggageCount: '1',
    frequentFlyerCarrier: 'CA', frequentFlyerNumber: '00000123456789', marketingCarrier: 'LH'
  };
  for (const [text, expected] of [[withMetadata, metadata], [withoutMetadata, {}]]) {
    const bytes = Uint8Array.from(text, character => character.charCodeAt(0));
    const { symbol } = await writeBarcode(bytes, { format: 'QRCode' });
    const result = await rebuildCodeSymbols(symbolImage(symbol, 'flight'), 'flight', { boardingPass: true });
    assert.deepEqual(result.issues, []);
    assert.equal(result.codes.length, 1);

    const draft = createRecord({ type: 'flight', template: 'air-boarding-pass' });
    const inputs = BOARDING_METADATA_FIELDS.map(key => `<input name="${key}">`).join('');
    const dom = new JSDOM(`<form>${inputs}${ticketCodeEditor(draft)}</form>`);
    const form = dom.window.document.querySelector('form');
    const dispose = bindTicketCodeEditor(form, draft, () => {}, { loadRebuilder: async () => async () => result });
    try {
      const input = form.querySelector('#code-photo');
      Object.defineProperty(input, 'files', { value: [new Blob(['QR fixture'])] });
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(draft.service, 'CA1234');
      const saved = createRecord(draft);
      for (const key of BOARDING_METADATA_FIELDS) {
        assert.equal(form.elements[key].value, expected[key] ?? '', key);
        assert.equal(form.elements[key].readOnly, key in expected, key);
        assert.equal(saved[key], expected[key] ?? '', key);
      }
    } finally { dispose(); dom.window.close(); }
  }
});

test('two scans of a connecting boarding pass can save each chosen flight separately', async () => {
  const code = multilegCode();
  let saved = [];
  const legs = [
    { service: 'CA1234', year: 2024, dayOfYear: 366, ticketNumber: '1230000000001', time: '18:21' },
    { service: 'UA857', year: 2025, dayOfYear: 1, ticketNumber: '1230000000002', time: '' }
  ];
  for (const [index, leg] of legs.entries()) {
    const draft = createRecord({ type: 'flight', template: 'air-boarding-pass' });
    const dom = new JSDOM('<form>' + ticketCodeEditor(draft) + '</form>');
    const form = dom.window.document.querySelector('form');
    let fills = 0;
    const cleanup = bindTicketCodeEditor(form, draft, () => fills++, {
      loadRebuilder: async () => async () => ({ codes: [{ format: code.format, data: code }], issues: [] }),
    });
    try {
      const input = form.querySelector('#code-photo');
      Object.defineProperty(input, 'files', { value: [new Blob(['fixture'])] });
      input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
      await new Promise(resolve => setImmediate(resolve));
      const choices = form.querySelectorAll('.code-choice');
      assert.equal(choices.length, 2);
      assert.equal(fills, 0);
      assert.equal(draft.service, '');
      assert.ok(choices[index].textContent.includes(leg.service));
      choices[index].click();
      assert.equal(fills, 1);
      assert.equal(draft.service, leg.service);
      assert.equal(draft.boardingLegIndex, String(index));
      assert.deepEqual(draft.departureDate, { year: null, dayOfYear: leg.dayOfYear });
      assert.equal(draft.ticketNumber, leg.ticketNumber);
      assert.equal(draft.actualBoardingTime, leg.time);
      draft.departureDate.year = leg.year;
      saved = applyReviewedTicket(saved, draft).records;
      assert.equal(saved.length, index + 1);
    } finally { cleanup(); dom.window.close(); }
  }
  assert.deepEqual(saved.map(record => record.service).sort(), ['CA1234', 'UA857']);
});

function rotate(image) {
  const data = new Uint8ClampedArray(image.data.length), width = image.height, height = image.width;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) data.set(image.data.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 4), (x * width + image.height - y - 1) * 4);
  return { width, height, data };
}
for (const format of ['QRCode', 'PDF417', 'Aztec', 'Code128', 'DataMatrix', 'MicroQRCode']) {
  test(`${format} is decoded and redrawn from saved raw bytes and encoding parameters`, async () => {
    const input = ['Code128','MicroQRCode'].includes(format) ? 'M1XINGJI12345' : payload;
    const made = await writeBarcode(input, { format, options: format === 'QRCode' ? 'version=5,ecLevel=H' : '', scale: 4 });
    assert.equal(made.error, '');
    const type = ['QRCode','MicroQRCode','Code128'].includes(format) ? 'rail' : 'flight', original = symbolImage(made.symbol, type);
    for (const image of [original, rotate(original)]) {
      const { codes, issues } = await rebuildCodeSymbols(image, type);
      assert.deepEqual(issues, []); assert.equal(codes.length, 1);
      const stored=JSON.parse(JSON.stringify(codes[0].data));
      assert.deepEqual(codeBytes(stored.rawBytes), (await readBarcodes(image))[0].bytes);
      assert.doesNotMatch(JSON.stringify(stored), /data:image|modules|pixels|<svg/);
      assert.ok(symbolFromCodeData(stored).data.length);
      assert.equal(codes[0].verified, true);
      const [before] = await readBarcodes(image, { formats: [format], textMode: 'Plain' });
      const [after] = await readBarcodes(codes[0].image, { formats: [format], textMode: 'Plain' });
      assert.deepEqual(after.bytes, before.bytes); assert.deepEqual(after.bytesECI, before.bytesECI);
      if (format === 'QRCode' || format === 'MicroQRCode') {
        const source = JSON.parse(before.extra), restored = JSON.parse(after.extra);
        assert.equal(restored.DataMask, source.DataMask); assert.equal(restored.ECLevel, source.ECLevel); assert.equal(restored.Version, source.Version);
      }
    }
  });
}

test('QR symbols with the same payload and different original versions remain distinct', async () => {
  const originals = await Promise.all([2, 6].map(version => writeBarcode('XINGJI SAME CONTENT', { format: 'QRCode', options: `version=${version},ecLevel=Q` })));
  assert.notEqual(originals[0].symbol.width, originals[1].symbol.width);
  for (const made of originals) {
    const { codes } = await rebuildCodeSymbols(symbolImage(made.symbol), 'rail');
    assert.equal(codes.length, 1); assert.equal(codes[0].data.parameters.symbolVersion, String((made.symbol.width-17)/4)); assert.equal(codes[0].symbol.width, made.symbol.width);
  }
});

test('two different QR codes stay separate so an advertisement cannot silently replace a ticket code', async () => {
  const a = await writeBarcode('XINGJI TICKET TEST', { format: 'QRCode' }), b = await writeBarcode('https://example.com/advertisement', { format: 'QRCode' });
  const left = symbolImage(a.symbol), right = symbolImage(b.symbol), width = left.width + right.width + 40, height = Math.max(left.height, right.height), data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [image, offset] of [[left, 0], [right, left.width + 40]]) for (let y = 0; y < image.height; y++) data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), (y * width + offset) * 4);
  const { codes } = await rebuildCodeSymbols({ width, height, data }, 'rail');
  assert.equal(codes.length, 2); assert.equal(codes.filter(code => code.isLink).length, 1);
  assert.equal(new Set(codes.map(code=>code.data.rawBytes)).size,2);
});

test('a damaged image can be recovered by error correction when decoded contents still match', async () => {
  const made = await writeBarcode('XINGJI ORIGINAL PATTERN TEST', { format: 'QRCode', options: 'version=5,ecLevel=H' });
  const symbol = { ...made.symbol, data: new Uint8ClampedArray(made.symbol.data) };
  symbol.data[20 * symbol.width + 20] ^= 255;
  const image = symbolImage(symbol), decoded = await readBarcodes(image, { formats: ['QRCode'] });
  assert.ok(decoded[0]?.isValid, 'fixture should exercise error correction, not an unreadable code');
  const result = await rebuildCodeSymbols(image, 'rail');
  assert.equal(result.codes.length, 1); assert.deepEqual(codeBytes(result.codes[0].data.rawBytes), decoded[0].bytes);
});

test('blank images produce no barcode rather than a newly invented one', async () => {
  const result = await rebuildCodeSymbols({ width: 120, height: 120, data: new Uint8ClampedArray(120 * 120 * 4).fill(255) });
  assert.deepEqual(result.codes, []);
});

test('rendered vector barcodes decode to the saved payload without embedding images', async () => {
  const svg=renderCodeData(DEMO_BOARDING_CODE,{width:1000,height:300});
  assert.doesNotMatch(svg, /<image|data:image/);
  assert.doesNotMatch(svg, /<rect|background/);
  const rendered=new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="300"><rect width="1000" height="300" fill="#a5cbd2"/>${svg}</svg>`).render(), pixels={width:rendered.width,height:rendered.height,data:new Uint8ClampedArray(rendered.pixels)};
  const [decoded]=await readBarcodes(pixels);
  assert.deepEqual(decoded.bytes,codeBytes(DEMO_BOARDING_CODE.rawBytes));
});

test('ticket text outlines do not thicken barcode modules or change their payload', async () => {
  for (const code of [DEMO_TICKET_CODE, DEMO_BOARDING_CODE]) {
    const width = code.format === 'QRCode' ? 396 : 1000, height = code.format === 'QRCode' ? 396 : 300;
    const svg = renderCodeData(code, { width, height });
    const render = attributes => new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><g ${attributes}>${svg}</g></svg>`).render();
    const plain = render('');
    for (const strokeWidth of ['.5', '.65']) {
      const printed = render(`stroke="#172226" stroke-width="${strokeWidth}" paint-order="stroke"`);
      assert.equal(Buffer.from(printed.pixels).equals(Buffer.from(plain.pixels)), true, `${code.format} inherited the ${strokeWidth} ticket text outline`);
      const [decoded] = await readBarcodes({ width, height, data: new Uint8ClampedArray(printed.pixels) });
      assert.deepEqual(decoded.bytes, codeBytes(code.rawBytes));
    }
  }
});

test('ECI and literal escape-looking bytes survive encoding and JSON round trips', async () => {
  for (const format of ['QRCode','PDF417','Aztec','DataMatrix']) {
    const bytes=new TextEncoder().encode('行迹\\^FNC1^ECI000026');
    const made=await writeBarcode(bytes,{format,options:'eci=26'}), [before]=await readBarcodes(made.image);
    assert.ok(before.hasECI);
    const {codes,issues}=await rebuildCodeSymbols(symbolImage(made.symbol),'flight');
    assert.deepEqual(issues,[]); assert.equal(codes.length,1);
    assert.ok(codes[0].data.eci.some(part=>part.value===26));
    const saved=JSON.parse(JSON.stringify(codes[0].data)), [after]=await readBarcodes(symbolImage(symbolFromCodeData(saved),'flight'));
    assert.deepEqual(after.bytes,before.bytes); assert.deepEqual(after.bytesECI,before.bytesECI);
    const converted=await rebuildCodeSymbols(symbolImage(made.symbol),'flight',{boardingPass:true});
    assert.deepEqual(converted.issues,[],format);assert.equal(converted.codes.length,1);
    const pdf417=converted.codes[0];assert.equal(pdf417.format,'PDF417');assert.deepEqual(pdf417.data.eci,saved.eci);
    const [decoded]=await readBarcodes(pdf417.image,{formats:['PDF417']});assert.deepEqual(decoded.bytes,before.bytes);
  }
});

test('GS1 signalling and separator bytes are retained rather than treated as ordinary text', async () => {
  for (const bcid of ['gs1qrcode', 'gs1datamatrix', 'gs1-128']) {
    const svg = bwip.toSVG({ bcid, text: '(01)09501101530003(10)ABC123(17)260101', scale: 3, padding: 12, backgroundcolor: 'FFFFFF' });
    const render = new Resvg(svg).render(), image = { width: render.width, height: render.height, data: new Uint8ClampedArray(render.pixels) };
    const [before] = await readBarcodes(image), { codes, issues } = await rebuildCodeSymbols(image, 'flight');
    assert.equal(before.contentType, 'GS1'); assert.deepEqual(issues, []); assert.equal(codes.length, 1); assert.equal(codes[0].data.gs1, true);
    const [after] = await readBarcodes(codes[0].image); assert.deepEqual(after.bytesECI, before.bytesECI);
  }
});
