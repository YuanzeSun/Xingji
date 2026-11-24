import { AIRCRAFT_MODELS, AIRCRAFT_SERIES, SCOPED_AIRCRAFT_CODES, SHARED_AIRCRAFT_CODES } from './data/aircraft-reference.js';

const key = text => text.toUpperCase().replace(/[\s.-]/g, '');
const manufacturer = /^(?:AIRBUS|空中客车|空客|BOEING|波音|DE\s*HAVILLAND(?:\s*CANADA)?|(?:加拿大)?德[·・\s-]?哈维兰|BOMBARDIER|庞巴迪|CANADAIR|EMBRAER|巴西航空工业(?:公司)?|巴航工业|巴航|COMAC|中国商飞|商飞|MCDONNELL[\s-]*DOUGLAS|麦道)\s*/i;
const configuration = /\((?:BW|WL|SHARKLETS?)\)$/;
const seriesPrefixes = [/^(A\d{3}|7\d{2})/, /^(DHC-[678])/, /^(ATR (?:42|72))/, /^(E(?:170|175|190|195))/,
  /^(ERJ|CRJ)-/, /^(SAAB (?:340|2000))/, /^(BAe 146)/, /^((?:MD|DC|IL|TU|AN|YAK)-\d{1,3})(?:-|$)/];

function aircraftSeries(model) {
  for (const pattern of seriesPrefixes) {
    const match = model.match(pattern);
    if (match) return match[1];
  }
  return model;
}

const aircraftByName = new Map();
const aircraftByIcaoCode = new Map();
function addAircraft(name, aliases, models, icaoCodes = []) {
  const series = aircraftSeries(models[0] || name);
  const label = models.length === 1 ? models[0] : name + '（子型号未确认）';
  const aircraft = { name, series, label, models };
  for (const input of [name, ...aliases]) aircraftByName.set(key(input), aircraft);
  for (const code of icaoCodes) {
    aircraftByName.set(code, aircraft);
    aircraftByIcaoCode.set(code, aircraft);
  }
}

for (const [name, { aliases = [], variants = [], icao = [] }] of Object.entries(AIRCRAFT_MODELS)) {
  const models = [name];
  addAircraft(name, aliases, models, icao);
  for (const variant of variants) addAircraft(variant, [], models);
}
for (const [name, aliases] of Object.entries(AIRCRAFT_SERIES)) addAircraft(name, aliases, []);
for (const [name, { aliases = [], models, icao }] of Object.entries(SHARED_AIRCRAFT_CODES)) {
  addAircraft(name, aliases, models, icao ? [name] : []);
}

export function aircraftClassification(value) {
  const text = String(value ?? '').normalize('NFKC').replace(/[‐‑‒–—−]/g, '-').trim()
    .replace(/^(?:AIRBUS|空客|空中客车)[\s-]*(?=\d{3})/i, 'A')
    .replace(/^(?:EMBRAER|巴西航空工业(?:公司)?|巴航(?:工业)?)[\s-]*(?=1(?:70|75|90|95)\b)/i, 'E')
    .replace(manufacturer, '').replace(/\((?:大|中|小|大型|中型|小型|窄体|宽体)(?:客机|飞机)?\)/g, '').trim();
  const scoped = /^(ICAO|南航布局)(?:\s*:\s*|\s+)([A-Z0-9]+)$/i.exec(text);
  if (scoped) {
    const scope = scoped[1].toUpperCase(), code = scoped[2].toUpperCase();
    const name = SCOPED_AIRCRAFT_CODES[scope][code];
    if (name) return aircraftByName.get(key(name));
    return scope === 'ICAO' ? aircraftByIcaoCode.get(code) ?? null : null;
  }

  const code = key(text);
  const suffix = configuration.exec(code)?.[0] || '';
  const base = code.replace(configuration, '');
  const aircraft = aircraftByName.get(base) || (/^B7\d{2}/.test(base) ? aircraftByName.get(base.slice(1)) : null);
  if (!aircraft) return null;
  return suffix ? { ...aircraft, name: aircraft.name + suffix } : aircraft;
}

export function normalizeAircraft(value) {
  return aircraftClassification(value)?.name ?? String(value ?? '').trim();
}

export function reconcileAircraft(values) {
  const candidates = Array.from(values, aircraftClassification).filter(Boolean);
  const first = candidates[0];
  if (!first) return { name: '', conflicts: [] };
  const constrained = candidates.filter(candidate => candidate.models.length);
  const common = constrained[0]?.models.filter(model => constrained.every(candidate => candidate.models.includes(model)));
  if (candidates.some(candidate => candidate.series !== first.series) || common?.length === 0) {
    return { name: '', conflicts: [...new Set(candidates.map(candidate => candidate.name))] };
  }
  if (common?.length === 1) {
    const model = common[0];
    const details = new Set(constrained.filter(candidate => candidate.models.length === 1 && candidate.name !== model)
      .map(candidate => candidate.name));
    return { name: details.size === 1 ? [...details][0] : model, conflicts: [] };
  }
  return { name: constrained[0]?.name || first.name, conflicts: [] };
}
