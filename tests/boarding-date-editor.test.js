import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoardingCode } from '../src/bcbp.js';
import { createRecord } from '../src/model.js';
import { browser, until } from './helpers/d1-app.js';
import { prepareCloud } from './helpers/cloud.js';

const pass = {
  passenger: 'DOE/JANE', pnr: 'ABC123', origin: 'PEK', destination: 'SHA',
  carrier: 'CA', flightNumber: '1234', cabin: 'Y', seat: '12A', sequence: '25', status: '1'
};
const scannedTicket = (id, date) => createRecord({
  ...pass, id, type: 'flight', template: 'air-boarding-pass', service: 'CA1234', seatClass: 'Y',
  departureDate: date, boardingCode: createBoardingCode({ ...pass, date }, 'QRCode'),
  boardingCodeSource: 'original', boardingLegIndex: '0', fieldSources: { departureDate: 'barcode' }
});

test('editing a scanned flight preserves the locked ordinal and validates the chosen year', async () => {
  const window = browser();
  const server = await prepareCloud([scannedTicket('day-60', '2024-02-29'), scannedTicket('day-366', '2024-12-31')]);
  const form = () => document.querySelector('#editor-form');
  const field = key => form().elements['departureDate' + key];
  const locked = () => field('Month').disabled && field('Day').disabled && !field('Year').readOnly;
  const fillYear = value => {
    field('Year').value = value;
    field('Year').dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(locked(), 'the scanned month and day stay locked after a year edit');
  };
  const save = async () => {
    form().requestSubmit();
    await until(() => !form());
  };
  const edit = async id => {
    const ticket = `[data-action="view"][data-id="${id}"]`;
    await until(() => document.querySelector(ticket));
    document.querySelector(ticket).click();
    await until(() => document.querySelector('[data-action="edit"]:not(:disabled)'));
    document.querySelector('[data-action="edit"]').click();
    await until(form);
    assert.ok(locked());
  };
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('[data-action="navigate"][data-page="archive"]'));
    document.querySelector('[data-action="navigate"][data-page="archive"]').click();

    await edit('day-60');
    fillYear('2025');
    assert.equal(field('').value, '2025-03-01');
    assert.equal(form().elements.arrivalDateMonth.value, '03');
    fillYear('2028');
    assert.equal(field('').value, '2028-02-29');
    assert.equal(form().elements.arrivalDateMonth.value, '02');
    assert.equal(form().elements.arrivalDateDay.value, '');
    await save();
    const saved = server.records().find(ticket => ticket.id === 'day-60');
    assert.deepEqual(saved.departureDate, { year: 2028, dayOfYear: 60 });
    assert.equal(saved.fieldSources.departureDate, 'barcode');
    assert.equal(saved.fieldSources.departureDateYear, 'manual');
    await edit('day-60');
    assert.equal(field('').value, '2028-02-29');
    document.querySelector('[data-action="close-modal"]').click();
    await until(() => !form());

    await edit('day-366');
    fillYear('2100');
    assert.match(field('Year').validationMessage, /年内天数与年份不符/);
    assert.equal(field('Month').value, '');
    assert.equal(field('Day').value, '');
    assert.equal(field('').value, '');
    form().requestSubmit();
    assert.ok(form(), 'a common year cannot be saved for day 366');
    assert.deepEqual(server.records().find(ticket => ticket.id === 'day-366').departureDate, { year: 2024, dayOfYear: 366 });
    fillYear('');
    assert.doesNotMatch(field('Year').closest('fieldset').textContent, /第 366 天|闰年/);
    form().requestSubmit();
    assert.match(form().querySelector('#editor-error').textContent, /计划起飞日期/);
    assert.deepEqual(server.records().find(ticket => ticket.id === 'day-366').departureDate, { year: 2024, dayOfYear: 366 });
    fillYear('2000');
    assert.equal(field('Year').validationMessage, '');
    assert.equal(field('').value, '2000-12-31');
    await save();
    assert.deepEqual(server.records().find(ticket => ticket.id === 'day-366').departureDate, { year: 2000, dayOfYear: 366 });
  } finally {
    window.dispatchEvent(new window.Event('offline'));
    window.close();
  }
});
