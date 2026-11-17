import {railLineAnnotations} from './rail-line-names.js';
import { CITY_POINTS, PROVINCE_LABELS, PROVINCE_PATH } from './data/map-reference.js';
import { projectPoint } from './journey-map-model.js';

const cities = Object.entries(CITY_POINTS).map(([name, coordinates]) => ({ name, point: projectPoint(coordinates) }));
const provinces = Object.entries(PROVINCE_LABELS).map(([name, coordinates]) => ({ name, point: projectPoint(coordinates) }));
const boundaries = [...PROVINCE_PATH.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function distanceToSegment(point, start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1], length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) : 0;
  return distance(point, [start[0] + t * dx, start[1] + t * dy]);
}

export function createRailMapContext(segments) {
  const points = segments.flat(), xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const center = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
  const nearest = boundaries.reduce((best, point) => distance(point, center) < distance(best, center) ? point : best, boundaries[0]);
  // The regional view includes the nearest real provincial boundary, even for short trips.
  const neighbors = [...provinces].sort((a, b) => distance(a.point, center) - distance(b.point, center)).slice(0, 2).map(province => province.point);
  const regionalBounds = [Math.min(bounds[0], nearest[0], ...neighbors.map(point => point[0])) - .8, Math.min(bounds[1], nearest[1], ...neighbors.map(point => point[1])) - .8, Math.max(bounds[2], nearest[0], ...neighbors.map(point => point[0])) + .8, Math.max(bounds[3], nearest[1], ...neighbors.map(point => point[1])) + .8];
  const rankedCities = cities.map(city => {
    let nearest = Infinity;
    for (const line of segments) for (let i = 1; i < line.length; i++) nearest = Math.min(nearest, distanceToSegment(city.point, line[i - 1], line[i]));
    return { ...city, distance: nearest };
  }).sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name, 'zh-CN'));
  return { bounds, regionalBounds, cities: rankedCities, provinces };
}

export function railMapAnnotations(context, stops, viewport, width, height, {lineLabels=[]}={}) {
  const unit = 1000 / viewport.zoom / width;
  const pixel = point => [(point[0] - viewport.x) / unit + width / 2, (point[1] - viewport.y) / unit + height / 2];
  const boxes = [[width - 62, 8, width - 8, 184], [8, height - 33, 132, height - 4]], result = { stops: [], cities: [], provinces: [] };
  function label(row, fontSize, centered = false) {
    const [x, y] = pixel(row.point), textWidth = [...row.name].reduce((sum, char) => sum + (/\p{Script=Han}/u.test(char) ? fontSize : fontSize * .65), 0) + (centered ? (row.name.length - 1) * 2 : 0);
    const positions = centered ? [[-textWidth / 2, fontSize / 2], [-textWidth / 2 - 28, fontSize / 2], [-textWidth / 2, fontSize / 2 + 24], [-textWidth / 2, fontSize / 2 - 24]] : [[10, -9], [-textWidth - 10, -9], [10, fontSize + 8], [-textWidth - 10, fontSize + 8]];
    for (const [dx, dy] of positions) {
      const box = [x + dx - 4, y + dy - fontSize - 3, x + dx + textWidth + 4, y + dy + 4];
      if (box[0] < 7 || box[1] < 7 || box[2] > width - 7 || box[3] > height - 7) continue;
      if (boxes.some(other => box[0] < other[2] + 4 && box[2] > other[0] - 4 && box[1] < other[3] + 4 && box[3] > other[1] - 4)) continue;
      boxes.push(box); return { dx, dy, fontSize, box };
    }
    return null;
  }
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
