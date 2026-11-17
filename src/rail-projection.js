import { projectPoint } from './journey-map-model.js';

// RailGo supplies GCJ-02; the local country/province basemap uses WGS84.
export function railWgs84Point([longitude, latitude]) {
  const x = longitude - 105, y = latitude - 35, rad = latitude * Math.PI / 180, sin = Math.sin(rad);
  let lat = -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * Math.sqrt(Math.abs(x));
  let lon = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * Math.sqrt(Math.abs(x));
  const wave = (a, b) => (20 * Math.sin(6 * a * Math.PI) + 20 * Math.sin(2 * a * Math.PI) + 20 * Math.sin(b * Math.PI) + 40 * Math.sin(b / 3 * Math.PI)) * 2 / 3;
  lat += wave(x, y) + (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y / 30 * Math.PI)) * 2 / 3;
  lon += wave(x, x) + (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  const magic = 1 - .006693421622965943 * sin * sin;
  const deltaLat = lat * 180 / ((6378245 * (1 - .006693421622965943)) / magic ** 1.5 * Math.PI);
  const deltaLon = lon * 180 / (6378245 / Math.sqrt(magic) * Math.cos(rad) * Math.PI);
  return [longitude - deltaLon, latitude - deltaLat];
}
export const railMapPoint = coordinates => projectPoint(railWgs84Point(coordinates));
