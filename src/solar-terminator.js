import { unwrapLongitude } from './journey-map-model.js';

const dayMs = 86_400_000;
const radians = Math.PI / 180;
const circle = 2 * Math.PI;

export function subsolarPoint(instant) {
  const utc = new Date(instant), year = utc.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1), nextYear = Date.UTC(year + 1, 0, 1);
  const utcMinutes = (utc.getUTCHours() * 60 + utc.getUTCMinutes()) + utc.getUTCSeconds() / 60;
  const days = (nextYear - yearStart) / dayMs;
  // NOAA fractional-year approximation, with noon as the reference for each day.
  // https://gml.noaa.gov/grad/solcalc/solareqns.PDF
  const angle = circle * ((instant - yearStart) / dayMs - .5) / days;
  const sin = Math.sin(angle), cos = Math.cos(angle);
  const sin2 = Math.sin(2 * angle), cos2 = Math.cos(2 * angle);
  const timeOffset = 229.18 * (.000075 + .001868 * cos - .032077 * sin - .014615 * cos2 - .040849 * sin2);
  const declination = .006918 - .399912 * cos + .070257 * sin - .006758 * cos2 + .000907 * sin2
    - .002697 * Math.cos(3 * angle) + .00148 * Math.sin(3 * angle);
  return { longitude: unwrapLongitude(180 - (utcMinutes + timeOffset) / 4, 0), declination };
}

export function solarTerminator(instant, center) {
  const { longitude, declination } = subsolarPoint(instant);
  const left = center - 180, right = center + 180;
  const samples = Array.from({ length: 121 }, (_, index) => left + 3 * index);
  // Near the equinox the line becomes steep around these two meridians.
  for (const offset of [-90, 90]) {
    const meridian = unwrapLongitude(longitude + offset, center);
    for (const step of [-1, -.1, -.01, 0, .01, .1, 1]) {
      samples.push(unwrapLongitude(meridian + step, center));
    }
  }
  const tangent = Math.tan(declination) || Number.EPSILON;
  const x = lon => (lon + 180) / 360 * 1000;
  const points = samples.sort((a, b) => a - b).map(lon => {
    const latitude = Math.atan(-Math.cos((lon - longitude) * radians) / tangent);
    const y = 250 - latitude / circle * 1000;
    return x(lon).toFixed(3) + ',' + y.toFixed(3);
  });
  const boundary = 'M' + points.join('L');
  const pole = declination < 0 ? 0 : 500;
  return { boundary, night: `${boundary}L${x(right)},${pole}H${x(left)}Z` };
}
