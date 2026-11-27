import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { aircraftClassification, normalizeAircraft, reconcileAircraft } from '../src/aircraft.js';
import { AIRCRAFT_MODELS } from '../src/data/aircraft-reference.js';
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
  ['220', 'A220'], ['300', 'A300'], ['310', 'A310'], ['318', 'A318'], ['319', 'A319'],
  ['320', 'A320'], ['321', 'A321'], ['330', 'A330'], ['340', 'A340'], ['350', 'A350'], ['380', 'A380'],
  ['330-243', 'A330-243'], ['３３０－３４３', 'A330-343'], ['321-253NY', 'A321-253NY'],
  ['空中客车A330-300', 'A330-300'], ['波音 737-85C(WL)', '737-85C(WL)'],
  ['Boeing 737-85C(WL)', '737-85C(WL)'], ['Boeing 737-8Q8(WL)', '737-8Q8(WL)'], ['B738', '737-800'], ['B737', '737'],
  ['737 MAX 8', '737 MAX 8'], ['Boeing 737-8 MAX', '737 MAX 8'], ['B77W', '777-300ER']
];

test('regional, turboprop and mainline aircraft share canonical names without losing explicit variants', () => {
  for (const [input, expected] of examples) {
    assert.equal(normalizeAircraft(input), expected, input);
    assert.equal(normalizeAircraft(expected), expected, `Idempotent: ${expected}`);
  }
  for (const [model, { aliases = [], variants = [], icao = [] }] of Object.entries(AIRCRAFT_MODELS)) {
    for (const name of [model, ...aliases]) assert.equal(normalizeAircraft(name), model, name);
    for (const code of icao) {
      assert.equal(normalizeAircraft(code), model, code);
      assert.equal(normalizeAircraft('ICAO: ' + code), model, code);
    }
    for (const name of variants) {
      assert.equal(normalizeAircraft(name), name, name);
      assert.equal(aircraftClassification(name)?.label, model, name);
    }
  }
  for (const value of ['CRJ7', 'CRJ9', 'E135']) assert.equal(normalizeAircraft(value), value);
  assert.equal(normalizeAircraft('  我的其他机型 X-900  '), '我的其他机型 X-900');
  assert.equal(aircraftClassification('我的其他机型 X-900'), null);
  assert.equal(normalizeAircraft('Boeing 737-8ZZ'), 'Boeing 737-8ZZ');
  assert.notEqual(normalizeAircraft('DHC-8'), normalizeAircraft('Q400'));
  assert.notEqual(normalizeAircraft('DHC-8-402'), normalizeAircraft('Q400'));
});

test('provider history, backups and rendered boarding passes retain canonical aircraft', () => {
  for (const input of ['737-8Q8', '330', 'Airbus A321-253NY', 'DHC-8', 'Q400', 'ATR 72-600', 'Embraer E195-E2', 'CRJ900']) {
    const record = createRecord({ type: 'flight', template: 'air-boarding-pass', service: 'CA1234', origin: 'PEK', destination: 'SHA', aircraft: input });
    const expected = normalizeAircraft(input);
    assert.equal(record.aircraft, expected);
    for (const imported of [readArchive(archive([record]))[0], mapFlightResult([{ aircraft: input }])[0]]) assert.equal(imported.aircraft, expected);
    for (const origin of ['PEK', 'LHR']) {
      const dom = new JSDOM(ticketSVG({ ...record, origin, originCode: origin }), { contentType: 'image/svg+xml' });
      assert.equal(dom.window.document.querySelector('[data-boarding-aircraft]').lastElementChild.textContent, expected);
      dom.window.close();
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
    'A320-214', 'A320-271N', 'A20N', 'A330-343', 'A333', '330', 'Q400', 'DH8D', 'DHC-8', 'DHC-8-402',
    'E195-E2', 'E295', 'CRJ7', 'AT76', 'ATR72-600', 'A320-999', '73Q', ''];
  const records = inputs.map((aircraft, index) => ({ ...createRecord({ id: 'type-' + index, type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'SHA', departureDate: '2023-11-18' }), aircraft }));
  const before = JSON.stringify(records), data = journeyStatistics(records, { dateTo: '2023-12-31' });
  assert.equal(data.flight, inputs.length);
  const counts = Object.fromEntries(data.aircraft.map(row => [row.name, row.count]));
  assert.deepEqual(counts, { '737-800': 4, '737（子型号未确认）': 1, '737-700': 1, '737 MAX 8': 3,
    A320ceo: 1, A320neo: 2, 'A330-300': 2, 'A330（子型号未确认）': 1, 'DHC-8-400': 3, 'DHC-8（子型号未确认）': 1,
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

// Independent expectations from FAA SAGE, JO 7360.1K, ICAO Doc 8643 and the manufacturers.
const referenceCases = [
  ['330-243', 'A330-200'],
  ['737-112', '737-100'], ['737-2H4', '737-200'], ['737-3Q8', '737-300'],
  ['737-46J', '737-400'], ['737-5H4', '737-500'], ['737-6Q8', '737-600'],
  ['737-724', '737-700'], ['737-824', '737-800'], ['737-832', '737-800'],
  ['737-85F', '737-800'], ['737-86J', '737-800'], ['737-8Q8', '737-800'],
  ['737-89P', '737-800'], ['737-800BCF', '737-800'],
  ['737-924', '737-900'], ['737-924ER', '737-900ER'],
  ['737-7', '737 MAX 7'], ['737-8', '737 MAX 8'], ['737-8-200', '737 MAX 8'],
  ['737-9', '737 MAX 9'], ['737-10', '737 MAX 10'],
  ['ICAO: B731', '737-100'], ['ICAO B738', '737-800'], ['ICAO B38M', '737 MAX 8'],
  ['ICAO B741', '747-100'], ['ICAO B742', '747-200'], ['ICAO B77W', '777-300ER'],
  ['ICAO A318', 'A318'], ['ICAO A321', 'A321ceo'], ['ICAO A21N', 'A321neo'], ['A321-253NY', 'A321neo'],
  ['ICAO BCS3', 'A220-300'], ['A223', 'A220-300'], ['BD-500-1A10', 'A220-100'],
  ['ICAO E75L', 'E175'], ['ERJ-190-300', 'E190-E2'], ['ERJ-190-400', 'E195-E2'],
  ['ICAO DH8D', 'DHC-8-400'], ['ICAO AT76', 'ATR 72-600'],
  ['ICAO AJ27', 'C909'], ['ICAO C919', 'C919'], ['ICAO MA60', 'MA60'], ['ICAO MD11', 'MD-11'],
];

for (const [input, expected] of referenceCases) {
  test(`aircraft reference check: ${input} → ${expected}`, () => {
    const classification = aircraftClassification(input);
    assert.equal(classification?.label, expected);
    assert.deepEqual(classification?.models, [expected]);
    assert.deepEqual(aircraftClassification(normalizeAircraft(input)), classification);
  });
}

test('an explicit ICAO prefix requires a verified designator for the aircraft', () => {
  for (const input of ['ICAO A223', 'ICAO A221', 'ICAO A350', 'ICAO E75', 'ICAO DH4', 'ICAO AT7',
    'ICAO 738', 'ICAO 7M8', 'ICAO C909', 'ICAO ZZZZ']) {
    assert.equal(aircraftClassification(input), null, input);
    assert.equal(normalizeAircraft(input), input);
  }
  assert.equal(aircraftClassification('ICAO A310')?.series, 'A310');
  assert.equal(aircraftClassification('ICAO B739')?.models.length, 2);
  for (const [input, label] of [['E75', 'E175'], ['DH4', 'DHC-8-400'], ['AT7', 'ATR 72（子型号未确认）']]) {
    assert.equal(aircraftClassification(input)?.label, label);
  }
});

test('shared flight-plan codes keep all covered submodels until a specific one is confirmed', () => {
  for (const [code, models] of [
    ['AT43', ['ATR 42-300', 'ATR 42-320']], ['AT72', ['ATR 72-201', 'ATR 72-202']],
    ['AT73', ['ATR 72-211', 'ATR 72-212']], ['B77L', ['777-200LR', '777F']],
    ['CRJ7', ['CRJ-550', 'CRJ-700']], ['E135', ['ERJ-135', 'ERJ-140']],
  ]) {
    assert.deepEqual(aircraftClassification('ICAO ' + code)?.models, models);
    assert.equal(aircraftClassification(code)?.label, code + '（子型号未确认）');
    assert.deepEqual(reconcileAircraft([code, models[1]]), { name: models[1], conflicts: [] });
  }
});

test('bilingual manufacturer names, winglet markers and full-width inputs retain the model detail', () => {
  for (const [input, name, label] of [
    ['波音　７３７－８６Ｊ（ＢＷ）', '737-86J(BW)', '737-800'],
    ['boeing 737–8q8 (wl)', '737-8Q8(WL)', '737-800'],
    ['AIRBUS-320-214', 'A320-214', 'A320ceo'],
    ['巴航工业１９０', 'E190', 'E190'],
    ['EMBRAER-195-E2', 'E195-E2', 'E195-E2'],
  ]) {
    assert.equal(normalizeAircraft(input), name, input);
    assert.equal(aircraftClassification(input)?.label, label, input);
  }
  for (const input of ['737-8ZZ', '737-8Q9', '737-8100', 'A321-111N', 'COMAC', '']) {
    assert.equal(aircraftClassification(input), null, input);
  }
});

test('aircraft reconciliation uses the most specific supported name regardless of source order', () => {
  for (const [inputs, expected] of [
    [['737-8Q8', 'B738', 'B737'], '737-8Q8'],
    [['737-8Q8', 'B738', '737-85C'], '737-800'],
    [['737-924ER', 'B739', 'B737'], '737-924ER'],
    [['A321', 'A21N', 'A321XLR'], 'A321XLR'],
    [['330', 'A333', 'A330-343'], 'A330-343'],
    [['ATR 72-212A', 'AT76', 'AT7'], 'ATR 72-600'],
  ]) {
    assert.deepEqual(reconcileAircraft(inputs), { name: expected, conflicts: [] });
    assert.deepEqual(reconcileAircraft([...inputs].reverse()), { name: expected, conflicts: [] });
  }
  for (const inputs of [['737-8Q8', '737-8'], ['A321-211', 'A21N'], ['E195', 'E295'], ['B738', 'A320']]) {
    for (const order of [inputs, [...inputs].reverse()]) {
      const { name, conflicts } = reconcileAircraft(order);
      assert.equal(name, '');
      assert.deepEqual(new Set(conflicts), new Set(inputs.map(normalizeAircraft)));
    }
  }
});

test('verified registration variants survive provider completion, saving, rendering and statistics', () => {
  const lookupRows = [
    ['737-86J', 738, '737-86J'],
    ['737-8Q8', 'B738', '737-8Q8'],
    ['737-8-200', 'B38M', '737-8-200'],
    ['A321-253NY', 'A21N', 'A321-253NY'],
  ];
  const records = lookupRows.map(([miniAirplaneModels, generic, expected], index) => {
    const service = 'CA123' + index, departureDate = '2023-11-18';
    const [candidate] = flightCandidates({ structuredContent: { kind: 'collection', items: [{
      FlightNo: service, FlightDepcode: 'PEK', FlightArrcode: 'SHA', FlightDeptimePlanDate: departureDate + ' 08:00:00',
      miniAirplaneModels, generic
    }] } }, { service, departureDate });
    assert.equal(candidate.aircraft, expected);
    const [imported] = mapFlightResult([{ aircraft: miniAirplaneModels }]);
    assert.equal(imported.aircraft, expected);
    return createRecord(candidate);
  });
  const restored = readArchive(archive(records));
  for (const [index, record] of restored.entries()) {
    const expected = lookupRows[index][2];
    assert.equal(record.aircraft, expected);
    const dom = new JSDOM(ticketSVG(record), { contentType: 'image/svg+xml' });
    assert.ok(dom.window.document.querySelector('[data-boarding-aircraft]').textContent.includes(expected));
    dom.window.close();
  }
  for (const [aircraftSubtypes, expected] of [
    [true, { '737-800': 2, '737 MAX 8': 1, A321neo: 1 }],
    [false, { '737': 3, A321: 1 }],
  ]) {
    const { aircraft, unknownAircraft } = journeyStatistics(restored, { aircraftSubtypes, dateTo: '2023-12-31' });
    assert.deepEqual(Object.fromEntries(aircraft.map(({ name, count }) => [name, count])), expected);
    assert.equal(unknownAircraft, 0);
  }
});
