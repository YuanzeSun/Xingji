import { AIRCRAFT_ALIASES } from './data/aircraft-reference.js';

const clean = value => String(value || '').normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').trim();
const key = value => clean(value).toUpperCase().replace(/[\s.-]/g, '');
const aliases = new Map();
for (const [model, names] of Object.entries(AIRCRAFT_ALIASES)) for (const name of [model, ...names]) aliases.set(key(name), model);
const manufacturer = /^(?:AIRBUS|空中客车|空客|BOEING|波音|DE\s*HAVILLAND(?:\s*CANADA)?|(?:加拿大)?德[·・\s-]?哈维兰|BOMBARDIER|庞巴迪|CANADAIR|EMBRAER|巴西航空工业(?:公司)?|巴航工业|巴航|COMAC|中国商飞|商飞|MCDONNELL[\s-]*DOUGLAS|麦道)\s*/i;

// Only recognized identities are canonicalized. Unknown handwritten types remain usable.
export function identifyAircraft(value) {
  const text = clean(value).replace(/^(?:AIRBUS|空客|空中客车)\s*(?=\d{3})/i, 'A').replace(manufacturer, '').replace(/\((?:大|中|小|大型|中型|小型|窄体|宽体)(?:客机|飞机)?\)/g, '').trim();
  const code = key(text), alias = aliases.get(code);
  if (alias) return alias;
  let match;
  if ((match = code.match(/^(?:DHC|DASH)([678])(?:Q?([1-4]\d{2}))?(?:DASH8Q?)?$/))) return `DHC-${match[1]}${match[2] ? '-' + match[2] : ''}`;
  if ((match = code.match(/^ATR(42|72)(\d{3}[A-Z]?)?$/))) return `ATR ${match[1]}${match[2] ? '-' + match[2] : ''}`;
  if ((match = code.match(/^(?:E|ERJ|EMB)?(170|175|190|195)(E2|LR|AR|STD)?$/))) return `E${match[1]}${match[2] ? '-' + match[2] : ''}`;
  if ((match = code.match(/^(?:ERJ|EMB)(135|140|145)(LR|ER|XR|EP|EU)?$/))) return `ERJ-${match[1]}${match[2] ? '-' + match[2] : ''}`;
  if ((match = code.match(/^CRJ(1000|100|200|550|700|701|702|705|900)(ER|LR)?$/))) return `CRJ-${match[1]}${match[2] ? match[2] : ''}`;
  if ((match = code.match(/^B?737(?:MAX(7|8|9|10)|(7|8|9|10)MAX)$/))) return `737 MAX ${match[1] || match[2]}`;
  if ((match = code.match(/^A(220|300|310|318|319|320|321|330|340|350|380)(NEO|CEO|[1-9]\d{1,3}[A-Z]{0,3})?(\([A-Z]{1,5}\))?$/))) return `A${match[1]}${match[2] ? /NEO|CEO/.test(match[2]) ? match[2].toLowerCase() : '-' + match[2] : ''}${match[3] || ''}`;
  if ((match = code.match(/^B?(707|717|727|737|747|757|767|777|787)(\d{1,3}[A-Z]{0,3}|SP|SR)?(\([A-Z]{1,5}\))?$/))) return `${match[1]}${match[2] ? /SP|SR/.test(match[2]) ? match[2] : '-' + match[2] : ''}${match[3] || ''}`;
  if ((match = code.match(/^(MD|DC)(\d{1,2})(\d{2})?$/))) return `${match[1]}-${match[2]}${match[3] ? '-' + match[3] : ''}`;
  if ((match = code.match(/^(?:SAAB|SF)(340|2000)([AB])?$/))) return `SAAB ${match[1]}${match[2] || ''}`;
  if ((match = code.match(/^BAE146(100|200|300)?$/))) return `BAe 146${match[1] ? '-' + match[1] : ''}`;
  if ((match = code.match(/^(?:AVRO)?RJ(70|85|100)$/))) return `Avro RJ${match[1]}`;
  if ((match = code.match(/^(IL|TU|AN|YAK)(\d{2,3})(\d{2,3})?$/))) return `${match[1]}-${match[2]}${match[3] ? '-' + match[3] : ''}`;
  if (/^C(?:909|919)$/.test(code)) return code;
  return '';
}

export function normalizeAircraft(value) {
  return identifyAircraft(value) || String(value || '').trim();
}

// Group only recognized variants; ambiguous equipment codes and handwritten names stay distinct.
export function aircraftSeries(value) {
  const model=identifyAircraft(value);
  if (!model) return normalizeAircraft(value);
  const prefixes=[/^(A\d{3}|7\d{2})/,/^(DHC-[678])/,/^(ATR (?:42|72))/,/^(E(?:170|175|190|195))/,/^(ERJ-(?:135|140|145))/,/^(SAAB (?:340|2000))/,/^(BAe 146)/,/^((?:MD|DC|IL|TU|AN|YAK)-\d{1,3})(?:-|$)/];
  for(const pattern of prefixes){const match=model.match(pattern);if(match)return match[1];}
  const crj=model.match(/^CRJ-(\d{3,4})/);
  if(crj)return 'CRJ-'+(['701','702','705'].includes(crj[1])?'700':crj[1]);
  return model;
}

// Numeric reservation-system codes belong to labelled fields, not free OCR text:
// otherwise a fare such as 738 could be mistaken for a Boeing 737-800.
