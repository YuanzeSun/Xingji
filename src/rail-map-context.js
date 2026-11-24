import {railLineAnnotations} from './rail-line-names.js';
import { CITY_POINTS, PROVINCE_LABELS } from './data/map-reference.js';
import { projectPoint } from './journey-map-model.js';
import { mapLabelPlacer } from './map-labels.js';

const cities = Object.entries(CITY_POINTS).map(([name, coordinates]) => ({ name, point: projectPoint(coordinates) }));
const provinces = Object.entries(PROVINCE_LABELS).map(([name, coordinates]) => ({ name, point: projectPoint(coordinates) }));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) : 0;
  return distance(point, [start[0] + t * dx, start[1] + t * dy]);
}

export function createRailMapContext(segments) {
  const points = segments.flat(), xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const rankedCities = cities.map(city => {
    let nearest = Infinity;
    for (const line of segments) for (let i = 1; i < line.length; i++) nearest = Math.min(nearest, distanceToSegment(city.point, line[i - 1], line[i]));
    return { ...city, distance: nearest };
  }).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'zh-CN'));
  return { bounds, cities: rankedCities, provinces };
}

export function railMapAnnotations(context, stops, viewport, width, height, {lineLabels=[]}={}) {
  const boxes = [[width - 62, 8, width - 8, 144], [8, height - 33, 132, height - 4]], result = { stops: [], cities: [], provinces: [] };
  const label = mapLabelPlacer(viewport, width, height, boxes);
  const orderedStops = stops.map((stop, index) => ({ ...stop, index, endpoint:stop.endpoint ?? (index === 0 || index === stops.length - 1) })).sort((a, b) => Number(b.endpoint) - Number(a.endpoint));
  for (const stop of orderedStops) result.stops.push({ ...stop, label: label(stop, 13) });
  result.lines=railLineAnnotations(lineLabels,viewport,width,height,boxes);
  boxes.push(...result.lines.map(row=>row.label.box));
  for (const province of context.provinces) {
    const placement = label(province, 16, true);
    if (placement) result.provinces.push({ ...province, label: placement });
  }
  const stopNames = new Set(stops.map(stop => stop.name));
  for (const city of context.cities) {
    if (stopNames.has(city.name)) continue;
    const placement = label(city, 11);
    if (placement) result.cities.push({ ...city, alongRoute: city.distance < .7, label: placement });
  }
  return result;
}
