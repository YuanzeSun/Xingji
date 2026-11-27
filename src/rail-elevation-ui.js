import { escape as e } from './html.js';
import { readRailElevation, sampleRailElevation } from './rail-elevation.js';

export const railElevationMarkup = `<details class="rail-elevation" data-rail-elevation>
  <summary>沿线地表海拔</summary><div class="rail-elevation-content" data-rail-elevation-content></div>
</details>`;

const viewHeight = 176, left = 52, right = 16, top = 16, bottom = 139;
const meters = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
const kilometers = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 });

function bindProfile(content, route, { samples, total }, elevation, markLocation, isPlaying) {
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
  slider.addEventListener('input', fromSlider);
  svg.addEventListener('pointermove', fromPointer);
  svg.addEventListener('click', fromPointer);
  draw();
  const observer = window.ResizeObserver ? new window.ResizeObserver(draw) : null;
  if (observer) observer.observe(frame);
  else window.addEventListener('resize', draw);

  return {
    select, follow, show() { markLocation(selection.point.mapPoint); },
    dispose() {
      observer?.disconnect();
      window.removeEventListener('resize', draw);
      slider.removeEventListener('input', fromSlider);
      svg.removeEventListener('pointermove', fromPointer);
      svg.removeEventListener('click', fromPointer);
    }
  };
}

export function bindRailElevation(container, route, projected, markLocation) {
  const details = container.querySelector('[data-rail-elevation]');
  const content = details.querySelector('[data-rail-elevation-content]');
  let sampling, profile, request, playbackDistance, appliedDistance, playing = false;
  function showProfile() {
    if (playbackDistance !== appliedDistance) {
      profile.follow(sampling.atMapDistance(playbackDistance));
      appliedDistance = playbackDistance;
    } else {
      profile.show();
    }
  }
  async function load() {
    if (request) return;
    sampling ??= sampleRailElevation(route.segments, projected);
    if (!sampling) { content.textContent = '暂无可绘制的乘坐轨迹。'; return; }
    const active = request = new AbortController();
    content.innerHTML = '<p role="status">正在读取沿线海拔…</p>';
    try {
      const elevation = await readRailElevation(sampling.samples, { signal: active.signal });
      if (!active.signal.aborted && details.open) {
        profile = bindProfile(content, route, sampling, elevation, point => { if (details.open) markLocation(point); }, () => playing);
        showProfile();
      }
    } catch {
      if (!active.signal.aborted) {
        content.innerHTML = '<p role="status">暂时无法加载沿线海拔。 <button class="text-button" type="button" data-retry-rail-elevation>重试</button></p>';
      }
    } finally {
      if (request === active) request = null;
    }
  }
  function toggle() {
    if (details.open) {
      if (profile) showProfile(); else void load();
    } else {
      request?.abort();
      request = null;
      markLocation(null);
    }
  }
  const retry = event => { if (event.target.closest('[data-retry-rail-elevation]')) void load(); };
  details.addEventListener('toggle', toggle);
  content.addEventListener('click', retry);
  return {
    follow(distance, active) {
      playbackDistance = distance;
      playing = active;
      if (details.open && profile) showProfile();
    },
    pick(point, unit) {
      if (details.open && profile) profile.select(sampling.pick(point, 12 * unit));
    },
    dispose() {
      request?.abort();
      profile?.dispose();
      details.removeEventListener('toggle', toggle);
      content.removeEventListener('click', retry);
      markLocation(null);
    }
  };
}
