const height = 195, left = 24, right = 24, top = 14, bottom = 147;
const tickFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact' });

const bandwidth = 2, radius = 3 * bandwidth;
const weights = Array.from({ length: 2 * radius + 1 }, (_, index) => Math.exp(-0.5 * ((index - radius) / bandwidth) ** 2));

export function smoothArrivalDelays(series) {
  const density = new Map();
  for (const { minutes, count } of series) {
    weights.forEach((weight, index) => {
      const minute = minutes + index - radius;
      density.set(minute, (density.get(minute) || 0) + weight * count);
    });
  }
  return density;
}

function tickStep(approximate) {
  const magnitude = 10 ** Math.floor(Math.log10(approximate));
  return [1, 2, 5, 10].map(step => step * magnitude).find(step => step >= approximate);
}

function delayPlot(series, density, width) {
  const plotWidth = width - left - right;
  const low = Math.min(0, series[0].minutes - radius - 1), high = Math.max(0, series.at(-1).minutes + radius + 1);
  const horizontal = tickStep(Math.max(1, (high - low) / Math.max(2, Math.floor(plotWidth / 62))));
  const first = Math.floor(low / horizontal) * horizontal, last = Math.ceil(high / horizontal) * horizontal;
  let peak = 0;
  for (const value of density.values()) peak = Math.max(peak, value);
  const x = minute => left + (minute - first) / (last - first) * plotWidth;
  const y = value => bottom - value / peak * (bottom - top);
  const minutesWithGaps = new Set([first, last]);
  // Only the edges of an empty interval are needed to draw its zero baseline.
  for (const minute of density.keys()) {
    minutesWithGaps.add(minute);
    if (!density.has(minute - 1)) minutesWithGaps.add(minute - 1);
    if (!density.has(minute + 1)) minutesWithGaps.add(minute + 1);
  }
  const points = [...minutesWithGaps].sort((a, b) => a - b).map(minute => [x(minute), y(density.get(minute) || 0)]);
  const slopes = points.slice(1).map(([x, y], index) => (y - points[index][1]) / (x - points[index][0]));
  const tangent = index => {
    const before = slopes[index - 1], after = slopes[index];
    return before * after > 0 ? 2 * before * after / (before + after) : 0;
  };
  const path = points.map(([endX, endY], index) => {
    if (!index) return `M${endX},${endY}`;
    const [startX, startY] = points[index - 1];
    const step = (endX - startX) / 3;
    return `C${startX + step},${startY + step * tangent(index - 1)} ${endX - step},${endY - step * tangent(index)} ${endX},${endY}`;
  }).join('');
  const horizontalTicks = Array.from({ length: (last - first) / horizontal + 1 }, (_, index) => first + index * horizontal);
  return `<path class="statistics-gridline" d="M${left},${bottom}H${width - right}"/>
    <path class="statistics-delay-zero" d="M${x(0)},${top}V${bottom}"/>
    ${horizontalTicks.map(minute => {
      const position = x(minute), label = minute < 0 ? '−' + tickFormat.format(-minute) : tickFormat.format(minute);
      return `<path class="statistics-gridline" d="M${position},${bottom}v5"/><text class="statistics-axis" x="${position}" y="${bottom + 20}" text-anchor="middle">${label}</text>`;
    }).join('')}
    <text class="statistics-axis" x="${left + plotWidth / 2}" y="${height - 7}" text-anchor="middle">延误分钟数</text>
    <path class="statistics-line" d="${path}"/>`;
}

export function bindArrivalDelayChart(container, series) {
  const frame = container.querySelector('[data-stat-delay-plot]');
  if (!frame) return () => {};
  const density = smoothArrivalDelays(series);
  const svg = frame.querySelector('svg');
  const win = frame.ownerDocument.defaultView;
  let width = 0;
  function draw() {
    const next = Math.max(224, Math.round(frame.clientWidth || 640));
    if (width === next) return;
    width = next;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = delayPlot(series, density, width);
  }
  draw();
  const observer = win.ResizeObserver ? new win.ResizeObserver(draw) : null;
  if (observer) observer.observe(frame);
  else win.addEventListener('resize', draw);
  return () => {
    observer?.disconnect();
    win.removeEventListener('resize', draw);
  };
}
