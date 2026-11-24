import { calendarDate } from './journey-date.js';
import { mapPoint } from './journey-map-model.js';
import { railMapPoint } from './rail-projection.js';

const TRIP_DURATION = 4000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const departureKey = record => {
  const date = calendarDate(record.departureDate);
  return (date.length === 10 ? date : `${date}-12-32`) + (record.departureTime || record.actualDepartureTime || '24:00');
};

export function annualMapTrips(arcs, railways) {
  const trips = [];
  for (const route of arcs) for (const record of route.records) {
    const reversed = route.aggregated && mapPoint(record, 'origin')?.id !== route.from.id;
    const from = reversed ? route.to : route.from, to = reversed ? route.from : route.to;
    trips.push({ record, key: route, from: from.id, to: to.id, reversed, points: route.points });
  }
  for (const { route, records } of railways) for (const record of records) {
    trips.push({ record, key: route, from: 'station:' + route.stops[0].name, to: 'station:' + route.stops.at(-1).name, rail: route });
  }
  return trips.map(trip => ({ ...trip, departure: departureKey(trip.record) })).sort((a, b) =>
    a.departure.localeCompare(b.departure) || a.record.id.localeCompare(b.record.id));
}

function drawTrip(layer, trip, id) {
  const group = layer.ownerDocument.createElementNS(SVG_NS, 'g');
  group.id = id;
  const segments = trip.rail ? trip.rail.segments.map(line => line.map(railMapPoint))
    : [trip.reversed ? trip.points.slice().reverse() : trip.points];
  let total = 0;
  const paths = [];
  for (const points of segments) {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (!length) continue;
    const path = layer.ownerDocument.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M' + points.map(point => point.map(value => value.toFixed(6)).join(',')).join('L'));
    path.setAttribute('pathLength', '1');
    path.setAttribute('stroke-dasharray', '1 1');
    path.style.visibility = 'hidden';
    path.style.strokeDashoffset = '1';
    group.append(path);
    paths.push({ path, length, end: total += length });
  }
  const overlay = layer.ownerDocument.createElementNS(SVG_NS, 'g');
  overlay.setAttribute('class', `map-playback-trip ${trip.record.type} is-current`);
  overlay.dataset.mapPlaybackTrip = trip.record.id;
  overlay.append(group);
  for (const offset of [-1000, 1000]) {
    const use = layer.ownerDocument.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#' + id);
    use.setAttribute('transform', `translate(${offset},0)`);
    overlay.append(use);
  }
  layer.append(overlay);
  let cursor = 0;
  return {
    paint(progress) {
      const distance = total * progress;
      while (cursor < paths.length) {
        const { path, length, end } = paths[cursor];
        if (distance <= end - length && progress < 1) break;
        path.style.visibility = '';
        if (distance < end && progress < 1) {
          path.style.strokeDashoffset = String((end - distance) / length);
          break;
        }
        path.style.strokeDashoffset = '0';
        cursor++;
      }
    },
    finish(keep) {
      if (!keep) overlay.remove();
      else {
        overlay.classList.remove('is-current');
        for (const { path } of paths) path.removeAttribute('stroke-dasharray');
      }
    }
  };
}

let playbackSequence = 0;

export function bindAnnualMapPlayback(svg, button, status, trips, { requestFrame, cancelFrame, redraw }) {
  const view = svg.ownerDocument.defaultView;
  const layer = svg.querySelector('.map-playback');
  const reached = new Set(), labels = new Set(), drawn = new Set();
  const playback = { running: false, reached, labels };
  const id = `journey-playback-${++playbackSequence}`;
  let frame = 0, tripIndex, started, current, reducedMotion;

  function showTrip(index) {
    const trip = trips[index], record = trip.record;
    reached.add(trip.from);
    current = drawTrip(layer, trip, `${id}-${index}`);
    status.textContent = `${index + 1} / ${trips.length} · ${calendarDate(record.departureDate)} · ${[record.service, `${record.origin} → ${record.destination}`].filter(Boolean).join(' ')}`;
    if (reducedMotion) current.paint(1);
    redraw();
  }

  function stop(finished = false) {
    if (!playback.running) return;
    cancelFrame(frame);
    playback.running = false;
    layer.replaceChildren();
    reached.clear(); labels.clear(); drawn.clear();
    svg.removeAttribute('data-map-playing');
    status.hidden = !finished;
    status.textContent = finished ? `已播放 ${trips.length} 程` : '';
    button.textContent = finished ? '重播年度行程' : '播放年度行程';
    redraw();
  }

  function advance(timestamp) {
    started ??= timestamp;
    const progress = Math.min(1, (timestamp - started) / TRIP_DURATION);
    if (!reducedMotion) current.paint(progress);
    if (progress === 1) {
      const trip = trips[tripIndex];
      current.finish(!drawn.has(trip.key));
      drawn.add(trip.key);
      reached.add(trip.to);
      for (const label of trip.rail?.lineLabels || []) labels.add(label);
      tripIndex++;
      if (tripIndex === trips.length) { stop(true); return; }
      started = timestamp;
      showTrip(tripIndex);
    }
    frame = requestFrame(advance);
  }

  function toggle() {
    if (playback.running) { stop(); return; }
    playback.running = true;
    reducedMotion = view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    svg.setAttribute('data-map-playing', '');
    tripIndex = 0;
    started = undefined;
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
