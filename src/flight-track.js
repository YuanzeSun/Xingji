import { flightQuery } from './flight-query.js';
import { isInactiveFlight } from './flight-status.js';
import { pathDistanceKm } from './geo-distance.js';

export const FLIGHT_TRACK_SOURCE = 'https://cmcp.variflight.com/tools/#getFlightTrackLine';
const MAX_POINTS = 12000;

export function flightTrackRequest(record) {
  if (record.type !== 'flight' || record.deleted || isInactiveFlight(record)) throw new Error('这张机票无法查询航迹');
  const { fnum, date, dep, arr } = flightQuery(record);
  if (!dep || !arr) throw new Error('请先补全出发和到达机场');
  return [fnum, dep, arr, date, '0'].join('_');
}

const coordinate = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
function readPoint(point) {
  const longitude = coordinate(Array.isArray(point) ? point[0] : point?.longitude ?? point?.lng ?? point?.lon);
  const latitude = coordinate(Array.isArray(point) ? point[1] : point?.latitude ?? point?.lat);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return [longitude, latitude].map(value => Math.round(value * 100000) / 100000 || 0);
}

function normalizeSegments(lines) {
  if (!Array.isArray(lines)) return [];
  let count = 0;
  const segments = [];
  for (const line of lines) {
    if (!Array.isArray(line) || (count += line.length) > MAX_POINTS) return [];
    const segment = [];
    for (const value of line) {
      const point = readPoint(value);
      if (!point) return [];
      const previous = segment.at(-1);
      if (!previous || point[0] !== previous[0] || point[1] !== previous[1]) segment.push(point);
    }
    if (segment.length >= 2) segments.push(segment);
  }
  return segments;
}

export function normalizeFlightTrack(record, value) {
  if (!value || typeof value.queriedAt !== 'string' || !Number.isFinite(Date.parse(value.queriedAt))) return undefined;
  try {
    if (value.flightStr !== flightTrackRequest(record)) return undefined;
  } catch { return undefined; }
  const segments = normalizeSegments(value.segments);
  return segments.length ? { flightStr: value.flightStr, queriedAt: new Date(value.queriedAt).toISOString(), segments } : undefined;
}

export function flightTrackDistanceKm(track) {
  return track ? pathDistanceKm(track.segments) : 0;
}

function providerCoordinates(row, flightStr) {
  const [fnum, dep, arr, date, kind] = flightStr.split('_');
  if (row.fnum !== fnum || row.dep !== dep || row.arr !== arr || ![date, date + '_' + kind].includes(row.date)) return null;
  if (!row.coordinates.trim()) return [];
  const points = row.coordinates.trim().replace(/;$/, '').split(';');
  if (points.length > MAX_POINTS) return null;
  const line = [];
  for (const point of points) {
    const fields = point.split(',');
    if (fields.length !== 2) return null;
    line.push([fields[1], fields[0]]);
  }
  return [line];
}

function structuredTrack(value, flightStr, depth = 0) {
  if (value == null || depth > 8) return null;
  const nested = item => structuredTrack(item, flightStr, depth + 1);
  if (typeof value === 'string') {
    try { return nested(JSON.parse(value)); } catch { return null; }
  }
  if (Array.isArray(value)) {
    if (!value.length) return [];
    if (value.some(item => readPoint(item))) return [value];
    const lines = value.map(nested).filter(Boolean);
    return lines.length ? lines.flat() : null;
  }
  if (typeof value !== 'object' || (value.flightStr && value.flightStr !== flightStr)) return null;
  if (typeof value.coordinates === 'string' && Object.hasOwn(value, 'fnum')) return providerCoordinates(value, flightStr);
  if (value.type === 'LineString') return [value.coordinates];
  if (value.type === 'MultiLineString') return value.coordinates;
  if (value.type === 'FeatureCollection') return nested(value.features);
  for (const field of [flightStr, 'geometry', 'segments', 'trackLine', 'trackLines', 'tracks', 'track', 'coordinates', 'points', 'items', 'data']) {
    if (Object.hasOwn(value, field)) return nested(value[field]);
  }
  return null;
}

export function readFlightTrack(result, flightStr, queriedAt = new Date().toISOString()) {
  const content = Array.isArray(result?.content) ? result.content.map(part => part?.type === 'text' ? part.text : part?.resource?.text).filter(Boolean) : null;
  const lines = structuredTrack(result?.structuredContent, flightStr) ?? structuredTrack(content?.length ? content : null, flightStr);
  if (!lines) throw new Error('飞常准返回了无法识别的航迹数据');
  if (!lines.length) return undefined;
  const segments = normalizeSegments(lines);
  if (!segments.length) throw new Error('飞常准返回的航迹没有可绘制的坐标');
  return { flightStr, queriedAt, segments };
}
