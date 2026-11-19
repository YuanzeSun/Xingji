import test from 'node:test';
import assert from 'node:assert/strict';
import { maskIdentity, maskRailIdentity } from '../src/identity.js';
import { createRecord, archive, readArchive } from '../src/model.js';
import { ticketSVG, exportSVG } from '../src/tickets.js';
import { DEMO_TICKET_CODE } from '../src/demo-code.js';

test('full identities are masked at display time, including a valid X checksum and other document formats', () => {
  for (const [input, expected] of [
    ['000000200001011234','000000********1234'],
    ['00000020000101123x','000000********123X'],
    ['００００００２００００１０１１２３４','000000********1234'],
    ['000000 20000101 1234','000000********1234'],
    ['000000001011234','000000******234'],
    ['E00000000','E0*****00'],
    ['H000000000','H0******00'],
    ['1234','****'],['12','**'],['',''],[undefined,'']
  ]) {
    assert.equal(maskIdentity(input), expected);
  }
});

test('partial identities with ASCII or full-width stars are never rendered as complete identities', () => {
  for (const identity of ['1101011990****1234','110101********1234','E12****89','****','１２＊４５']) {
    assert.equal(maskIdentity(identity), '');
    assert.equal(maskRailIdentity(identity), '');
  }
});

test('rail ticket masks the birth month and day, or the last two or four characters of other documents', () => {
  for (const [input, expected] of [
    ['00000020000101123x', '0000002000****123X'],
    ['００００００ ２００００１０１ １２３４', '0000002000****1234'],
    ['E01234567', 'E012345**'],
    ['AB123456789', 'AB1234567**'],
    ['AB1234567890', 'AB123456****'],
    ['000000001011234', '00000000101****'],
    ['A', '*'], ['12', '**'], ['', '']
  ]) {
    assert.equal(maskRailIdentity(input), expected);
  }
});

test('all rail layouts mask the rendered number without modifying stored records, exports or barcode payloads', async () => {
  const identity = '000000200001011234';
  globalThis.location = { href:'https://example.com/' };
  globalThis.fetch = async () => new Response('font fixture');
  for (const template of ['rail-blue','rail-red','rail-red-classic','rail-receipt']) {
    const record = createRecord({ template, identity, origin:'北京南', destination:'天津', passenger:'示例旅客', service:'C2021', ticketCode:DEMO_TICKET_CODE });
    const before = structuredClone(record);
    for (const output of [ticketSVG(record), await exportSVG(record)]) {
      assert.ok(output.includes('0000002000****1234'), template);
      assert.ok(!output.includes(identity), template);
      assert.ok(output.includes('data-ticket-code'), template);
    }
    assert.deepEqual(record, before);
    assert.equal(readArchive(archive([record]))[0].identity, identity);
  }
  const flight = createRecord({ type:'flight', template:'air-boarding-pass', identity, origin:'北京首都' });
  assert.ok(!ticketSVG(flight).includes(identity));
  assert.equal(flight.identity, identity);
});
