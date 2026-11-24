import { FLIGHT_TRACK_SOURCE, flightTrackDistanceKm } from './flight-track.js';
import { longitudeCenter, projectPoint, unwrapLongitude } from './journey-map-model.js';
import { createMapBasemap } from './map-basemap.js';
import { flightTrackLabelRenderer } from './flight-track-labels.js';
import { bindDetailMapControls, detailMapControls, ROUTE_PLAYBACK_MS } from './detail-map-controls.js';
import { AIRPORT_POINTS, LAND_PATH, COUNTRY_PATH, PROVINCE_PATH } from './data/map-reference.js';

const clamp = value => Math.max(0, Math.min(1, value));

function inFlightDirection(track) {
  const [, origin, destination] = track.flightStr.split('_');
  const from = AIRPORT_POINTS[origin], to = AIRPORT_POINTS[destination];
  if (!from || !to || origin === destination) return track.segments;
  const first = track.segments[0][0], last = track.segments.at(-1).at(-1);
  const distance = ([lon, lat], [x, y]) => Math.hypot((unwrapLongitude(x, lon) - lon) * Math.cos(lat * Math.PI / 180), y - lat);
  return distance(from, first) + distance(to, last) <= distance(from, last) + distance(to, first)
    ? track.segments : track.segments.toReversed().map(line => line.toReversed());
}

function mountTrackMap(frame, track, record) {
  const view = frame.ownerDocument.defaultView, svg = frame.querySelector('svg');
  const basemap = createMapBasemap(frame.querySelector('canvas'), view, { provinceContrast: true });
  const center = longitudeCenter(track.segments.flatMap(line => line.map(point => point[0])));
  const renderLabels = flightTrackLabelRenderer(record, track.flightStr, center);
  const lines = inFlightDirection(track).map(line => line.map(point => projectPoint(point, center)));
  const points = lines.flat();
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  let distance = 0;
  const edges = [], segments = [];
  for (const line of lines) {
    const start = distance;
    for (let index = 1; index < line.length; index++) {
      const from = line[index - 1], to = line[index];
      const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
      if (!length) continue;
      edges.push({ from, dx, dy, start: distance, length, angle: Math.atan2(dy, dx) * 180 / Math.PI });
      distance += length;
    }
    segments.push({ start, length: distance - start });
  }
  const markup = lines.map(line => `<path pathLength="1" d="M${line.join('L')}"/>`).join('');
  const background = basemap ? '' : `<defs><g id="flight-track-world" class="rail-base"><path class="rail-land" d="${LAND_PATH}"/><path class="rail-countries" d="${COUNTRY_PATH}"/><path class="rail-provinces" d="${PROVINCE_PATH}"/></g></defs><use href="#flight-track-world" x="-1000"/><use href="#flight-track-world"/><use href="#flight-track-world" x="1000"/>`;
  svg.innerHTML = `${background}<g class="flight-track-line">${markup}</g><g class="flight-track-highlight" aria-hidden="true">${markup}</g><g data-flight-track-labels></g><g data-flight-track-aircraft aria-hidden="true"><path d="M10 0 1-2-3-9H-6l2 7-5-1v6l5-1-2 7h3l4-7z"/></g>`;
  const overlay = [...svg.querySelector('.flight-track-highlight').children];
  const labelLayer = svg.querySelector('[data-flight-track-labels]');
  const aircraft = svg.querySelector('[data-flight-track-aircraft]');
  let unit = 1, animation = 0, started, traveled = 0, edgeIndex = 0, playing = false;

  function positionAircraft() {
    if (!playing || !edges.length) return;
    while (edgeIndex < edges.length - 1 && traveled >= edges[edgeIndex].start + edges[edgeIndex].length) edgeIndex++;
    const { from, dx, dy, start, length, angle } = edges[edgeIndex];
    const progress = clamp((traveled - start) / length);
    aircraft.setAttribute('transform', `translate(${from[0] + dx * progress} ${from[1] + dy * progress}) rotate(${angle}) scale(${unit})`);
  }

  function fitViewport(width, height) {
    const [left, top, right, bottom] = bounds;
    const scale = Math.max((right - left) / (width * .8), (bottom - top) / (height * .73), .001);
    return { x: (left + right) / 2, y: (top + bottom) / 2, zoom: 1000 / (scale * width) };
  }

  function draw(viewport, width, height, interactive) {
    const { x, y, zoom } = viewport;
    unit = 1000 / (zoom * width);
    svg.setAttribute('viewBox', `${x - width * unit / 2} ${y - height * unit / 2} ${width * unit} ${height * unit}`);
    svg.style.setProperty('--flight-track-stroke', String(unit * 3));
    basemap?.draw(viewport, width, height, interactive);
    labelLayer.innerHTML = renderLabels(viewport, width, height, unit);
    positionAircraft();
  }

  function paint(progress) {
    traveled = progress * distance;
    for (const [index, { start, length }] of segments.entries()) {
      const shown = progress === 1 ? 1 : clamp((traveled - start) / (length || 1));
      const offset = String(1 - shown);
      if (overlay[index].style.strokeDashoffset !== offset) overlay[index].style.strokeDashoffset = offset;
    }
    positionAircraft();
  }

  function play(finished) {
    view.cancelAnimationFrame(animation);
    started = undefined;
    edgeIndex = 0;
    svg.setAttribute('data-flight-track-played', '');
    playing = distance > 0;
    svg.toggleAttribute('data-flight-track-playing', playing);
    function tick(timestamp) {
      started ??= timestamp;
      const progress = playing ? clamp((timestamp - started) / ROUTE_PLAYBACK_MS) : 1;
      paint(progress);
      if (progress < 1) animation = view.requestAnimationFrame(tick);
      else {
        animation = 0;
        playing = false;
        svg.removeAttribute('data-flight-track-playing');
        finished();
      }
    }
    if (!playing) tick(0);
    else {
      paint(0);
      animation = view.requestAnimationFrame(tick);
    }
  }

  const unbind = bindDetailMapControls(frame, { fitViewport, draw });
  return { play, dispose() { view.cancelAnimationFrame(animation); unbind(); } };
}

export function mountFlightTrack(container, record) {
  const track = record.flightTrack;
  const demo = record.sources?.some(source => source.kind === 'demo');
  const attribution = demo ? '航迹数据：示例' : `<a href="${FLIGHT_TRACK_SOURCE}" target="_blank" rel="noopener noreferrer">航迹数据：飞常准</a>`;
  const [, dep, arr] = track.flightStr.split('_');
  const distance = flightTrackDistanceKm(track).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  const queriedAt = demo ? '' : ' · 查询于 ' + track.queriedAt.slice(0, 10);
  container.innerHTML = `<div class="rail-route-heading"><h3>飞行航迹</h3><button class="button secondary small" type="button" data-flight-track-play>播放航迹</button></div><p class="flight-track-status visually-hidden" role="status"></p><div class="flight-track-frame rail-route-frame"><canvas aria-hidden="true"></canvas><svg tabindex="0" role="group" aria-label="${dep} 至 ${arr}飞行航迹图，可拖动及缩放"></svg>${detailMapControls('飞行航迹')}</div><p class="rail-route-caption" data-flight-track-source>${attribution}<span> · ${dep} → ${arr} · 航迹约 ${distance} km${queriedAt}</span></p>`;
  const playButton = container.querySelector('[data-flight-track-play]');
  const status = container.querySelector('[role=status]');
  const map = mountTrackMap(container.querySelector('.flight-track-frame'), track, record);

  function play() {
    playButton.textContent = '重播航迹';
    status.textContent = '正在播放航迹';
    map.play(() => { status.textContent = '航迹播放完成'; });
  }
  playButton.addEventListener('click', play);
  return () => {
    map.dispose();
    playButton.removeEventListener('click', play);
  };
}
