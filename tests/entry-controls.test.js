import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { dateControl, bindDatePickers } from '../src/date-field.js';
import { seatField, bindSeatFields } from '../src/seat-field.js';
import { seatClassField, bindSeatClassFields } from '../src/seat-class-field.js';
import { createRecord, archive, readArchive } from '../src/model.js';
import { parseText } from '../src/importers.js';
import { parseScanText } from '../src/scan-engine.js';
import { ticketSVG } from '../src/tickets.js';

test('date controls offer native calendar selection without adding precision to partial dates', () => {
  for (const [value, tag, type] of [['', 'INPUT', 'date'], ['2026-11-16', 'INPUT', 'date'], ['2010-01', 'INPUT', 'month'], ['2010', 'SELECT', 'select-one']]) {
    const dom = new JSDOM(dateControl('departureDate', value, true));
    const input = dom.window.document.querySelector('[name=departureDate]');
    assert.equal(input.tagName, tag); assert.equal(input.type, type); assert.equal(input.value, value);
    assert.equal(input.required, true);
    dom.window.close();
  }
});

test('clicking date and time fields opens their picker, and a choice updates form input listeners', () => {
  const dom = new JSDOM(`<form>${dateControl('departureDate')}<input type="time" name="departureTime"></form>`);
  const { document, Event, MouseEvent } = dom.window;
  const form = document.querySelector('form');
  let opened = 0, changed = '';
  form.addEventListener('input', event => { changed = event.target.value; });
  for (const input of form.elements) input.showPicker = () => { opened++; };
  bindDatePickers(form);
  form.elements.departureDate.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  form.elements.departureTime.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(opened, 2);
  form.elements.departureDate.value = '2024-02-29';
  form.elements.departureDate.dispatchEvent(new Event('change', { bubbles: true }));
  assert.equal(changed, '2024-02-29');
  form.elements.departureDate.showPicker = () => { throw new Error('Not supported'); };
  assert.doesNotThrow(() => form.elements.departureDate.click());
  dom.window.close();
});

function sleeperForm(extra = {}) {
  const record = createRecord({ seat: '015号下铺', seatClass: '硬卧', ...extra });
  const dom = new JSDOM(`<form>${seatClassField(record)}${seatField(record)}</form>`);
  const form = dom.window.document.querySelector('form');
  bindSeatClassFields(form); bindSeatFields(form);
  return { dom, form, record, change: (input, value, type = 'change') => { input.value = value; input.dispatchEvent(new dom.window.Event(type, { bubbles: true })); } };
}

test('sleeper positions follow the berth number and survive saving, editing and ticket rendering', () => {
  const { dom, form, record, change } = sleeperForm();
  assert.equal(form.querySelector('[data-seat-number]').value, '015');
  const select = form.querySelector('[data-berth]');
  assert.equal(select.hidden, false); assert.equal(select.value, '下铺');
  for (const berth of ['上铺', '中铺', '下铺']) {
    change(select, berth);
    const value = new dom.window.FormData(form).get('seat');
    assert.equal(value, '015号' + berth);
    const saved = readArchive(archive([createRecord({ ...record, seat: value })]))[0];
    assert.ok(ticketSVG(saved).includes('号' + berth));
    const reopened = sleeperForm(saved);
    assert.equal(reopened.form.querySelector('[data-berth]').value, berth);
    reopened.dom.window.close();
  }
  dom.window.close();
});

test('a temporary seat-class change hides sleeper positions without forgetting the selected berth', () => {
  const { dom, form, change } = sleeperForm();
  const preset = form.querySelector('[data-seat-preset]'), berth = form.querySelector('[data-berth]');
  change(preset, '二等座');
  assert.equal(berth.hidden, true); assert.equal(form.elements.seat.value, '015');
  change(preset, '硬卧');
  assert.equal(berth.hidden, false); assert.equal(form.elements.seat.value, '015号下铺');
  change(berth, ''); assert.equal(form.elements.seat.value, '015');
  dom.window.close();
});

test('rail defaults use reimbursement stock and preserve explicit template choices', () => {
  assert.equal(createRecord().template, 'rail-receipt');
  const text = '日期：2026-11-16 车次：T42 出发：西安 到达：北京西 09车015号下铺 硬卧';
  const imported = parseText(text)[0];
  assert.equal(imported.template, 'rail-receipt'); assert.equal(imported.seat, '015号下铺');
  assert.equal(parseText('蓝色磁介质票\n' + text)[0].template, 'rail-blue');
  assert.equal(parseText('经典红票\n' + text)[0].template, 'rail-red-classic');
});

test('printed rail OCR keeps upper, middle and lower berth words after the seat number', () => {
  for (const berth of ['上铺', '中铺', '下铺']) {
    const text = `拉萨 T166 蚌埠\nLasa Bengbu\n2010年01月04日 10:00开 01车005号${berth}\n￥766.00元 硬卧`;
    const record = parseScanText(text)[0];
    assert.equal(record.carriage, '01'); assert.equal(record.seat, '005号' + berth);
    assert.equal(record.template, 'rail-receipt');
  }
});
