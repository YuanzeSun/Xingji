import { createHash } from 'node:crypto';

export function airportGeographySource(rows, header, sourceText) {
  const code = header.indexOf('iata_code'), city = header.indexOf('municipality'), continent = header.indexOf('continent');
  if ([code, city, continent].includes(-1)) throw new Error('Airport geography fields are missing');
  const places = new Map();
  for (const row of rows) {
    if (!/^[A-Z]{3}$/.test(row[code]) || !row[city]) continue;
    if (!places.has(row[code])) places.set(row[code], new Set());
    places.get(row[code]).add(row[continent]);
  }
  const groups = Object.fromEntries(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'].map(key => [key, []]));
  for (const [iata, values] of places) if (values.size === 1 && groups[[...values][0]]) groups[[...values][0]].push(iata);
  const metadata = { source: 'https://davidmegginson.github.io/ourairports-data/airports.csv', sha256: createHash('sha256').update(sourceText).digest('hex'), license: 'Public Domain' };
  const data = Object.fromEntries(Object.entries(groups).map(([key, codes]) => [key, codes.sort().join(' ')]));
  return `// Generated alongside location-reference.js by scripts/update-locations.mjs. No personal journeys.\nexport const AIRPORT_GEOGRAPHY_REFERENCE = ${JSON.stringify(metadata)};\n// Airport-level continents preserve transcontinental countries and overseas airports.\nexport const CONTINENT_AIRPORT_CODES = ${JSON.stringify(data)};\n`;
}
