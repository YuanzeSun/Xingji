import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredTicketFields, validateTicketForm, ticketFieldLabel } from '../src/ticket-form.js';
import { mergeBackupRecords, createRecord } from '../src/model.js';

test('rail and flight require their visible essential fields, with carriage limited to rail', () => {
  for (const type of ['rail', 'flight']) {
    const record = { type, ...Object.fromEntries(requiredTicketFields(type).map(key => [key,key==='departureDate'?'2026-11-18':'value'])) };
    assert.doesNotThrow(() => validateTicketForm(record));
    for (const key of requiredTicketFields(type)) assert.throws(() => validateTicketForm({ ...record, [key]: ' ' }), new RegExp(ticketFieldLabel(key, type)));
    if (type === 'flight') {
      assert.equal(requiredTicketFields(type).includes('carriage'), false);
      assert.equal(ticketFieldLabel('seat', type), '座位号');
      assert.doesNotThrow(() => validateTicketForm({ ...record, departureTime: '' }));
      assert.throws(() => validateTicketForm({ ...record, departureDate: { year: 2026, dayOfYear: null } }), /计划起飞日期/);
      assert.throws(() => validateTicketForm({ ...record, departureDate: { year: null, dayOfYear: 322 } }), /计划起飞日期/);
    }
  }
});

test('ticket forms and archive imports require a complete identity when one is provided', () => {
  const record = createRecord({ type: 'flight', template: 'air-boarding-pass', flightStatus: 'open',
    origin: 'PEK', destination: 'HND', passenger: 'DEMO/TRAVELER', identity: 'AB1234＊＊' });
  assert.throws(() => validateTicketForm(record), /证件号不能包含星号/);
  assert.throws(() => mergeBackupRecords([], [record]), /证件号不能包含星号/);
});
