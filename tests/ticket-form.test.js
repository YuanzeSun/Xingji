import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredTicketFields, validateTicketForm, ticketFieldLabel } from '../src/ticket-form.js';
import { normalizeAircraft } from '../src/aircraft.js';
import { mergeBackupRecords, createRecord } from '../src/model.js';
import { ticketSVG } from '../src/tickets.js';

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
    }
  }
});

test('Airbus manufacturer prefixes are omitted from manual records, imported data and rendered passes', () => {
  for (const value of ['Airbus A330-300', 'AIRBUS A330-300', '空客 A330-300', '空中客车A330-300']) assert.equal(normalizeAircraft(value), 'A330-300');
  assert.equal(normalizeAircraft('Boeing 737-800'), '737-800');
  assert.equal(normalizeAircraft('波音 737-85C(WL)'), '737-85C(WL)');
  const record = createRecord({ type: 'flight', template: 'air-boarding-pass', aircraft: 'Airbus A320-200' });
  assert.equal(record.aircraft, 'A320-200');
  const rendered = ticketSVG({ ...record, aircraft: 'Airbus A330-300' });
  assert.match(rendered, /A330-300/); assert.doesNotMatch(rendered, /Airbus/);
});

test('ticket forms and archive imports require a complete identity when one is provided', () => {
  const record = createRecord({ type: 'flight', template: 'air-boarding-pass', flightStatus: 'open',
    origin: 'PEK', destination: 'HND', passenger: 'DEMO/TRAVELER', identity: 'AB1234＊＊' });
  assert.throws(() => validateTicketForm(record), /证件号不能包含星号/);
  assert.throws(() => mergeBackupRecords([], [record]), /证件号不能包含星号/);
});
