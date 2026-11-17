import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORTS } from '../src/data/location-reference.js';
import { AIRPORT_TIMEZONES } from '../src/data/airport-timezones.js';
import { createRecord } from '../src/model.js';
import { includeCountryBoundary } from '../scripts/map-boundaries.mjs';
import { MAP_REFERENCE } from '../src/data/map-reference.js';

test('every supported airport has a valid IANA zone, including Chinese civil aviation and international offsets', () => {
  for (const [code] of AIRPORTS) assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: AIRPORT_TIMEZONES[code] }).format(0), code);
  for (const [code, zone] of Object.entries({ PEK: 'Asia/Shanghai', URC: 'Asia/Shanghai', LXA: 'Asia/Shanghai', HND: 'Asia/Tokyo', JFK: 'America/New_York', LAX: 'America/Los_Angeles', LHR: 'Europe/London', KTM: 'Asia/Kathmandu', SYD: 'Australia/Sydney', HNL: 'Pacific/Honolulu' })) assert.equal(AIRPORT_TIMEZONES[code], zone);
  const localHour = date => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', timeZone: AIRPORT_TIMEZONES.JFK }).format(new Date(date));
  assert.equal(localHour('2026-07-01T16:00:00Z'), '12');
  assert.equal(localHour('2026-01-01T16:00:00Z'), '11');
});

test('airport identities determine both zones, replacing stale values and clearing unresolved locations', () => {
  const flight = createRecord({ type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'JFK', departureZone: 'Europe/London', arrivalZone: 'Asia/Shanghai' });
  assert.equal(flight.departureZone, 'Asia/Shanghai'); assert.equal(flight.arrivalZone, 'America/New_York');
  const changed = createRecord({ ...flight, destination: '未知机场', destinationCode: '' });
  assert.equal(changed.arrivalZone, '');
});

test('map uses the CN boundary classification and omits unresolved, unrecognized and control lines', () => {
  const include = properties => includeCountryBoundary({ properties });
  assert.equal(include({ FEATURECLA: 'Disputed (please verify)', FCLASS_CN: 'Unrecognized' }), false, 'Zangnan disputed line is not rendered as an ordinary border');
  assert.equal(include({ FEATURECLA: 'International boundary (verify)', FCLASS_CN: 'Unrecognized' }), false);
  assert.equal(include({ FEATURECLA: 'Disputed (please verify)', FCLASS_CN: 'International boundary (verify)' }), true);
  for (const FEATURECLA of ['Disputed (please verify)', 'Line of control (please verify)', 'Indefinite (please verify)']) assert.equal(include({ FEATURECLA }), false);
  assert.equal(include({ FEATURECLA: 'International boundary (verify)' }), true);
  assert.equal(MAP_REFERENCE.boundaryView, 'CN');
  assert.equal(MAP_REFERENCE.disputedBoundaries, 'china-view');assert.ok(MAP_REFERENCE.cnClaimBoundaryIds.includes(1746705431),'Chinese claim around Zangnan must be included');
});
