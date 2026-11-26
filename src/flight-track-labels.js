import { AIRPORT_POINTS, CITY_POINTS, PROVINCE_LABELS } from './data/map-reference.js';
import { FLIGHT_MAP_CITIES } from './data/flight-map-cities.js';
import { projectPoint } from './journey-map-model.js';
import { resolveCity } from './locations.js';
import { resolvePlace } from './places.js';
import { escape as e } from './html.js';
import { geographicLabelMarkup, mapLabelPlacer, mapLabelText } from './map-labels.js';

export function flightTrackLabelRenderer(record, flightStr, center, stopover) {
  const [, origin, destination] = flightStr.split('_');
  const endpoints = ['origin', 'destination'].flatMap((side, index) => {
    const name = resolveCity(record, side).city;
    const worldCity = FLIGHT_MAP_CITIES.find(row => row[0] === name);
    const coordinates = CITY_POINTS[name] || worldCity?.slice(1, 3) || AIRPORT_POINTS[index === 0 ? origin : destination];
    return name && coordinates ? [{ name, point: projectPoint(coordinates, center), alongRoute: true }] : [];
  });
  const provinces = Object.entries(PROVINCE_LABELS).map(([name, coordinates]) => ({ name, point: projectPoint(coordinates, center) }));
  const cities = FLIGHT_MAP_CITIES.map(([name, lon, lat, rank]) => ({ name, point: projectPoint([lon, lat], center), rank }));
  const airport = stopover && resolvePlace({ type: 'flight', origin: stopover.code }, 'origin');
  const airportName = airport?.chineseName || airport?.name;

  return (viewport, width, height, unit) => {
    const place = mapLabelPlacer(viewport, width, height, [[width - 62, 8, width - 8, 144]]), seen = new Set();
    const result = { cities: [], provinces: [] };
    const visible = ({ point: [x, y] }) => Math.abs(x - viewport.x) <= width * unit / 2 && Math.abs(y - viewport.y) <= height * unit / 2;
    let stopMarkup = '';
    if (stopover && visible(stopover)) {
      const { code, point } = stopover;
      const row = { point, name: '经停 ' + (airportName || code) };
      const short = { point, name: '经停 ' + code };
      const label = place(row, 12);
      const text = label ? mapLabelText({ ...row, label }, unit) : mapLabelText({ ...short, label: place(short, 12) }, unit);
      const title = e(airportName ? `经停 ${airportName}（${code}）` : short.name);
      stopMarkup = `<g class="flight-stopover" data-flight-stopover="${e(code)}" transform="translate(${point})" role="img" aria-label="${title}"><title>${title}</title><circle r="${4 * unit}" stroke-width="${1.5 * unit}"/>${text}</g>`;
    }
    function add(row, kind, size) {
      if (seen.has(row.name)) return;
      const label = place(row, size, kind === 'provinces');
      if (!label) return;
      result[kind].push({ ...row, label });
      seen.add(row.name);
    }
    for (const row of endpoints) add(row, 'cities', 12);
    for (const row of provinces.filter(visible)) add(row, 'provinces', 16);
    const distance = row => (row.point[0] - viewport.x) ** 2 + (row.point[1] - viewport.y) ** 2;
    const ranked = cities.filter(visible).sort((a, b) => a.rank - b.rank || distance(a) - distance(b));
    const cityLimit = Math.max(5, Math.floor(width / 45));
    for (const row of ranked) {
      if (result.cities.length >= cityLimit) break;
      add(row, 'cities', 11);
    }
    return geographicLabelMarkup(result, unit) + stopMarkup;
  };
}
