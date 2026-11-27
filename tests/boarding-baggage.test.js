import test from 'node:test';
import assert from 'node:assert/strict';
import { boardingBaggageIndex, withBoardingBaggage } from '../src/boarding-baggage.js';
import { createRecord } from '../src/model.js';
import { ticketDimensions, ticketSVG } from '../src/tickets.js';
import { multilegCode } from './helpers/multileg-boarding-code.js';

const flight = (id, origin, destination, fields = {}) => createRecord({
  id, type: 'flight', template: 'air-boarding-pass', ticketNumber: '999-0000000001',
  origin, destination, departureDate: '2026-11-28', ...fields
});
const tag = { baggageTagNumbers: '0123456789', checkedBaggageCount: '1', checkedBaggageWeight: '9.75' };

test('later manual legs supply one sticker on the first boarding pass, independent of display selection', () => {
  const first = flight('first', 'PEK', 'SHA', { ticketNumber: '9990000000001/1' });
  const second = flight('second', 'SHA', 'HND', { ticketNumber: '9990000000001/2', ...tag });
  const third = flight('third', 'HND', 'SFO');
  const index = boardingBaggageIndex([third, second, first]);
  const firstFace = withBoardingBaggage(first, index);
  const secondFace = withBoardingBaggage(second, index);
  assert.match(ticketSVG(firstFace), /TO: SFO<.*VIA: SHA \/ HND</s);
  assert.match(ticketSVG(firstFace), /BAG: 01\/9\.75</);
  assert.equal(ticketDimensions(firstFace).height, 671);
  assert.equal(ticketDimensions(secondFace).height, 500);
  assert.doesNotMatch(ticketSVG(secondFace), /data-boarding-baggage-sticker/);
  assert.doesNotMatch(ticketSVG(withBoardingBaggage(third, index)), /data-boarding-baggage-sticker/);
  assert.equal(first.baggageTagNumbers, '');
  assert.equal(second.baggageTagNumbers, tag.baggageTagNumbers);
});

test('a multi-leg original supplies the order and final airport before every leg is saved', () => {
  const boardingCode = multilegCode(), common = { boardingCode, boardingCodeSource: 'original', departureDate: '2025' };
  const first = flight('first', 'PEK', 'PVG', { ...common, service: 'CA1234', boardingLegIndex: '0' });
  const second = flight('second', 'PVG', 'SFO', { ...common, ...tag, service: 'UA857', boardingLegIndex: '1' });
  const pending = boardingBaggageIndex([second]);
  assert.deepEqual(pending.get('second'), { sticker: null, laterLeg: true });
  const full = boardingBaggageIndex([second, first]);
  assert.match(ticketSVG(withBoardingBaggage(first, full)), /TO: SFO<.*VIA: PVG</s);
  assert.equal(full.get('first').sticker.checkedBaggageWeight, '9.75');
  assert.deepEqual(full.get('second'), { sticker: null, laterLeg: true });
});

test('return trips and distant flights keep their own stickers even when the ticket number is reused', () => {
  const first = flight('first', 'PEK', 'HND', { ...tag, departureTime: '09:00' });
  const back = flight('back', 'HND', 'PEK', { ...tag, departureTime: '16:00' });
  const later = flight('later', 'HND', 'SFO', { ...tag, departureDate: '2026-12-04' });
  const index = boardingBaggageIndex([back, later, first]);
  for (const record of [first, back, later]) {
    assert.equal(index.get(record.id).sticker.to, record.destinationCode);
    assert.equal(index.get(record.id).sticker.via, '');
  }
});
