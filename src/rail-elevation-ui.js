import { escape as e } from './html.js';
import { sampleRailElevation } from './rail-elevation.js';

const viewHeight = 176, left = 52, right = 16, top = 16, bottom = 139;
const meters = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const kilometers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

function bindProfile(content, route, { samples, total }, elevation, { markLocation, isPlaying, signal }) {
  content.innerHTML = `<div class="rail-elevation-ends"><strong>${e(route.origin)}</strong><strong>${e(route.destination)}</strong></div>
    <div class="rail-elevation-plot">
      <svg aria-hidden="true"></svg>
      <input class="visually-hidden" type="range" min="0" max="${samples.length - 1}" value="0" aria-label="沿线海拔采样位置" />
    </div>
    <div class="rail-elevation-meta"><output aria-live="off"></output><span>
      <a href="https://open-meteo.com/en/docs/elevation-api" target="_blank" rel="noopener noreferrer">Open-Meteo</a> ·
      <a href="https://doi.org/10.5270/ESA-c5d3d65" target="_blank" rel="noopener noreferrer">Copernicus DEM</a></span></div>`;
  const frame = content.querySelector('.rail-elevation-plot'), svg = frame.querySelector('svg');
  const slider = frame.querySelector('input'), output = content.querySelector('output');
  const window = content.ownerDocument.defaultView, finite = elevation.filter(Number.isFinite);
  const minimum = Math.min(...finite), maximum = Math.max(...finite);
  const range = Math.max(20, (maximum - minimum) / 3);
  const magnitude = 10 ** Math.floor(Math.log10(range));
  const interval = [1, 2, 5, 10].map(tick => tick * magnitude).find(tick => tick >= range);
  const low = Math.floor(minimum / interval) * interval;
  const high = Math.max(low + 2 * interval, Math.ceil(maximum / interval) * interval);
  const y = value => bottom - (value - low) / (high - low) * (bottom - top);
  let width, cursor, dot;
  let selection = { point: samples[0], value: elevation[0], index: 0 };
  const x = distance => left + distance / total * (width - left - right);

  function paintSelection() {
    const { point, value, index } = selection;
    const label = `${kilometers.format(point.distance)} 公里 · ${value === null ? '暂无高程' : meters.format(value) + ' 米'}`;
    slider.value = String(index);
    slider.setAttribute('aria-valuetext', label);
    output.textContent = label;
    cursor.setAttribute('transform', `translate(${x(point.distance)},0)`);
    dot.toggleAttribute('data-unavailable', value === null);
    if (value !== null) dot.setAttribute('cy', y(value));
    markLocation(point.mapPoint);
  }
  function select(index) {
    if (index === null || isPlaying() || samples[index] === selection.point) return;
    selection = { point: samples[index], value: elevation[index], index };
    paintSelection();
  }
  function follow(point) {
    const offset = point.distance / total * (samples.length - 1);
    const before = Math.floor(offset), after = Math.ceil(offset);
    let value = null;
    if (samples[before].group === point.group && samples[after].group === point.group &&
        elevation[before] !== null && elevation[after] !== null) {
      value = elevation[before] + (elevation[after] - elevation[before]) * (offset - before);
    }
    selection = { point, value, index: Math.round(offset) };
    paintSelection();
  }
  function draw() {
    const nextWidth = Math.round(frame.clientWidth) || 640;
    if (nextWidth === width) return;
    width = nextWidth;
    const ticks = Array.from({ length: Math.round((high - low) / interval) + 1 }, (_, index) => {
      const level = low + index * interval, row = y(level);
      return `<path class="rail-elevation-grid" d="M${left},${row}H${width - right}"/><text x="${left - 7}" y="${row + 4}" text-anchor="end">${meters.format(level)}</text>`;
    });
    const runs = [];
    let group;
    for (const [index, sample] of samples.entries()) {
      if (elevation[index] === null) { group = undefined; continue; }
      if (group !== sample.group) {
        group = sample.group;
        runs.push([]);
      }
      runs.at(-1).push([x(sample.distance), y(elevation[index])]);
    }
    const profile = runs.map(run => {
      if (run.length === 1) return `<circle class="rail-elevation-point" cx="${run[0][0]}" cy="${run[0][1]}" r="2"/>`;
      const path = 'M' + run.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join('L');
      return `<path class="rail-elevation-area" d="${path}V${bottom}H${run[0][0]}Z"/><path class="rail-elevation-line" d="${path}"/>`;
    }).join('');
    const steps = width > 460 ? 4 : 2;
    const distanceLabels = Array.from({ length: steps + 1 }, (_, index) => {
      const distance = total * index / steps;
      const anchor = index === 0 ? 'start' : index === steps ? 'end' : 'middle';
      return `<text x="${x(distance)}" y="158" text-anchor="${anchor}">${kilometers.format(distance)}${index === steps ? ' 公里' : ''}</text>`;
    }).join('');
    svg.setAttribute('viewBox', `0 0 ${width} ${viewHeight}`);
    svg.innerHTML = `<text x="${left - 7}" y="10" text-anchor="end">米</text>${ticks.join('')}${profile}${distanceLabels}
      <g data-elevation-cursor><path d="M0,${top}V${bottom}"/><circle data-elevation-dot r="4.6"/></g>`;
    cursor = svg.querySelector('[data-elevation-cursor]');
    dot = svg.querySelector('[data-elevation-dot]');
    paintSelection();
  }

  const fromPointer = event => {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0) return;
    const relative = (event.clientX - bounds.left) * width / bounds.width;
    const fraction = Math.max(0, Math.min(1, (relative - left) / (width - left - right)));
    select(Math.round(fraction * (samples.length - 1)));
  };
  const fromSlider = () => {
    if (isPlaying()) slider.value = String(selection.index);
    else select(Number(slider.value));
  };
  slider.addEventListener('input', fromSlider, { signal });
  svg.addEventListener('pointermove', fromPointer, { signal });
  svg.addEventListener('click', fromPointer, { signal });
  draw();
  const observer = window.ResizeObserver ? new window.ResizeObserver(draw) : null;
  if (observer) observer.observe(frame);
  else window.addEventListener('resize', draw, { signal });

  return {
    select, follow,
    dispose() { observer?.disconnect(); }
  };
}

export function bindRailElevation(container, route, projected, markLocation) {
  if (!route.elevation) return null;
  const sampling = sampleRailElevation(route.segments, projected);
  const values = route.elevation.values;
  if (sampling?.samples.length !== values.length) return null;
  container.insertAdjacentHTML('beforeend', `<section class="rail-elevation" data-rail-elevation aria-label="沿线地表海拔">
    <h4>沿线地表海拔</h4><div class="rail-elevation-content"></div>
  </section>`);
  const content = container.querySelector('.rail-elevation-content');
  const listeners = new container.ownerDocument.defaultView.AbortController();
  let playing = false;
  const profile = bindProfile(content, route, sampling, values, {
    markLocation, isPlaying: () => playing, signal: listeners.signal
  });
  return {
    follow(distance, active) {
      playing = active;
      profile.follow(sampling.atMapDistance(distance));
    },
    pick(point, unit) {
      if (!playing) profile.select(sampling.pick(point, 12 * unit));
    },
    dispose() {
      profile.dispose();
      listeners.abort();
      markLocation(null);
    }
  };
}
