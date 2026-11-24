import { RAIL_ROUTE_SOURCE } from './rail-route.js';
import {savedRailRoute} from './rail-route-snapshot.js';
import { railMapPoint } from './rail-projection.js';
export { railMapPoint } from './rail-projection.js';
import { createMapBasemap } from './map-basemap.js';
import { createRailMapContext, railMapAnnotations } from './rail-map-context.js';
import { geographicLabelMarkup, mapLabelText } from './map-labels.js';
import { bindDetailMapControls, detailMapControls, ROUTE_PLAYBACK_MS } from './detail-map-controls.js';
import { LAND_PATH, COUNTRY_PATH, PROVINCE_PATH } from './data/map-reference.js';
import { escape as e } from './html.js';
import {RAIL_LINE_SOURCE} from './rail-line-names.js';

function bindRailPlayback(container, svg, segments, route) {
  const button = container.querySelector('[data-rail-play-route]');
  const status = container.querySelector('[data-rail-play-status]');
  const track = svg.querySelector('.rail-track');
  const overlay = track.cloneNode(true);
  overlay.setAttribute('class', 'rail-playback-track');
  overlay.setAttribute('aria-hidden', 'true');
  track.after(overlay);

  const stopPoints = route.stops.map(stop => railMapPoint(stop.coordinates).join(','));
  const distances = new Map(stopPoints.map(point => [point, Infinity]));
  let total = 0;
  const paths = [...overlay.children].map((path, index) => {
    path.setAttribute('pathLength', '1');
    const start = total;
    segments[index].forEach(([x, y], pointIndex, line) => {
      if (pointIndex) {
        const [previousX, previousY] = line[pointIndex - 1];
        total += Math.hypot(x - previousX, y - previousY);
      }
      const key = [x, y].join(',');
      if (distances.get(key) === Infinity) distances.set(key, total);
    });
    return { path, start, length: total - start, offset: 1 };
  });
  const arrivals = new Map(route.stops.map((stop, i) => [stop.name, distances.get(stopPoints[i])]));
  arrivals.set(route.origin, 0);
  arrivals.set(route.destination, total);

  const view = container.ownerDocument.defaultView;
  let animation = 0, startedAt, traveled = -1, stations = [];
  function updateStations() {
    for (const { element, arrival } of stations) {
      element.toggleAttribute('data-rail-stop-lit', traveled >= arrival || traveled === total);
    }
  }
  function paint(distance) {
    traveled = distance;
    for (const segment of paths) {
      const { path, start, length } = segment;
      const offset = distance === total ? 0 : 1 - Math.max(0, Math.min(1, (distance - start) / (length || 1)));
      if (segment.offset === offset) continue;
      path.style.strokeDashoffset = String(offset);
      segment.offset = offset;
    }
    updateStations();
  }
  function animate(timestamp) {
    startedAt ??= timestamp;
    const progress = total ? Math.min(1, (timestamp - startedAt) / ROUTE_PLAYBACK_MS) : 1;
    paint(progress * total);
    if (progress < 1) {
      animation = view.requestAnimationFrame(animate);
    } else {
      animation = 0;
      status.textContent = `已点亮${route.origin}至${route.destination}`;
    }
  }
  function play() {
    view.cancelAnimationFrame(animation);
    startedAt = undefined;
    status.textContent = '';
    svg.setAttribute('data-rail-playback', '');
    button.textContent = '重播行程';
    if (!total) {
      animate(0);
    } else {
      paint(0);
      animation = view.requestAnimationFrame(animate);
    }
  }
  button.addEventListener('click', play);

  return {
    setStations(rows, elements) {
      stations = rows.flatMap((row, index) => arrivals.has(row.name)
        ? [{ element: elements[index], arrival: arrivals.get(row.name) }]
        : []);
      updateStations();
    },
    dispose() {
      if (animation) view.cancelAnimationFrame(animation);
      button.removeEventListener('click', play);
    },
  };
}

function mountMap(container, route) {
  const frame = container.querySelector('.rail-route-frame'), svg = frame.querySelector('svg');
  const basemap = createMapBasemap(frame.querySelector('canvas'), frame.ownerDocument.defaultView, { provinceContrast: true });
  const full=route.fullRoute || route,selectedNames=new Set(route.stops.map(stop=>stop.name));
  const segments = route.segments.map(line => line.map(railMapPoint)), fullSegments=full.segments.map(line=>line.map(railMapPoint));
  const stops = full.stops.map((stop,i) => ({ ...stop, point:railMapPoint(stop.coordinates),mySegment:selectedNames.has(stop.name),endpoint:stop.name===route.origin || stop.name===route.destination || i===0 || i===full.stops.length-1 }));
  const context = createRailMapContext(fullSegments);
  const background = basemap ? '' : `<g class="rail-base"><path class="rail-land" d="${LAND_PATH}"/><path class="rail-countries" d="${COUNTRY_PATH}"/><path class="rail-provinces" d="${PROVINCE_PATH}"/></g>`;
  const paths=lines=>lines.map(line=>`<path d="M${line.map(point=>point.map(value=>value.toFixed(5)).join(',')).join('L')}"/>`).join('');
  const track=paths(segments);
  svg.innerHTML = `${background}<g class="rail-full-track">${route.fullRoute ? paths(fullSegments) : ''}</g><g class="rail-track-halo">${track}</g><g class="rail-track">${track}</g><g data-rail-lines></g><g data-rail-context></g><g data-rail-stops></g>`;
  const playback = bindRailPlayback(container, svg, segments, route);
  const stationLayer = svg.querySelector('[data-rail-stops]');
  function fitViewport(width, height) {
    const [left, top, right, bottom] = context.bounds;
    return { x: (left + right) / 2, y: (top + bottom) / 2, zoom: Math.min(1000 / Math.max(.02, right - left) * .72, 1000 * height / width / Math.max(.02, bottom - top) * .65) };
  }
  function draw(viewport, width, height, interactive) {
    const viewWidth = 1000 / viewport.zoom, viewHeight = viewWidth * height / width, unit = viewWidth / width;
    svg.setAttribute('viewBox', `${viewport.x - viewWidth / 2} ${viewport.y - viewHeight / 2} ${viewWidth} ${viewHeight}`);
    // Scale the playback stroke separately so its dashes stay in the same units as the path.
    svg.style.setProperty('--rail-playback-width', String(4 * unit));
    basemap?.draw(viewport, width, height, interactive);
    const annotations = railMapAnnotations(context, stops, viewport, width, height,{lineLabels:[...(route.lineLabels||[]),...(route.fullRoute?.lineLabels||[])]});
    const text = row => mapLabelText(row, unit);
    const lineLabels=annotations.lines;
    svg.querySelector('[data-rail-lines]').innerHTML=lineLabels.map(row=>`<g class="rail-line-name" data-rail-line-name="${e(row.name)}" transform="translate(${row.point})">${text(row)}</g>`).join('');
    svg.querySelector('[data-rail-context]').innerHTML = geographicLabelMarkup(annotations, unit);
    stationLayer.innerHTML = annotations.stops.map(stop => {
      return `<g data-rail-segment="${stop.mySegment ? 'selected' : 'outside'}" transform="translate(${stop.point})"><circle r="${(stop.endpoint ? 5 : 3) * unit}" class="rail-stop ${stop.endpoint ? 'endpoint' : ''}"/><title>${e(stop.name)}</title>${text(stop)}</g>`;
    }).join('');
    playback.setStations(annotations.stops, stationLayer.children);
  }
  const unbind = bindDetailMapControls(frame, { fitViewport, draw });
  return () => { unbind(); playback.dispose(); };
}

export function mountRailRoute(container, record) {
  const route=savedRailRoute(record);
  if(!container.isConnected || !route)return ()=>{};
    container.innerHTML = `<div class="rail-route-heading"><h3>铁路线路</h3><div class="rail-route-actions"><span>按现行线路推定</span><button type="button" class="button secondary small" data-rail-play-route>播放行程</button></div><span class="visually-hidden" role="status" data-rail-play-status></span></div><div class="rail-route-frame"><canvas aria-hidden="true"></canvas><svg tabindex="0" role="group" aria-label="${e(route.service + ' ' + route.origin + '至' + route.destination)}铁路线路图，可拖动及缩放"></svg>${detailMapControls('铁路线路')}<div class="rail-route-legend"><span>乘坐区间</span>${route.fullRoute ? '<span class="rail-full-line">区间外</span>' : ''}<span class="rail-border">省界</span></div></div><p class="rail-route-caption">${route.fullRoute ? e(route.fullRoute.stops[0].name)+' → '+e(route.fullRoute.stops.at(-1).name)+' · 乘坐：' : ''}${e(route.origin)} → ${e(route.destination)} · <a href="${RAIL_ROUTE_SOURCE}" target="_blank" rel="noopener noreferrer">线路数据：RailGo</a>${route.lineLabels?.length || route.fullRoute?.lineLabels?.length ? ` · ${e([...new Set([...(route.lineLabels||[]),...(route.fullRoute?.lineLabels||[])].map(label=>label.name))].join('、'))} · <a href="${RAIL_LINE_SOURCE}" target="_blank" rel="noopener noreferrer">线路名称：迷雾资料库</a>` : ''} · 查询于 ${e(route.queriedAt.slice(0, 10))}</p>`;
  container.hidden = false;
  return mountMap(container, route);
}
