import {calendarDate,dateLabel} from './journey-date.js';
import { escape as e } from './html.js';
import { journeyNetwork, networkGeometry } from './journey-map-model.js';
import { mapPlaybackTrips, bindMapPlayback } from './journey-map-playback.js';
import { LAND_PATH, PROVINCE_PATH, COUNTRY_PATH } from './data/map-reference.js';
import { createMapBasemap } from './map-basemap.js';
import { savedRailwayNetwork, railwayGeometry, railwayTicketPicker } from './railway-network.js';
import { RAIL_ROUTE_SOURCE } from './rail-route.js';
import { isJourneyRecord } from './record-kind.js';
import {railLineAnnotations} from './rail-line-names.js';
import { showRelatedTickets } from './related-tickets.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const layers = [['rail', '火车'], ['flight', '飞机'], ['airway', '航线'], ['railway', '铁路线']];
const exclusiveLayer = { rail: 'railway', railway: 'rail', flight: 'airway', airway: 'flight' };
export function mountJourneyMap(container, records, { icon, options = {} }) {
  records = records.filter(isJourneyRecord);
  options.layers ??= ['airway', 'railway'];
  let disposed = false, observer, cleanupCanvas, railState;
  const departureYears = new Set(records.map(record => calendarDate(record.departureDate).slice(0, 4)));
  const years = [...departureYears].filter(Boolean).sort().reverse();
  function render() {
    cleanupCanvas?.();
    const year = options.year || 'all';
    const visibleRecords = year === 'all' ? records : records.filter(record => {
      const date = calendarDate(record.departureDate);
      return year === 'unknown' ? !date : date.startsWith(year);
    });
    const railway = options.layers.includes('railway');
    if (railway && railState?.year !== year) {
      const data = savedRailwayNetwork(visibleRecords);
      railState = { year, data, geometry: railwayGeometry(data) };
      if (!options.userMoved) options.viewport = null;
    }
    const networks = [];
    if (options.layers.includes('rail')) networks.push(journeyNetwork(visibleRecords, { type: 'rail', deduplicate: false }));
    if (options.layers.includes('flight') || options.layers.includes('airway')) networks.push(journeyNetwork(visibleRecords, { type: 'flight', deduplicate: options.layers.includes('airway') }));
    const network = { nodes: networks.flatMap(part => part.nodes), routes: networks.flatMap(part => part.routes) };
    const savedRoutes = railway ? railState.data.routes : [];
    const railMapped = savedRoutes.reduce((count, row) => count + row.records.length, 0);
    const railGeometry = railway ? railState.geometry : null;
    const geometry = networkGeometry(network, railGeometry);
    const playbackScope = year === 'all' ? '全部行程' : years.includes(year) ? '年度行程' : '';
    let playbackGeometry = geometry, trips = [];
    if (playbackScope) {
      const hasDate = record => Boolean(calendarDate(record.departureDate));
      const hasDatedTrip = route => route.records.some(hasDate);
      const arcs = network.routes.filter(hasDatedTrip);
      const railRoutes = savedRoutes.filter(hasDatedTrip);
      const tracks = railRoutes.length === savedRoutes.length ? railGeometry : railwayGeometry({ routes: railRoutes });
      const endpoints = new Set(arcs.flatMap(route => [route.from.id, route.to.id]));
      const nodes = network.nodes.filter(node => endpoints.has(node.id));
      if (arcs.length !== network.routes.length || tracks !== railGeometry || nodes.length !== network.nodes.length) {
        playbackGeometry = networkGeometry({ nodes, routes: arcs }, tracks);
      }
      trips = mapPlaybackTrips(playbackGeometry.routes, railRoutes);
    }
    const mapped = networks.reduce((count, part) => count + part.mapped, railMapped);
    const routeCount = network.routes.length + savedRoutes.length;
    const hasGeometry = !!geometry.trackPath || !!geometry.nodes.length;
    let selected = network.routes.find(route => route.id === options.selected);
    let node = geometry.nodes.find(node => node.id === options.node);
    if (!selected) options.selected = '';
    if (!node) options.node = '';
    const bitmap=typeof window.Path2D==='function';
    const background=()=>`<defs><path id="journey-map-land" d="${LAND_PATH}" vector-effect="non-scaling-stroke" fill-rule="evenodd" /><path id="journey-map-countries" d="${COUNTRY_PATH}" vector-effect="non-scaling-stroke" /><path id="journey-map-provinces" d="${PROVINCE_PATH}" vector-effect="non-scaling-stroke" /></defs><g class="map-land">${[-2000, -1000, 0, 1000, 2000].map(x => `<use href="#journey-map-land" transform="translate(${x},0)"/>`).join('')}</g><g class="map-countries">${[-1000, 0, 1000].map(x => `<use href="#journey-map-countries" transform="translate(${x},0)"/>`).join('')}</g><g class="map-provinces">${[-1000, 0, 1000].map(x => `<use href="#journey-map-provinces" transform="translate(${x},0)"/>`).join('')}</g>`;
    const grid=Array.from({length:73},(_,i)=>`<path d="M${i*1000/12-2000},0v500"/>`).join('')+Array.from({length:5},(_,i)=>`<path d="M-2000,${(i+1)*1000/12}h5000"/>`).join('');
    container.innerHTML = `<div class="journey-map-layout"><section class="map-card" aria-label="行程地图"><div class="journey-map-toolbar"><div class="map-type-tabs" role="group" aria-label="地图图层">${layers.map(([value, label]) => `<button type="button" data-map-layer="${value}" aria-pressed="${options.layers.includes(value)}" class="${options.layers.includes(value) ? 'active' : ''}"><span class="map-layer-check" aria-hidden="true">${options.layers.includes(value) ? '✓' : ''}</span>${label}</button>`).join('')}</div><div class="map-year-actions"><label class="map-year"><span class="visually-hidden">地图年份</span><select data-map-year aria-label="地图年份"><option value="all">全部年份</option>${years.map(year => `<option ${options.year === year ? 'selected' : ''}>${year}</option>`).join('')}${departureYears.has('') ? `<option value="unknown" ${options.year === 'unknown' ? 'selected' : ''}>日期未知</option>` : ''}</select></label>${playbackScope ? `<button type="button" class="map-playback-button" data-map-playback-button ${trips.length ? '' : 'disabled'}>播放${playbackScope}</button>` : ''}</div></div><div class="map-frame">${bitmap ? '<canvas class="map-base-canvas" aria-hidden="true"></canvas>' : ''}<svg class="journey-map-canvas" tabindex="0" role="group" aria-label="行程地图，可拖动或使用方向键移动，用加减键缩放">${bitmap ? '' : background()}<g class="map-graticule">${grid}</g><g class="map-real-tracks" aria-hidden="true"></g><g class="map-routes"></g><g class="map-playback" aria-hidden="true"></g><g class="map-nodes"></g><g class="map-labels" aria-hidden="true"></g><g class="map-rail-line-names" aria-hidden="true"></g></svg>${playbackScope ? '<p class="map-playback-status" data-map-playback-status role="status" hidden></p>' : ''}<div class="map-controls"><button data-map-zoom="in" aria-label="放大地图" title="放大">＋</button><button data-map-zoom="out" aria-label="缩小地图" title="缩小">−</button><button data-map-fit aria-label="显示全部路线" title="显示全部路线">${icon('map')}</button></div>${!hasGeometry ? '<div class="map-empty"><strong>' + (!options.layers.length ? '请选择要显示的图层' : '暂无可绘制的行程') + '</strong></div>' : ''}<div class="map-legend">${layers.filter(([value]) => options.layers.includes(value)).map(([value, label]) => `<span class="${value === 'airway' ? 'flight' : value}">${label}</span>`).join('')}</div></div><div class="map-totals"><span><strong>${mapped}</strong>行程</span><span><strong>${routeCount}</strong>路线</span><span><strong>${geometry.nodes.length}</strong>地点</span></div></section></div>`;
    if (railway) {
      const { records, unmatched, failed } = railState.data;
      container.querySelector('.map-totals').insertAdjacentHTML('afterend', `<div class="map-railway-status"><span>铁路 <strong>${railMapped} / ${records.length}</strong> 已匹配</span><span><strong>${unmatched.length}</strong>未匹配</span><span><strong>${failed.length}</strong>加载失败</span></div>`);
      container.querySelector('.map-card').classList.add('is-railway');
      container.querySelector('.map-frame').insertAdjacentHTML('beforeend','<a class="railgo-map-credit" href="' + RAIL_ROUTE_SOURCE + '" target="_blank" rel="noopener noreferrer">RailGo</a>');
    }
    const svg = container.querySelector('.journey-map-canvas'), frame = container.querySelector('.map-frame');
    if (railway && geometry.trackPath) svg.querySelector('.map-real-tracks').innerHTML = [-1000, 0, 1000].map(offset => '<path class="map-track" d="' + geometry.trackPath + '" transform="translate(' + offset + ',0)"/>').join('');
    const basemap=createMapBasemap(container.querySelector('.map-base-canvas'));
    if(bitmap&&!basemap)svg.insertAdjacentHTML('afterbegin',background());
    const routes=geometry.routes.flatMap(route=>[-1000,0,1000].map(offset=>{const xs=route.points.map(point=>point[0]+offset),ys=route.points.map(point=>point[1]);return {...route,offset,bounds:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]};}));
    const wrapNodes = nodes => nodes.flatMap(node => [-1000, 0, 1000].map(offset => ({ ...node, point: [node.point[0] + offset, node.point[1]] })));
    const nodes = wrapNodes(geometry.nodes);
    const playbackNodes = playbackGeometry === geometry ? nodes : wrapNodes(playbackGeometry.nodes);
    let viewport = options.viewport ? { ...options.viewport } : null, aspect = 1.6, width = 1000, height = 620, dragged = false, gesture = null;
    let frameBounds,animation=0,wheelTimer=0,needsDetails=false,alive=true;
    const requestFrame=window.requestAnimationFrame?.bind(window)|| (callback=>window.setTimeout(()=>callback(window.performance.now()),16));
    const cancelFrame=window.cancelAnimationFrame?.bind(window)||window.clearTimeout.bind(window);
    const playbackButton = container.querySelector('[data-map-playback-button]');
    let beforePlayback;
    const playback = trips.length ? bindMapPlayback(svg, playbackButton, container.querySelector('[data-map-playback-status]'), trips, {
      scope: playbackScope, requestFrame, cancelFrame,
      redraw() {
        if (playback.running && !beforePlayback) {
          beforePlayback = { viewport, userMoved: options.userMoved };
          fit();
        } else if (!playback.running && beforePlayback) {
          ({ viewport, userMoved: options.userMoved } = beforePlayback);
          beforePlayback = null;
        }
        draw();
      }
    }) : null;

    const pointers = new Map();
    const measure = () => { const rect = frameBounds = frame.getBoundingClientRect(); width = rect.width || 1000; height = rect.height || 620; aspect = width / height; };
    const mapBounds = () => playback?.running ? playbackGeometry.bounds : geometry.bounds;
    function fitZoom() {
      const [x1, y1, x2, y2] = mapBounds(), padding = Math.min(.24, 48 / Math.min(width, height));
      return clamp(Math.min(1000 * (1 - padding * 2) / Math.max(railway ? .15 : 18, x2 - x1), 1000 / aspect * (1 - padding * 2) / Math.max(railway ? .1 : 14, y2 - y1)), .8, railway ? 6000 : 28);
    }
    const fit = () => {
      options.userMoved = false;
      const [x1, y1, x2, y2] = mapBounds();
      viewport = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, zoom: fitZoom() };
    };
    function storeViewport() {
      const viewHeight=1000/viewport.zoom/aspect;
      viewport.y=viewHeight<500?clamp(viewport.y,viewHeight/2,500-viewHeight/2):250;
      viewport.x=clamp(viewport.x,-500,1500);options.viewport={...viewport};
    }
    function scheduleDraw(detailed=false) {
      storeViewport();needsDetails ||= detailed;
      if(animation)return;
      animation=requestFrame(()=>{animation=0;if(!alive)return;const full=needsDetails;needsDetails=false;draw(full);});
    }
    function draw(detailed=true) {
      storeViewport();
      const viewWidth=1000/viewport.zoom,viewHeight=viewWidth/aspect,unit=viewWidth/width;
      svg.setAttribute('viewBox',`${viewport.x-viewWidth/2} ${viewport.y-viewHeight/2} ${viewWidth} ${viewHeight}`);
      if (playback?.running) svg.style.setProperty('--map-playback-unit', `${unit}px`);
      basemap?.draw(viewport,width,height,!detailed);
      if(!detailed)return;
      const active = route => selected ? route.id === selected.id : node ? node.routes.has(route.id) : true;
      const left = viewport.x - viewWidth / 2, right = viewport.x + viewWidth / 2, top = viewport.y - viewHeight / 2, bottom = viewport.y + viewHeight / 2;
      const visibleRoutes = playback?.running ? [] : routes.filter(route=>route.bounds[2]>=left&&route.bounds[0]<=right&&route.bounds[3]>=top&&route.bounds[1]<=bottom);
      const candidates = playback?.running ? [
        ...playbackNodes.filter(node => playback.reached.has(node.id)),
        ...wrapNodes([...playback.stations.values()].filter(station => !playback.reached.has(station.id)))
      ] : nodes;
      const visibleNodes=candidates.filter(node=>node.point[0]>=left-15*unit&&node.point[0]<=right+15*unit&&node.point[1]>=top-15*unit&&node.point[1]<=bottom+15*unit);
      svg.querySelector('.map-routes').innerHTML = [...visibleRoutes].sort((a, b) => Number(active(a)) - Number(active(b))).map(route => {
        const description = route.from.name + (route.aggregated ? ' ↔ ' : ' → ') + route.to.name + ' · ' + (route.aggregated ? route.records.length + ' 程' : [route.records[0].service, dateLabel(route.records[0].departureDate)].filter(Boolean).join(' '));
        const attrs = `d="${route.path}" transform="translate(${route.offset},0)" data-map-route="${e(route.id)}"`;
        return `<path class="map-route-hit" ${attrs} aria-hidden="true"/><path class="map-route ${route.type} ${active(route) ? 'emphasized' : 'dimmed'} ${route.id === selected?.id ? 'selected' : ''}" ${attrs} tabindex="0" role="button" aria-haspopup="dialog" aria-label="${e(description)}" style="--route-width:${route.aggregated ? Math.min(4, 1.5 + Math.log2(route.records.length + 1) * .45) : 1.7}"><title>${e(description)}</title></path>`;
      }).join('');
      svg.querySelector('.map-nodes').innerHTML = visibleNodes.map(point => `<g class="map-node ${point.id === options.node ? 'selected' : ''}" ${playback?.running ? '' : `data-map-node="${e(point.id)}" tabindex="0" role="button" aria-haspopup="dialog" aria-label="${e(point.name + '，' + point.trips.size + '程')}"`}><circle class="node-hit" cx="${point.point[0]}" cy="${point.point[1]}" r="${13 * unit}"/><circle cx="${point.point[0]}" cy="${point.point[1]}" r="${(point.id === options.node ? 5.5 : 3.5) * unit}"/><title>${e(point.name)}${point.code ? ' · ' + point.code : ''}</title></g>`).join('');
      const occupied = [], labels = [], labelledNodes = new Set();
      const labelLimit = clamp(Math.round(width * height * clamp(viewport.zoom / fitZoom(), .5, 5) / 28000), 4, 60);
      const railLabels = playback?.running ? [...playback.labels] : geometry.lineLabels;
      const lineAllowance = railLabels.length ? Math.ceil(labelLimit / 3) : 0;
      for (const point of [...visibleNodes].sort((a, b) =>
        Number(b.id === options.node) - Number(a.id === options.node) || b.trips.size - a.trips.size)) {
        if (labels.length >= labelLimit - lineAllowance) break;
        if (labelledNodes.has(point.id)) continue;
        const [x, y] = point.point, sx = (x - viewport.x) / unit + width / 2, sy = (y - viewport.y) / unit + height / 2, textWidth = [...point.name].length * 12.5;
        if (sx < 0 || sx > width || sy < 0 || sy > height) continue;
        let placed = false;
        for (const direction of [-1, 1]) {
          for (const side of [1, -1]) {
            const left = side === 1 ? sx + 8 : sx - 8 - textWidth, box = [left, sy + direction * 17 - 13, left + textWidth, sy + direction * 17 + 3];
            if (box[0] < 8 || box[2] > width - 8 || box[1] < 8 || box[3] > height - 8 || occupied.some(b => box[0] < b[2] + 5 && box[2] > b[0] - 5 && box[1] < b[3] + 4 && box[3] > b[1] - 4)) continue;
            occupied.push(box); labelledNodes.add(point.id); labels.push(`<text x="${x + side * 8 * unit}" y="${y + direction * 17 * unit}" text-anchor="${side === 1 ? 'start' : 'end'}" font-size="${12.5 * unit}" stroke-width="${3 * unit}">${e(point.name)}</text>`); placed = true; break;
          }
          if (placed) break;
        }
      }
      svg.querySelector('.map-labels').innerHTML = labels.join('');
      if(railway)svg.querySelector('.map-rail-line-names').innerHTML=railLineAnnotations(railLabels,viewport,width,height,occupied,Math.min(20,labelLimit-labels.length)).map(row=>`<g class="rail-line-name" data-rail-line-name="${e(row.name)}" transform="translate(${row.point})"><text x="${row.label.dx*unit}" y="${row.label.dy*unit}" font-size="${row.label.fontSize*unit}" stroke-width="${3*unit}">${e(row.name)}</text></g>`).join('');
    }
    function zoom(factor, anchor = [width / 2, height / 2], base = viewport, currentAnchor = anchor, interactive = false) {
      options.userMoved = true;
      const next = clamp(base.zoom * factor, .8, railway ? 50000 : 40), oldUnit = 1000 / base.zoom / width, newUnit = 1000 / next / width;
      viewport = { x: base.x + (anchor[0] - width / 2) * oldUnit - (currentAnchor[0] - width / 2) * newUnit, y: base.y + (anchor[1] - height / 2) * oldUnit - (currentAnchor[1] - height / 2) * newUnit, zoom: next }; if(interactive)scheduleDraw();else draw();
    }
    const pointerPosition = event => [event.clientX-frameBounds.left,event.clientY-frameBounds.top];
    const down = event => {
      if (event.button !== 0) return;
      frameBounds=frame.getBoundingClientRect();
      pointers.set(event.pointerId, pointerPosition(event)); dragged = false;
      if (pointers.size === 1) gesture = { start: pointerPosition(event), viewport: { ...viewport } };
      else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { distance: Math.hypot(a[0] - b[0], a[1] - b[1]), anchor: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], viewport: { ...viewport } }; }
    };
    const move = event => {
      if (!pointers.has(event.pointerId)) return;
      const point = pointerPosition(event); pointers.set(event.pointerId, point);
      if (pointers.size === 2 && gesture?.distance) { const [a, b] = [...pointers.values()]; zoom((Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(1, gesture.distance)) ** 1.7, gesture.anchor, gesture.viewport, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], true); dragged = true; }
      else if (pointers.size === 1 && gesture?.start) {
        const dx = point[0] - gesture.start[0], dy = point[1] - gesture.start[1]; if (Math.hypot(dx, dy) < 4 && !dragged) return;
        dragged = true; options.userMoved = true; const unit = 1000 / gesture.viewport.zoom / width; viewport = { ...gesture.viewport, x: gesture.viewport.x - dx * unit, y: gesture.viewport.y - dy * unit }; scheduleDraw();
      }
      if (dragged) { event.preventDefault(); if (event.isTrusted) svg.setPointerCapture?.(event.pointerId); frame.classList.add('dragging'); }
    };
    const up = event => {
      pointers.delete(event.pointerId);
      gesture = pointers.size === 1 ? { start: [...pointers.values()][0], viewport: { ...viewport } } : null;
      if (!pointers.size) {
        frame.classList.remove('dragging');
        if (dragged) scheduleDraw(true);
      }
    };
    const wheel = event => {
      if(!event.ctrlKey&&!event.metaKey)return;
      event.preventDefault();if(!wheelTimer)frameBounds=frame.getBoundingClientRect();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?height:1),anchor=pointerPosition(event);
      zoom(Math.exp(-clamp(delta,-120,120)*.008),anchor,viewport,anchor,true);
      window.clearTimeout(wheelTimer);wheelTimer=window.setTimeout(()=>{wheelTimer=0;scheduleDraw(true);},120);
    };
    function openMapTickets(title, tickets) {
      draw();
      showRelatedTickets(container, title, tickets, svg);
    }
    const click = event => {
      if (dragged) { dragged = false; if (event.target.closest('svg')) return; }
      const target = event.target.closest('[data-map-route],[data-map-node],[data-map-zoom],[data-map-fit]');
      if (target?.hasAttribute('data-map-zoom')) { zoom(target.dataset.mapZoom === 'in' ? 1.5 : 1 / 1.5); return; }
      if (target?.hasAttribute('data-map-fit')) { fit(); draw(); return; }
      if (playback?.running || !svg.contains(event.target)) return;
      if (target?.hasAttribute('data-map-route')) {
        selected = network.routes.find(route => route.id === target.dataset.mapRoute);
        node = undefined;
        options.selected = selected.id;
        options.node = '';
        openMapTickets(selected.from.name + (selected.aggregated ? ' ↔ ' : ' → ') + selected.to.name, selected.records);
      } else if (target?.hasAttribute('data-map-node')) {
        node = geometry.nodes.find(point => point.id === target.dataset.mapNode);
        selected = undefined;
        options.node = node.id;
        options.selected = '';
        openMapTickets(node.name, visibleRecords.filter(record => node.trips.has(record.id)));
      } else if (savedRoutes.length && event.type === 'click') {
        const rect = svg.getBoundingClientRect(), unit = 1000 / viewport.zoom / width;
        const point = [viewport.x + (event.clientX - rect.left - width / 2) * unit,
          viewport.y + (event.clientY - rect.top - height / 2) * unit];
        railState.pickTickets ??= railwayTicketPicker(savedRoutes);
        const tickets = railState.pickTickets(point, unit);
        if (tickets.length) showRelatedTickets(container, '途经此处的铁路票据', tickets, svg);
      }
    };
    const keydown = event => {
      if (['Enter', ' '].includes(event.key) && event.target.closest('[data-map-route],[data-map-node]')) { event.preventDefault(); click(event); return; }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (playback?.running) playback.stop();
        else { options.selected = ''; options.node = ''; selected = node = undefined; draw(); svg.focus(); }
        return;
      }
      if (event.target !== svg) return;
      if (['+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) event.preventDefault();
      if (['+', '='].includes(event.key)) zoom(1.5); else if (event.key === '-') zoom(1 / 1.5); else if (event.key === 'Home') { fit(); draw(); }
      else if (event.key.startsWith('Arrow')) { const step = 1000 / viewport.zoom * .12; viewport.x += event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0; viewport.y += event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0; draw(); }
    };
    measure(); if (!viewport) fit(); draw();
    container.addEventListener('click', click); svg.addEventListener('keydown', keydown); svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); svg.addEventListener('wheel', wheel, { passive: false });
    const resize = () => { if (disposed) return; const oldWidth = width; measure(); if (oldWidth !== width && !options.userMoved) fit(); draw(); };
    if (window.ResizeObserver) { observer = new window.ResizeObserver(resize); observer.observe(frame); }
    else window.addEventListener('resize', resize);
    cleanupCanvas = () => { alive=false;playback?.dispose();cancelFrame(animation);window.clearTimeout(wheelTimer);observer?.disconnect(); container.removeEventListener('click', click); window.removeEventListener('resize', resize); };
  }
  function resetView() { options.viewport = null; options.userMoved = false; options.selected = ''; options.node = ''; render(); }
  const change = event => { if (event.target.matches('[data-map-year]')) { options.year = event.target.value; resetView(); } };
  const click = event => {
    const target = event.target.closest('[data-map-layer]'); if (!target) return;
    const layer = target.dataset.mapLayer;
    options.layers = options.layers.includes(layer) ? options.layers.filter(value => value !== layer) : [...options.layers.filter(value => value !== exclusiveLayer[layer]), layer];
    resetView();
  };
  container.addEventListener('change', change); container.addEventListener('click', click); render();
  return () => { disposed = true; cleanupCanvas?.(); container.removeEventListener('change', change); container.removeEventListener('click', click); };
}
