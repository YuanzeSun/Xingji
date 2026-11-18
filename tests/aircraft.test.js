import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { identifyAircraft, normalizeAircraft, extractAircraft, aircraftMentions } from '../src/aircraft.js';
import { AIRCRAFT_ALIASES } from '../src/data/aircraft-reference.js';
import { createRecord, archive, readArchive } from '../src/model.js';
import { parseText, mapFlightResult } from '../src/importers.js';
import { parseFlightScreenshot } from '../src/flight-screenshot.js';
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
  ['Boeing 737-85C(WL)', '737-85C(WL)'], ['B738', '737-800'], ['B737', '737'],
  ['737 MAX 8', '737 MAX 8'], ['Boeing 737-8 MAX', '737 MAX 8'], ['B77W', '777-300ER']
];

test('regional, turboprop and mainline aircraft share canonical names without losing explicit variants', () => {
  for (const [input, expected] of examples) {
    assert.equal(normalizeAircraft(input), expected, input);
    assert.equal(normalizeAircraft(expected), expected, `Idempotent: ${expected}`);
  }
  for (const [model, names] of Object.entries(AIRCRAFT_ALIASES)) for (const name of [model, ...names]) assert.equal(normalizeAircraft(name), model, name);
  for (const value of ['CRJ7', 'CRJ9', 'E135']) assert.equal(normalizeAircraft(value), value);
  assert.equal(normalizeAircraft('  我的其他机型 X-900  '), '我的其他机型 X-900');
  assert.equal(identifyAircraft('我的其他机型 X-900'), '');
  assert.notEqual(normalizeAircraft('DHC-8'), normalizeAircraft('Q400'));
  assert.notEqual(normalizeAircraft('DHC-8-402'), normalizeAircraft('Q400'));
});

test('OCR finds additional types and labelled equipment codes without treating fares, seats or registrations as aircraft', () => {
  for (const [input, expected] of examples) assert.equal(extractAircraft(`机型：${input}`), expected, input);
  for (const [input, expected] of [['DHC-8', 'DHC-8'], ['Dash 8 Q400', 'DHC-8-400'], ['ATR 72-600', 'ATR 72-600'], ['CRJ900', 'CRJ-900'], ['E195-E2', 'E195-E2'], ['C919', 'C919']]) assert.equal(extractAircraft(input), expected, input);
  assert.equal(extractAircraft('AIRCRAFT TYPE: DH8D'), 'DHC-8-400');
  assert.equal(extractAircraft('空客320'), 'A320'); assert.equal(extractAircraft('BOEING737-800'), '737-800');
  assert.equal(extractAircraft('机型：738'), '737-800');
  for (const text of ['票价738元\n座位12A', '票价737元', '航班号 C919', '飞机编号 B-1900', '注册号 C-GABC', 'PNR DH8D12', 'PNR DHT', '编号 AB-DH8D', '机号 B738', '空客', '庞巴迪']) assert.equal(extractAircraft(text), '', text);
  const mentions = aircraftMentions('  DHC-8 / ATR 72-600');
  assert.deepEqual(mentions.map(row => [row.model, row.index]), [['DHC-8', 2], ['ATR 72-600', 10]]);
});

test('flight screenshots keep one journey when equipment resembles a flight number', () => {
  for (const model of ['DHC-8', 'DH8D', 'ATR72-600', 'E190', 'E195-E2', 'CRJ900', 'C919', 'A320neo', 'MD-82', 'Q400']) {
    const [row, ...extra] = parseFlightScreenshot(`行程详情\n测试航空 CA1234\nPEK -> SHA\n2023-11-18 08:00 10:00\n${model}\n飞机编号 B-0001`);
    assert.equal(extra.length, 0, model); assert.equal(row.service, 'CA1234', model);
    assert.equal(row.aircraft, normalizeAircraft(model), model); assert.equal(row.aircraftRegistration, 'B-0001');
  }
  const rows = parseFlightScreenshot('历史行程\nCA1234\nPEK -> SHA\n2023-11-18 08:00 10:00\nDHC-8\n航班点评\nMU5678\nSHA -> PEK\n2023-11-19 08:00 10:00\nE190\n航班点评');
  assert.deepEqual(rows.map(row => [row.service, row.aircraft]), [['CA1234', 'DHC-8'], ['MU5678', 'E190']]);
  const labelled = parseFlightScreenshot('行程详情\n航班号 C919\nPEK -> SHA\n2023-11-18 08:00 10:00\n机型: DHC-8');
  assert.equal(labelled[0].service, 'C919'); assert.equal(labelled[0].aircraft, 'DHC-8');
  for (const model of ['TU-154', 'IL-114', 'AN-148', 'E-195']) {
    const [row] = parseFlightScreenshot(`行程详情\nCA1234\nPEK -> SHA\n2023-11-18 08:00 10:00\n${model}`);
    assert.equal(row.aircraft, normalizeAircraft(model)); assert.equal(row.aircraftRegistration, '', model);
    const [registered] = parseFlightScreenshot(`行程详情\nCA1234\nPEK -> SHA\n2023-11-18 08:00 10:00\n${model}\nC-GABC`);
    assert.equal(registered.aircraftRegistration, 'C-GABC', model);
  }
});

test('text, JSON, backups and rendered boarding passes retain canonical aircraft', () => {
  const [text] = parseText('机型: E190\n航班: CA1234\n日期: 2023-11-18\n出发机场: PEK\n到达机场: SHA');
  assert.equal(text.service, 'CA1234'); assert.equal(text.aircraft, 'E190');
  const [paragraphs] = parseText('航班: CA1234\n\n机型: C919\n日期: 2023-11-18\n出发机场: PEK\n到达机场: SHA');
  assert.equal(paragraphs.service, 'CA1234'); assert.equal(paragraphs.originCode, 'PEK'); assert.equal(paragraphs.aircraft, 'C919');
  const [unknown] = parseText('航班: CA1234\n机型: X-900\n备注: 我也坐过 A320');
  assert.equal(unknown.aircraft, 'X-900');
  for (const input of ['DHC-8', 'Q400', 'ATR 72-600', 'Embraer E195-E2', 'CRJ900']) {
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

test('aircraft statistics combine equivalent names and preserve unspecified families and explicit subtypes', () => {
  const inputs = ['Q400', 'DH8D', '庞巴迪 Dash 8 Q400', 'DHC-8', 'DHC-8-402', 'E195-E2', 'E295', 'AT76', 'ATR72-600'];
  // Raw records also exercise downloaded older spelling without rewriting any input object.
  const records = inputs.map((aircraft, index) => ({ ...createRecord({ id: 'type-' + index, type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'SHA', departureDate: '2023-11-18' }), aircraft }));
  const before = JSON.stringify(records), data = journeyStatistics(records, { dateTo: '2023-12-31' });
  assert.equal(data.flight, inputs.length);
  const counts = Object.fromEntries(data.aircraft.map(row => [row.name, row.count]));
  assert.deepEqual(counts, { 'DHC-8-400': 3, 'ATR 72-600': 2, 'E195-E2': 2, 'DHC-8': 1, 'DHC-8-402': 1 });
  assert.equal(JSON.stringify(records), before);
});

test('series statistics merge recognized subtypes without combining neighboring models or inventing ambiguous codes',async()=>{
  const {aircraftSeries}=await import('../src/aircraft.js');
  for(const [input,series] of [['737-200','737'],['B738','737'],['737 MAX 9','737'],['A320neo','A320'],['A320-214','A320'],['A321-211','A321'],['Dash 8 Q400','DHC-8'],['DHC-8-402','DHC-8'],['DHC-6-400','DHC-6'],['ATR72-600','ATR 72'],['ATR 42-320','ATR 42'],['E195-E2','E195'],['E190-LR','E190'],['CRJ-702','CRJ-700'],['CRJ-900','CRJ-900'],['CRJ7','CRJ7'],['E135','E135'],['my custom type','my custom type']])assert.equal(aircraftSeries(input),series,input);
});
