import { boardingMetadataValues } from './boarding-metadata.js';
import { createRecord } from './model.js';
import { resolvePlace } from './places.js';
import { readBCBP } from './bcbp-reader.js';
import { airlineNameForCode } from './airline-codes.js';
import { markFieldSources } from './field-sources.js';
import { normalizeBoardingCode } from './boarding-code.js';
import { codeBytes } from './barcode-data.js';

export function boardingScanRecords(label, { boardingCodes = [], boardingPayloads = [] } = {}) {
  const codes = new Map();
  for (const source of [...boardingPayloads, ...boardingCodes]) {
    try {
      const data = typeof source === 'string' ? null : normalizeBoardingCode(source);
      const payload = data ? String.fromCharCode(...codeBytes(data.rawBytes)) : source;
      const read = readBCBP(payload);
      if (!read) continue;
      // Paper and electronic copies can differ in the electronic-ticket flag.
      const key = payload.slice(0, 22) + ' ' + payload.slice(23);
      if (data || !codes.has(key)) codes.set(key, { data, read });
    } catch { /* A damaged symbol does not define a flight. */ }
  }
  if (codes.size !== 1) return [];
  const sources = [{ kind: 'scan', label }];
  const { data, read } = codes.values().next().value;
  return read.legs.map((leg, index) => {
    const values = {
      type: 'flight', template: 'air-boarding-pass',
      service: leg.service, pnr: leg.pnr, passenger: leg.passengerChinese || leg.passenger,
      originCode: leg.originCode, destinationCode: leg.destinationCode,
      airline: airlineNameForCode(leg.carrier), seat: leg.seat, seatClass: leg.cabin,
      departureDate: { year: null, dayOfYear: leg.dayOfYear },
      ticketNumber: leg.ticketNumber, gate: leg.gate, ...boardingMetadataValues(leg),
      ...(data ? { boardingCode: data, boardingCodeSource: 'original', boardingLegIndex: String(index) } : {})
    };
    for (const side of ['origin', 'destination']) {
      values[side] = resolvePlace({ type: 'flight', [side]: values[side + 'Code'] }, side).name || values[side + 'Code'];
    }
    markFieldSources(values, Object.keys(values).filter(key => values[key] && !['type', 'template'].includes(key)), 'barcode');
    return createRecord({ ...values, sources, provenance: 'reconstruction' });
  });
}
