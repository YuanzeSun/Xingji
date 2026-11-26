import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { PDFDocument, PDFName } from 'pdf-lib';
import { albumPages, A4 } from '../src/album-layout.js';
import { exportTicketImages, exportTicketZIP, exportTicketAlbum } from '../src/ticket-export.js';
import { createRecord } from '../src/model.js';
import { demoRecords } from '../src/demo.js';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG5kAAAAASUVORK5CYII=', 'base64');
const renderTicket = async () => new Blob([pixel], { type: 'image/png' });

test('A4 packing preserves every ticket in order, ratio and safe printable bounds across mixed templates', () => {
  const records = [...demoRecords(), ...demoRecords().reverse(), ...demoRecords()];
  for (const group of [[], records, records.filter(r => r.type === 'rail'), records.filter(r => r.type === 'flight')]) {
    const pages = albumPages(group);
    assert.deepEqual(pages.flat().map(item => item.record.id), group.map(r => r.id));
    for (const page of pages) {
      for (const item of page) {
        const flight = item.record.type === 'flight';
        const ratio = flight ? 1230 / (item.record.baggageTagNumbers ? 671 : 500) : item.record.template.includes('red') ? 900 / 600 : 856 / 540;
        assert.ok(Math.abs(item.width / item.height - ratio) < 0.00001);
        const a = Math.abs(item.angle) * Math.PI / 180;
        const halfW = (item.width * Math.cos(a) + item.height * Math.sin(a)) / 2;
        const halfH = (item.height * Math.cos(a) + item.width * Math.sin(a)) / 2;
        assert.ok(item.x + item.width / 2 - halfW > 14);
        assert.ok(item.x + item.width / 2 + halfW < A4.width - 14);
        assert.ok(item.y + item.height / 2 - halfH > 15);
        assert.ok(item.y + item.height / 2 + halfH + 7 < 279);
      }
      for (let i = 0; i < page.length; i++) for (let j = i + 1; j < page.length; j++) {
        const a = page[i], b = page[j];
        assert.ok(a.x + a.width + 2 < b.x || b.x + b.width + 2 < a.x || a.y + a.height + 7 < b.y || b.y + b.height + 7 < a.y, 'tickets and their date captions must not overlap');
      }
    }
  }
});

test('PNG ZIP includes all selected records beyond one screen, with unique ordered Unicode filenames and unchanged image bytes', async () => {
  const records = Array.from({ length: 62 }, (_, i) => createRecord({ id: String(i), service: 'G123', origin: '北京/南', destination: '上海虹桥', departureDate: '2026-01-01' }));
  const before = structuredClone(records), progress = [];
  const archive = await exportTicketZIP(records, { renderTicket, onProgress: value => progress.push(value) });
  assert.equal(archive.type, 'application/zip');
  const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
  assert.equal(Object.keys(files).length, 62);
  assert.equal(Object.keys(files)[0], '01_2026-01-01_G123_北京_南-上海虹桥.png');
  assert.match(Object.keys(files).at(-1), /^62_/);
  for (const data of Object.values(files)) assert.deepEqual(Buffer.from(data), pixel);
  assert.equal(progress.at(-1).completed, records.length);
  assert.deepEqual(records, before, 'exports must never edit archive metadata');
});

test('album is an A4 PDF with the requested title and all tickets exactly once', async () => {
  const records = demoRecords(), rendered = [], captions = [];
  const album = await exportTicketAlbum(records, { cover: false, title: '我的旅行 · 纪念', renderTicket: async record => { rendered.push(record.id); return renderTicket(); }, renderText: async lines => { captions.push(lines.map(line => line.text).join(' ')); return pixel; } });
  assert.equal(album.type, 'application/pdf');
  const pdf = await PDFDocument.load(await album.arrayBuffer());
  assert.equal(pdf.getTitle(), '我的旅行 · 纪念');
  assert.equal(pdf.getAuthor(),'YuanzeSun');
  assert.equal(pdf.getPageCount(), albumPages(records).length);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.276) < 0.01);
    assert.ok(Math.abs(page.getHeight() - 841.890) < 0.01);
  }
  assert.deepEqual(rendered, records.map(record => record.id));
  assert.equal(captions.filter(text=>text==='行迹 · by @YuanzeSun').length,1);
  for (const record of records) assert.ok(captions.some(text=>text.includes(calendarDate(record.departureDate))));
  assert.equal(captions.filter(text=>text==='旅途票笺').length,1);
  const imageRefs=pdf.getPages().map(page=>new Set(page.node.Resources().lookup(PDFName.of('XObject')).entries().map(([,ref])=>ref.toString())));
  assert.equal([...imageRefs[0]].filter(ref=>imageRefs.every(refs=>refs.has(ref))).length,2,'the running heading and author credit are reused on every page');
  assert.equal(pdf.catalog.getViewerPreferences().getPrintScaling(), 'None');
});

test('both exports stop after cancellation, reject empty selections and propagate rendering errors without partial downloads', async () => {
  for (const generate of [exportTicketImages, exportTicketZIP, exportTicketAlbum]) {
    await assert.rejects(generate([], { renderTicket }), /选择票据/);
    const controller = new AbortController(), seen = [];
    await assert.rejects(generate(demoRecords(), { signal: controller.signal, renderText: async () => pixel, renderTicket: async record => { seen.push(record.id); controller.abort(); return renderTicket(); } }), { name: 'AbortError' });
    assert.equal(seen.length, 1);
    await assert.rejects(generate(demoRecords(), { renderText: async () => pixel, renderTicket: async () => { throw new Error('font unavailable'); } }), /font unavailable/);
  }
});

test('one selected ticket downloads as a PNG, while several remain a ZIP', async () => {
  const one = await exportTicketImages(demoRecords().slice(0, 1), { renderTicket });
  assert.equal(one.type, 'image/png');
  assert.deepEqual(Buffer.from(await one.arrayBuffer()), pixel);
  const several = await exportTicketImages(demoRecords().slice(0, 2), { renderTicket });
  assert.equal(several.type, 'application/zip');
});

test('optional cover adds one page, reuses ticket renders and keeps title off the inner pages', async () => {
  const records = demoRecords(), rendered = [], text = [];
  const album = await exportTicketAlbum(records, { cover: true, title: '旅途纪念', renderTicket: async record => { rendered.push(record.id); return renderTicket(); }, renderText: async lines => { text.push(lines.map(line => line.text).join(' ')); return pixel; } });
  const pdf = await PDFDocument.load(await album.arrayBuffer());
  assert.equal(pdf.getPageCount(), albumPages(records).length + 1);
  assert.equal(pdf.getPage(0).node.Resources().lookup(PDFName.of('XObject')).keys().length, 3, 'cover contains only typography and decorative vectors, with no ticket images');
  assert.deepEqual(rendered, records.map(record => record.id));
  assert.equal(text.filter(value => value.includes('旅途纪念')).length, 1, 'album title appears only on the cover');
  assert.equal(text.some(value => /张旅途留念/.test(value)), false);
});

test('long cover titles wrap intact instead of being squeezed and unknown dates remain explicit',async()=>{
  const original=globalThis.document,drawn=[];
  const context={scale(){},measureText(text){return {width:[...text].length*Number(this.font.match(/([\d.]+)px/)[1])};},fillText(text,x,y,width){drawn.push({text,y,width,font:this.font});}};
  globalThis.document={fonts:{load:async()=>{}},createElement:()=>({getContext:()=>context,toBlob:callback=>callback(new Blob([pixel]))})};
  try{
    const title='从北京到世界各地那些值得珍藏的回忆和每一次不曾忘记的出发';
    const blob=await exportTicketAlbum([createRecord({})],{title,renderTicket});
    const rows=drawn.filter(row=>row.font.startsWith('11px'));
    assert.ok(rows.length>1&&rows.length<=3);assert.equal(rows.map(row=>row.text).join(''),title.slice(0,30));
    assert.ok(rows.every(row=>row.y+11<=46));
    assert.ok(drawn.some(row=>row.text.includes('日期未收录')));
    assert.equal((await PDFDocument.load(await blob.arrayBuffer())).getPageCount(),2);
  }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
