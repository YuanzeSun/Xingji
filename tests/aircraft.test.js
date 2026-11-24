import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { aircraftClassification, identifyAircraft, normalizeAircraft } from '../src/aircraft.js';
import { AIRCRAFT_ALIASES, AIRCRAFT_VARIANTS } from '../src/data/aircraft-reference.js';
import { createRecord, archive, readArchive } from '../src/model.js';
import { mapFlightResult } from '../src/importers.js';
import { flightCandidates } from '../src/flight-lookup-model.js';
import { journeyStatistics } from '../src/statistics-model.js';
import { ticketSVG } from '../src/tickets.js';

const examples = [
  ['dhc-8', 'DHC-8'], ['De Havilland Canada DHC-8-402', 'DHC-8-402'],
  ['Dash 8', 'DHC-8'], ['庞巴迪 Q400', 'DHC-8-400'], ['DHC-8 Q400', 'DHC-8-400'],
  ['Dash 8 Q300', 'DHC-8-300'], ['Dash-8-200', 'DHC-8-200'], ['DH8A', 'DHC-8-100'],
  ['ＤＨＣ－８－４００', 'DHC-8-400'], ['DHC‑8‑400', 'DHC-8-400'],
  ['Twin Otter', 'DHC-6'], ['DHC-6-400', 'DHC-6-400'], ['Dash 7', 'DHC-7'],
  ['ATR72-600', 'ATR 72-600'], ['ATR 42-320', 'ATR 42-320'], ['AT76', 'ATR 72-600'],
  ['Embraer 190', 'E190'], ['巴航工业 ERJ-145', 'ERJ-145'], ['ERJ 140', 'ERJ-140'],
  ['E-195-E2', 'E195-E2'], ['E290', 'E190-E2'], ['EMB 120', 'EMB-120'],
  ['Bombardier CRJ900', 'CRJ-900'], ['Canadair CRJ-1000', 'CRJ-1000'], ['CRJ 550', 'CRJ-550'],
  ['COMAC C919', 'C919'], ['商飞 ARJ21-700', 'C909'], ['C909 (ARJ21)', 'C909'],
  ['Saab 340B', 'SAAB 340B'], ['SF34', 'SAAB 340'], ['SB20', 'SAAB 2000'],
  ['Fokker 50', 'Fokker 50'], ['DO-228', 'Dornier 228'], ['Dornier 328JET', 'Dornier 328JET'],
  ['C208', 'Cessna 208'], ['LET410', 'L-410'], ['SU95', 'SSJ100'], ['新舟60', 'MA60'],
  ['BAe 146-200', 'BAe 146-200'], ['RJ85', 'Avro RJ85'], ['TU-154', 'TU-154'],
  ['Airbus A330-343', 'A330-343'], ['空客320', 'A320'], ['Airbus330-300', 'A330-300'], ['A20N', 'A320neo'], ['BCS3', 'A220-300'],
  ['Boeing 737-85C(WL)', '737-85C(WL)'], ['Boeing 737-8Q8(WL)', '737-8Q8(WL)'], ['B738', '737-800'], ['B737', '737'],
  ['737 MAX 8', '737 MAX 8'], ['Boeing 737-8 MAX', '737 MAX 8'], ['B77W', '777-300ER']
];

test('regional, turboprop and mainline aircraft share canonical names without losing explicit variants', () => {
  for (const [input, expected] of examples) {
    assert.equal(normalizeAircraft(input), expected, input);
    assert.equal(normalizeAircraft(expected), expected, `Idempotent: ${expected}`);
  }
  for (const [model, names] of Object.entries(AIRCRAFT_ALIASES)) for (const name of [model, ...names]) assert.equal(normalizeAircraft(name), model, name);
  for (const [model, variants] of Object.entries(AIRCRAFT_VARIANTS)) for (const name of variants) {
    assert.equal(normalizeAircraft(name), name, name);
    assert.equal(aircraftClassification(name)?.label, model, name);
  }
  for (const value of ['CRJ7', 'CRJ9', 'E135']) assert.equal(normalizeAircraft(value), value);
  assert.equal(normalizeAircraft('  我的其他机型 X-900  '), '我的其他机型 X-900');
  assert.equal(identifyAircraft('我的其他机型 X-900'), '');
  assert.notEqual(normalizeAircraft('DHC-8'), normalizeAircraft('Q400'));
  assert.notEqual(normalizeAircraft('DHC-8-402'), normalizeAircraft('Q400'));
});

test('provider history, backups and rendered boarding passes retain canonical aircraft', () => {
  for (const input of ['737-8Q8', 'A321-253NY', 'DHC-8', 'Q400', 'ATR 72-600', 'Embraer E195-E2', 'CRJ900']) {
    const record = createRecord({ type: 'flight', template: 'air-boarding-pass', service: 'CA1234', origin: 'PEK', destination: 'SHA', aircraft: input });
    const expected = normalizeAircraft(input);
    for (const imported of [readArchive(archive([record]))[0], mapFlightResult([{ aircraft: input }])[0]]) assert.equal(imported.aircraft, expected);
    for (const origin of ['PEK', 'LHR']) {
      const dom = new JSDOM(ticketSVG({ ...record, origin, originCode: origin }), { contentType: 'image/svg+xml' });
      assert.ok(dom.window.document.querySelector('[data-boarding-aircraft]').textContent.includes(expected)); dom.window.close();
    }
  }
});

test('provider completion accepts regional type codes including names without digits', () => {
  for (const input of ['DH8D', 'DHC-8-402', 'AT76', 'CRJ900', 'E295', 'DHT', 'Twin Otter']) {
    const [record] = flightCandidates({ structuredContent: { kind: 'collection', items: [{ FlightNo: 'CA1234', FlightDepcode: 'PEK', FlightArrcode: 'SHA', FlightDeptimePlanDate: '2023-11-18 08:00:00', miniAirplaneModels: input, aircraftType: '庞巴迪' }] } }, { service: 'CA1234', departureDate: '2023-11-18' });
    assert.equal(record.aircraft, normalizeAircraft(input), input);
  }
});

test('aircraft statistics group equivalent spellings and keep generations and unresolved entries distinct', () => {
  const inputs = ['737-8Q8', '8Q8', 'B738', '738', 'B737', 'ICAO B737', '737-8', 'B38M', '737-8-200',
    'A320-214', 'A320-271N', 'A20N', 'A330-343', 'A333', 'Q400', 'DH8D', 'DHC-8', 'DHC-8-402',
    'E195-E2', 'E295', 'CRJ7', 'AT76', 'ATR72-600', 'A320-999', '73Q', ''];
  const records = inputs.map((aircraft, index) => ({ ...createRecord({ id: 'type-' + index, type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'SHA', departureDate: '2023-11-18' }), aircraft }));
  const before = JSON.stringify(records), data = journeyStatistics(records, { dateTo: '2023-12-31' });
  assert.equal(data.flight, inputs.length);
  const counts = Object.fromEntries(data.aircraft.map(row => [row.name, row.count]));
  assert.deepEqual(counts, { '737-800': 4, '737（子型号未确认）': 1, '737-700': 1, '737 MAX 8': 3,
    A320ceo: 1, A320neo: 2, 'A330-300': 2, 'DHC-8-400': 3, 'DHC-8（子型号未确认）': 1,
    'E195-E2': 2, 'CRJ7（子型号未确认）': 1, 'ATR 72-600': 2 });
  assert.equal(data.unknownAircraft, 3);
  assert.equal(JSON.stringify(records), before);
});

test('series and source-specific codes narrow only as far as the evidence allows', () => {
  for (const [input, series] of [['737-200','737'],['B738','737'],['737 MAX 9','737'],['A320neo','A320'],['A320-214','A320'],['A321-211','A321'],['Dash 8 Q400','DHC-8'],['DHC-8-402','DHC-8'],['DHC-6-400','DHC-6'],['ATR72-600','ATR 72'],['ATR 42-320','ATR 42'],['E195-E2','E195'],['E190-LR','E190'],['CRJ-702','CRJ'],['CRJ-900','CRJ'],['CRJ7','CRJ'],['E135','ERJ']]) {
    assert.equal(aircraftClassification(input)?.series, series, input);
  }
  assert.equal(aircraftClassification('ICAO: A320')?.label, 'A320ceo');
  assert.equal(aircraftClassification('南航布局：73Q')?.label, '737-800');
  assert.equal(aircraftClassification('B739')?.label, 'B739（子型号未确认）');
  assert.equal(aircraftClassification('739')?.label, 'B739（子型号未确认）');
  assert.equal(aircraftClassification('ATR72-212A')?.label, 'ATR 72-212A（子型号未确认）');
  for (const input of ['73Q', '737-8ZZ', 'A320-999', 'my custom type']) assert.equal(aircraftClassification(input), null);
});
