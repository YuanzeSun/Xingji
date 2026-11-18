import { JOURNEY_DATE_FIELDS } from '../../src/journey-date.js';
import { FIELDS } from '../../src/model.js';

// Fixtures for importing CSV files from older copies of the app.
export function csv(records) {
  const fields = ['id', 'mergedIds', ...FIELDS.filter(f => !['deleted', 'offsetX', 'offsetY'].includes(f))];
  const cell = value => { let s = String(value ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  return '\uFEFF' + [fields, ...records.filter(r => !r.deleted).map(r => fields.map(f => JOURNEY_DATE_FIELDS.includes(f) ? (r[f] ? JSON.stringify(r[f]) : '') : ['lookupValues', 'fieldSources', 'ticketMarks', 'mergedIds', 'ticketCode', 'boardingCode', 'railRoute', 'railJourney'].includes(f) ? JSON.stringify(r[f] || (['lookupValues','fieldSources'].includes(f) ? {} : ['ticketCode', 'boardingCode', 'railRoute', 'railJourney'].includes(f) ? '' : [])) : r[f]))].map(row => row.map(cell).join(',')).join('\r\n');
}
