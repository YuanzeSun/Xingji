import { RAIL_ROUTE_SOURCE } from './rail-route.js';
import {savedRailRoute} from './rail-route-snapshot.js';
import { railMapPoint } from './rail-projection.js';
export { railMapPoint } from './rail-projection.js';
import { createMapBasemap } from './map-basemap.js';
import { createRailMapContext, railMapAnnotations } from './rail-map-context.js';
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

  const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const duration = 2000;
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
    const progress = motion?.matches || !total ? 1 : Math.min(1, (timestamp - startedAt) / duration);
    paint(progress * total);
    if (progress < 1) {
      animation = requestAnimationFrame(animate);
    } else {
      animation = 0;
      status.textContent = `已点亮${route.origin}至${route.destination}`;
    }
  }
  function play() {
    cancelAnimationFrame(animation);
    startedAt = undefined;
    status.textContent = '';
    svg.setAttribute('data-rail-playback', '');
    button.textContent = '重播行程';
    if (motion?.matches || !total) {
      animate(0);
    } else {
      paint(0);
      animation = requestAnimationFrame(animate);
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
      cancelAnimationFrame(animation);
      button.removeEventListener('click', play);
    },
  };
}

function mountMap(container, route) {
  const frame = container.querySelector('.rail-route-frame'), svg = frame.querySelector('svg'), basemap = createMapBasemap(frame.querySelector('canvas'), window, { provinceContrast: true });
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
  let width, height, viewport, fitted, animation = 0, disposed = false, gesture;
  const pointers = new Map();
  const measure = () => { const rect = frame.getBoundingClientRect(); width = rect.width || 640; height = rect.height || 340; };
  function fit(regional = false) {
    measure();
    const bounds = regional ? context.regionalBounds : context.bounds;
    viewport = { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2, zoom: Math.min(1000 / Math.max(.02, bounds[2] - bounds[0]) * .72, 1000 * height / width / Math.max(.02, bounds[3] - bounds[1]) * .65) };
    fitted = { ...viewport }; schedule();
  }
  function draw() {
    animation = 0; if (disposed) return;
    measure();
    const viewWidth = 1000 / viewport.zoom, viewHeight = viewWidth * height / width, unit = viewWidth / width;
    svg.setAttribute('viewBox', `${viewport.x - viewWidth / 2} ${viewport.y - viewHeight / 2} ${viewWidth} ${viewHeight}`);
    // Scale the playback stroke separately so its dashes stay in the same units as the path.
    svg.style.setProperty('--rail-playback-width', String(4 * unit));
    basemap?.draw(viewport, width, height, pointers.size > 0);
    const annotations = railMapAnnotations(context, stops, viewport, width, height,{lineLabels:[...(route.lineLabels||[]),...(route.fullRoute?.lineLabels||[])]});
    const text = row => row.label ? `<text x="${row.label.dx * unit}" y="${row.label.dy * unit}" font-size="${row.label.fontSize * unit}" stroke-width="${3 * unit}">${e(row.name)}</text>` : '';
    const lineLabels=annotations.lines;
    svg.querySelector('[data-rail-lines]').innerHTML=lineLabels.map(row=>`<g class="rail-line-name" data-rail-line-name="${e(row.name)}" transform="translate(${row.point})">${text(row)}</g>`).join('');
    svg.querySelector('[data-rail-context]').innerHTML = annotations.provinces.map(row => `<g class="rail-province" transform="translate(${row.point})" style="letter-spacing:${2 * unit}px">${text(row)}</g>`).join('') + annotations.cities.map(row => `<g class="rail-city ${row.alongRoute ? 'along-route' : ''}" data-rail-city="${e(row.name)}" transform="translate(${row.point})"><circle r="${2 * unit}"/>${text(row)}</g>`).join('');
    stationLayer.innerHTML = annotations.stops.map(stop => {
      return `<g data-rail-segment="${stop.mySegment ? 'selected' : 'outside'}" transform="translate(${stop.point})"><circle r="${(stop.endpoint ? 5 : 3) * unit}" class="rail-stop ${stop.endpoint ? 'endpoint' : ''}"/><title>${e(stop.name)}</title>${text(stop)}</g>`;
    }).join('');
    playback.setStations(annotations.stops, stationLayer.children);
  }
  function schedule() { if (!animation) animation = requestAnimationFrame(draw); }
  const location = event => { const rect = frame.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top]; };
  const anchor = pixel => [viewport.x + (pixel[0] - width / 2) * 1000 / viewport.zoom / width, viewport.y + (pixel[1] - height / 2) * 1000 / viewport.zoom / width];
  function zoom(factor, pixel = [width / 2, height / 2]) {
    const before = anchor(pixel);
    viewport.zoom = Math.max(fitted.zoom * .5, Math.min(fitted.zoom * 32, viewport.zoom * factor));
    const after = anchor(pixel); viewport.x += before[0] - after[0]; viewport.y += before[1] - after[1]; schedule();
  }
  const center = () => { const list = [...pointers.values()]; return [list.reduce((s, p) => s + p[0], 0) / list.length, list.reduce((s, p) => s + p[1], 0) / list.length]; };
  const span = () => pointers.size === 2 ? Math.hypot(...[...pointers.values()][0].map((value, index) => value - [...pointers.values()][1][index])) : 0;
  const down = event => { if (event.target.closest('button') || (event.pointerType === 'mouse' && event.button !== 0)) return; event.preventDefault(); frame.setPointerCapture(event.pointerId); pointers.set(event.pointerId, location(event)); gesture = { center: center(), span: span() }; };
  const move = event => {
    if (!pointers.has(event.pointerId)) return; event.preventDefault(); pointers.set(event.pointerId, location(event));
    const next = center(), distance = span(), unit = 1000 / viewport.zoom / width;
    viewport.x -= (next[0] - gesture.center[0]) * unit; viewport.y -= (next[1] - gesture.center[1]) * unit;
    if (distance && gesture.span) zoom((distance / gesture.span) ** 1.25, next);
    gesture = { center: next, span: distance }; schedule();
  };
  const up = event => { pointers.delete(event.pointerId); gesture = pointers.size ? { center: center(), span: span() } : null; schedule(); };
  const wheel = event => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .008), location(event)); };
  const click = event => { const button = event.target.closest('[data-rail-zoom]'); if (!button) return; if (['fit', 'region'].includes(button.dataset.railZoom)) fit(button.dataset.railZoom === 'region'); else zoom(button.dataset.railZoom === 'in' ? 1.5 : 1 / 1.5); };
  const keydown = event => {
    if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault(); else return;
    if (event.key === '0') fit();
    else if (['+', '=', '-'].includes(event.key)) zoom(event.key === '-' ? 1 / 1.5 : 1.5);
    else { const step = 60 * 1000 / viewport.zoom / width; viewport.x += event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0; viewport.y += event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0; schedule(); }
  };
  frame.addEventListener('pointerdown', down); frame.addEventListener('pointermove', move); frame.addEventListener('pointerup', up); frame.addEventListener('pointercancel', up); frame.addEventListener('lostpointercapture', up); frame.addEventListener('wheel', wheel, { passive: false }); frame.addEventListener('click', click); svg.addEventListener('keydown', keydown);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null; observer?.observe(frame); fit();
  return () => { disposed = true; playback.dispose(); cancelAnimationFrame(animation); observer?.disconnect(); for (const [event, handler] of [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['lostpointercapture', up], ['wheel', wheel], ['click', click]]) frame.removeEventListener(event, handler); svg.removeEventListener('keydown', keydown); };
}

export function mountRailRoute(container, record) {
  const route=savedRailRoute(record);
  if(!container.isConnected || !route)return ()=>{};
    container.innerHTML = `<div class="rail-route-heading"><h3>铁路线路</h3><div class="rail-route-actions"><span>按现行线路推定</span><button type="button" class="button secondary small" data-rail-play-route>播放行程</button></div><span class="visually-hidden" role="status" data-rail-play-status></span></div><div class="rail-route-frame"><canvas aria-hidden="true"></canvas><svg tabindex="0" role="group" aria-label="${e(route.service + ' ' + route.origin + '至' + route.destination)}铁路线路图，可拖动及缩放"></svg><div class="map-controls"><button data-rail-zoom="in" aria-label="放大铁路线路">＋</button><button data-rail-zoom="out" aria-label="缩小铁路线路">−</button><button data-rail-zoom="fit" aria-label="显示完整铁路线路">↔</button><button data-rail-zoom="region" aria-label="区域总览，查看周边省界" title="区域总览，查看周边省界">区域</button></div><div class="rail-route-legend"><span>乘坐区间</span>${route.fullRoute ? '<span class="rail-full-line">区间外</span>' : ''}<span class="rail-border">省界</span></div></div><p class="rail-route-caption">${route.fullRoute ? e(route.fullRoute.stops[0].name)+' → '+e(route.fullRoute.stops.at(-1).name)+' · 乘坐：' : ''}${e(route.origin)} → ${e(route.destination)} · <a href="${RAIL_ROUTE_SOURCE}" target="_blank" rel="noopener noreferrer">线路数据：RailGo</a>${route.lineLabels?.length || route.fullRoute?.lineLabels?.length ? ` · ${e([...new Set([...(route.lineLabels||[]),...(route.fullRoute?.lineLabels||[])].map(label=>label.name))].join('、'))} · <a href="${RAIL_LINE_SOURCE}" target="_blank" rel="noopener noreferrer">线路名称：迷雾资料库</a>` : ''} · 查询于 ${e(route.queriedAt.slice(0, 10))}</p>`;
  container.hidden = false;
  return mountMap(container, route);
}
