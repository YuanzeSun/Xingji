import { distanceKm } from './geo-distance.js';
import { railWgs84Point } from './rail-projection.js';
import { projectPoint } from './journey-map-model.js';

const maximumSamples = 100;
const sampleSpacingKm = 2;
const samplingVersion = 1;
const interpolate = (start, end, fraction) => start.map((value, axis) => value + (end[axis] - value) * fraction);
const clamp = value => Math.max(0, Math.min(1, value));

export function sampleRailElevation(segments, projected) {
  const edges = [];
  let total = 0, mapTotal = 0, group = 0, previousEnd;
  for (const [segmentIndex, segment] of segments.entries()) {
    const line = segment.map(railWgs84Point);
    const projectedLine = projected?.[segmentIndex] ?? line.map(point => projectPoint(point));
    if (previousEnd && distanceKm(previousEnd, line[0]) > .15) group++;
    previousEnd = line.at(-1);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], length = distanceKm(a, b);
      if (!length) continue;
      const from = projectedLine[i - 1], to = projectedLine[i];
      const dx = to[0] - from[0], dy = to[1] - from[1], mapLength = Math.hypot(dx, dy);
      edges.push({ a, b, from, to, dx, dy, squared: dx * dx + dy * dy, start: total, length, group, mapStart: mapTotal, mapLength });
      total += length;
      mapTotal += mapLength;
    }
  }
  if (!total) return null;

  const count = Math.min(maximumSamples, Math.ceil(total / sampleSpacingKm) + 1);
  let edgeIndex = 0;
  const samples = Array.from({ length: count }, (_, index) => {
    const distance = total * index / (count - 1);
    while (edgeIndex < edges.length - 1 && distance > edges[edgeIndex].start + edges[edgeIndex].length) edgeIndex++;
    const edge = edges[edgeIndex], fraction = clamp((distance - edge.start) / edge.length);
    return { distance, group: edge.group, coordinate: interpolate(edge.a, edge.b, fraction), mapPoint: interpolate(edge.from, edge.to, fraction) };
  });
  function atMapDistance(distance) {
    let first = 0, last = edges.length - 1;
    while (first < last) {
      const middle = Math.floor((first + last) / 2), edge = edges[middle];
      if (distance > edge.mapStart + edge.mapLength) first = middle + 1;
      else last = middle;
    }
    const edge = edges[first];
    const fraction = clamp((distance - edge.mapStart) / (edge.mapLength || 1));
    return { distance: edge.start + edge.length * fraction, group: edge.group, mapPoint: interpolate(edge.from, edge.to, fraction) };
  }
  function pick([x, y], radius) {
    let closest = radius ** 2, distance, chosenGroup;
    for (const edge of edges) {
      if (!edge.squared) continue;
      const dx = x - edge.from[0], dy = y - edge.from[1];
      const fraction = clamp((dx * edge.dx + dy * edge.dy) / edge.squared);
      const squared = (dx - edge.dx * fraction) ** 2 + (dy - edge.dy * fraction) ** 2;
      if (squared >= closest) continue;
      closest = squared;
      distance = edge.start + edge.length * fraction;
      chosenGroup = edge.group;
    }
    if (distance === undefined) return null;
    const index = Math.round(distance / total * (samples.length - 1));
    return [index, index - 1, index + 1].find(i => samples[i]?.group === chosenGroup) ?? null;
  }
  return { samples, total, pick, atMapDistance };
}

export function normalizeRailElevation(snapshot) {
  const values = Array.isArray(snapshot?.values) ? [...snapshot.values] : [];
  if (snapshot?.samplingVersion !== samplingVersion || typeof snapshot.queriedAt !== 'string' ||
      !Number.isFinite(Date.parse(snapshot.queriedAt)) || values.length > maximumSamples ||
      values.some(value => value !== null && (!Number.isFinite(value) || Math.abs(value) > 12000)) ||
      values.filter(Number.isFinite).length < 2) throw new Error('地表海拔资料不完整');
  return { values, samplingVersion, queriedAt: new Date(snapshot.queriedAt).toISOString() };
}

export async function queryRailElevation(segments, { fetcher = globalThis.fetch, signal } = {}) {
  const sampling = sampleRailElevation(segments);
  if (!sampling) return;
  const { samples } = sampling;
  const params = new URLSearchParams({
    latitude: samples.map(({ coordinate }) => coordinate[1].toFixed(5)).join(','),
    longitude: samples.map(({ coordinate }) => coordinate[0].toFixed(5)).join(',')
  });
  const timeout = AbortSignal.timeout(12000);
  const response = await fetcher.call(globalThis, 'https://api.open-meteo.com/v1/elevation?' + params, {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!response.ok) throw new Error('暂时无法获取地表海拔');
  const { elevation } = await response.json();
  if (elevation?.length !== samples.length) throw new Error('地表海拔资料不完整');
  return normalizeRailElevation({ values: elevation, samplingVersion, queriedAt: new Date().toISOString() });
}
