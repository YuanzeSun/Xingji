import test from 'node:test';
import assert from 'node:assert/strict';
import { boardingBaggageIndex, occupiedBaggageFields, otherBaggageLegs, withBoardingBaggage } from '../src/boarding-baggage.js';
import { createRecord } from '../src/model.js';
import { ticketDimensions, ticketSVG } from '../src/tickets.js';
import { createBoardingCode, readBoardingCode } from '../src/bcbp.js';

const flight = (id, origin, destination, fields = {}) => createRecord({
  id, type: 'flight', template: 'air-boarding-pass', ticketNumber: '999-0000000001',
  origin, destination, departureDate: '2026-11-28', ...fields
});
const tag = { baggageTagNumbers: '0123456789', checkedBaggageCount: '1', checkedBaggageWeight: '9.75' };

test('later manual legs supply one sticker on the first boarding pass, independent of display selection', () => {
  const first = flight('first', 'PEK', 'SHA', { ticketNumber: '9990000000001/1', service: 'CA1831', departureTime: '09:00' });
  const second = flight('second', 'SHA', 'HND', { ticketNumber: '9990000000001/2', departureTime: '12:00', ...tag });
  const third = flight('third', 'HND', 'SFO', { departureTime: '17:00' });
  const index = boardingBaggageIndex([third, second, first]);
  const firstFace = withBoardingBaggage(first, index);
  const secondFace = withBoardingBaggage(second, index);
  assert.match(ticketSVG(firstFace), /TO: SFO<.*VIA: SHA CA1831 28NOV \/ HND</s);
  assert.match(ticketSVG(firstFace), /BAG: 01\/9\.75</);
  assert.equal(ticketDimensions(firstFace).height, 671);
  assert.equal(ticketDimensions(secondFace).height, 500);
  assert.doesNotMatch(ticketSVG(secondFace), /data-boarding-baggage-sticker/);
  assert.doesNotMatch(ticketSVG(withBoardingBaggage(third, index)), /data-boarding-baggage-sticker/);
  assert.equal(first.baggageTagNumbers, '');
  assert.equal(second.baggageTagNumbers, tag.baggageTagNumbers);
});

test('separate M1 codes with the same ticket number share baggage regardless of dates and airports', () => {
  const common = { passenger: 'LI/MING', carrier: 'CA', pnr: 'ABC123', cabin: 'Y', seat: '8A', sequence: '25', status: '1', ticketNumber: '9990000000001' };
  const original = { boardingCodeSource: 'original', boardingLegIndex: '0' };
  const first = flight('first', 'PEK', 'PVG', { ...original, service: 'CA1234', departureDate: '2025-01-01',
    boardingCode: createBoardingCode({ ...common, origin: 'PEK', destination: 'PVG', flightNumber: '1234', date: '2025-01-01' }) });
  const second = flight('second', 'SHA', 'CTU', { ...original, ...tag, service: 'CA5678', departureDate: '2025-01-09',
    boardingCode: createBoardingCode({ ...common, origin: 'SHA', destination: 'CTU', flightNumber: '5678', date: '2025-01-09' }) });
  assert.equal(readBoardingCode(first.boardingCode).legCount, 1);
  assert.equal(readBoardingCode(second.boardingCode).legCount, 1);
  assert.match(ticketSVG(withBoardingBaggage(second, boardingBaggageIndex([second]))), /TO: CTU CA5678 09JAN<.*VIA:/s);
  const full = boardingBaggageIndex([second, first]);
  assert.match(ticketSVG(withBoardingBaggage(first, full)), /TO: CTU<.*VIA: PVG CA1234 01JAN</s);
  assert.equal(full.get('first').sticker.checkedBaggageWeight, '9.75');
  assert.deepEqual(full.get('second'), { sticker: null, laterLeg: true });
  assert.deepEqual(occupiedBaggageFields(otherBaggageLegs(first, [second, first])), Object.keys(tag));
  assert.deepEqual(occupiedBaggageFields(otherBaggageLegs(second, [second, first])), []);
});

test('flights with distinct ticket numbers keep their own stickers', () => {
  const first = flight('first', 'PEK', 'HND', { ...tag, departureTime: '09:00' });
  const second = flight('second', 'HND', 'SFO', { ...tag, departureTime: '16:00', ticketNumber: '9990000000002' });
  const index = boardingBaggageIndex([second, first]);
  for (const record of [first, second]) {
    assert.equal(index.get(record.id).sticker.to, record.destinationCode);
    assert.deepEqual(index.get(record.id).sticker.via, []);
  }
});
