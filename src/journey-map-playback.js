import { calendarDate } from './journey-date.js';
import { pathDistanceKm } from './geo-distance.js';
import { mapPoint } from './journey-map-model.js';
import { railMapPoint } from './rail-projection.js';

const MIN_TRIP_MS = 2000;
const MAX_TRIP_MS = 6000;
const LONG_TRIP_KM = 1800;
const END_PAUSE = 450;
const CHUNK_SIZE = 96;
const SVG_NS = 'http://www.w3.org/2000/svg';
const pointText = ([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
const departureKey = record => {
  const date = calendarDate(record.departureDate);
  if (!date) return '';
  return (date.length === 10 ? date : `${date}-12-32`) + (record.departureTime || record.actualDepartureTime || '24:00');
};

export function mapPlaybackTrips(arcs, railways) {
  const trips = [];
  for (const route of arcs) for (const record of route.records) {
    const reversed = route.aggregated && mapPoint(record, 'origin')?.id !== route.from.id;
    const from = reversed ? route.to : route.from, to = reversed ? route.from : route.to;
    trips.push({ record, key: route, from: from.id, to: to.id, reversed, points: route.points });
  }
  for (const { route, records } of railways) for (const record of records) {
    trips.push({ record, key: route, from: 'station:' + route.stops[0].name, to: 'station:' + route.stops.at(-1).name, rail: route });
  }
  return trips.map(trip => ({ ...trip, departure: departureKey(trip.record) })).filter(trip => trip.departure).sort((a, b) =>
    a.departure.localeCompare(b.departure) || a.record.id.localeCompare(b.record.id));
}

function drawTrip(layer, trip, id, visitStation) {
  const group = layer.ownerDocument.createElementNS(SVG_NS, 'g');
  group.id = id;
  const routeCoordinates = trip.rail?.segments ?? [[trip.key.from.coordinates, trip.key.to.coordinates]];
  const lengthRatio = Math.min(1, pathDistanceKm(routeCoordinates) / LONG_TRIP_KM);
  const duration = MIN_TRIP_MS + (MAX_TRIP_MS - MIN_TRIP_MS) * Math.sqrt(lengthRatio);
  const segments = trip.rail ? trip.rail.segments.map(line => line.map(railMapPoint))
    : [trip.reversed ? trip.points.slice().reverse() : trip.points];
  const stations = new Map((trip.rail?.stops.slice(1, -1) || []).map(stop => {
    const point = railMapPoint(stop.coordinates);
    return [pointText(point), { id: 'station:' + stop.name, point, name: stop.name, trips: new Set([trip.record.id]), routes: new Set() }];
  }));
  let total = 0;
  const paths = [], arrivals = [];
  for (const segment of segments) for (let start = 0; start < segment.length - 1; start += CHUNK_SIZE) {
    // Keep per-frame SVG updates bounded even for a long, densely sampled track.
    const points = segment.slice(start, start + CHUNK_SIZE + 1);
    const coordinates = points.map(pointText), distances = [total];
    for (const [index, [x, y]] of points.entries()) {
      if (index) {
        total += Math.hypot(x - points[index - 1][0], y - points[index - 1][1]);
        distances.push(total);
      }
      const station = stations.get(coordinates[index]);
      if (station) { arrivals.push({ station, distance: total }); stations.delete(coordinates[index]); }
    }
    if (total === distances[0]) continue;
    const path = layer.ownerDocument.createElementNS(SVG_NS, 'path');
    group.append(path);
    paths.push({ path, points, coordinates, distances, end: total });
  }
  const overlay = layer.ownerDocument.createElementNS(SVG_NS, 'g');
  overlay.setAttribute('class', `map-playback-trip ${trip.record.type}`);
  overlay.dataset.mapPlaybackTrip = trip.record.id;
  overlay.append(group);
  for (const offset of [-1000, 1000]) {
    const use = layer.ownerDocument.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + id);
    use.setAttribute('transform', `translate(${offset},0)`);
    overlay.append(use);
  }
  layer.append(overlay);
  let cursor = 0, arrival = 0;
  return {
    duration,
    paint(progress) {
      const distance = total * progress;
      while (cursor < paths.length && distance >= paths[cursor].end) {
        const { path, coordinates } = paths[cursor++];
        path.setAttribute('d', 'M' + coordinates.join('L'));
      }
      const active = paths[cursor];
      if (active && distance > active.distances[0]) {
        const { path, points, coordinates, distances } = active;
        const next = distances.findIndex(value => value > distance);
        const previous = next - 1, fraction = (distance - distances[previous]) / (distances[next] - distances[previous]);
        const head = points[previous].map((value, i) => value + (points[next][i] - value) * fraction);
        path.setAttribute('d', 'M' + coordinates.slice(0, next).join('L') + 'L' + pointText(head));
      }
      const firstArrival = arrival;
      while (arrival < arrivals.length && arrivals[arrival].distance <= distance) visitStation(arrivals[arrival++].station);
      return arrival > firstArrival;
    },
    remove: () => overlay.remove()
  };
}

let playbackSequence = 0;

export function bindMapPlayback(svg, button, status, trips, { scope, requestFrame, cancelFrame, redraw }) {
  const view = svg.ownerDocument.defaultView;
  const layer = svg.querySelector('.map-playback');
  const reached = new Set(), labels = new Set(), drawn = new Set(), stations = new Map();
  const playback = { running: false, reached, labels, stations };
  const id = `journey-playback-${++playbackSequence}`;
  let frame = 0, tripIndex, started, finishedAt, current, reducedMotion;

  function showTrip(index) {
    const trip = trips[index], record = trip.record;
    reached.add(trip.from);
    current = drawTrip(layer, trip, `${id}-${index}`, station => stations.set(station.id, station));
    status.textContent = `${index + 1} / ${trips.length} · ${calendarDate(record.departureDate)} · ${[record.service, `${record.origin} → ${record.destination}`].filter(Boolean).join(' ')}`;
    if (reducedMotion) current.paint(1);
    redraw();
  }

  function stop(finished = false) {
    if (!playback.running) return;
    cancelFrame(frame);
    playback.running = false;
    layer.replaceChildren();
    reached.clear(); labels.clear(); drawn.clear(); stations.clear();
    svg.removeAttribute('data-map-playing');
    status.hidden = !finished;
    status.textContent = finished ? `已播放 ${trips.length} 程` : '';
    button.textContent = (finished ? '重播' : '播放') + scope;
    redraw();
  }

  function advance(timestamp) {
    if (finishedAt !== undefined) {
      if (timestamp - finishedAt >= END_PAUSE) { stop(true); return; }
      frame = requestFrame(advance);
      return;
    }
    started ??= timestamp;
    const progress = Math.min(1, (timestamp - started) / current.duration);
    const reachedStation = !reducedMotion && current.paint(progress);
    if (progress === 1) {
      const trip = trips[tripIndex];
      if (drawn.has(trip.key)) current.remove();
      else drawn.add(trip.key);
      reached.add(trip.to);
      for (const label of trip.rail?.lineLabels || []) labels.add(label);
      tripIndex++;
      if (tripIndex === trips.length) {
        finishedAt = timestamp;
        redraw();
      } else {
        started = timestamp;
        showTrip(tripIndex);
      }
    } else if (reachedStation) redraw();
    frame = requestFrame(advance);
  }

  function toggle() {
    if (playback.running) { stop(); return; }
    playback.running = true;
    reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    svg.setAttribute('data-map-playing', '');
    tripIndex = 0;
    started = finishedAt = undefined;
    status.hidden = false;
    button.textContent = '停止播放';
    showTrip(tripIndex);
    frame = requestFrame(advance);
  }
  button.addEventListener('click', toggle);
  return Object.assign(playback, { stop, dispose() {
    cancelFrame(frame);
    button.removeEventListener('click', toggle);
  } });
}
