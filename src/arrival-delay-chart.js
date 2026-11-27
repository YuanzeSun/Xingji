const height = 230, left = 56, right = 24, top = 27, bottom = 180;
const tickFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact' });
const shareFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumSignificantDigits: 3 });
const minuteLabel = minutes => minutes < 0 ? '−' + Math.abs(minutes) : String(minutes);
const pointLabel = ({ minutes, count }, share) => `${minuteLabel(minutes)} 分钟 · 平滑占比 ${shareFormat.format(share)} · 实际 ${count} 班`;

const bandwidth = 2, radius = 3 * bandwidth;
const weights = Array.from({ length: 2 * radius + 1 }, (_, index) => Math.exp(-0.5 * ((index - radius) / bandwidth) ** 2));
const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

export function smoothedDelayShares(series) {
  const total = series.reduce((sum, point) => sum + point.count, 0);
  const shares = new Map();
  // Each observed minute contributes its share over a fixed neighbourhood, preserving total mass.
  for (const { minutes, count } of series) {
    const scale = count / (total * weightSum);
    weights.forEach((weight, index) => {
      const minute = minutes + index - radius;
      shares.set(minute, (shares.get(minute) || 0) + weight * scale);
    });
  }
  return shares;
}

function tickStep(approximate) {
  const magnitude = 10 ** Math.floor(Math.log10(approximate));
  return [1, 2, 5, 10].map(step => step * magnitude).find(step => step >= approximate);
}

function delayPlot(series, shares, width) {
  const plotWidth = width - left - right;
  const low = Math.min(0, series[0].minutes - radius - 1), high = Math.max(0, series.at(-1).minutes + radius + 1);
  const horizontal = tickStep(Math.max(1, (high - low) / Math.max(2, Math.floor(plotWidth / 62))));
  const first = Math.floor(low / horizontal) * horizontal, last = Math.ceil(high / horizontal) * horizontal;
  let peak = 0;
  for (const share of shares.values()) peak = Math.max(peak, share);
  const vertical = tickStep(peak / 4), tickCount = Math.ceil(peak / vertical);
  const x = minute => left + (minute - first) / (last - first) * plotWidth;
  const y = share => bottom - share / (vertical * tickCount) * (bottom - top);
  const minutesWithGaps = new Set([first, last]);
  // Only the edges of an empty interval are needed to draw its zero baseline.
  for (const minute of shares.keys()) {
    minutesWithGaps.add(minute);
    if (!shares.has(minute - 1)) minutesWithGaps.add(minute - 1);
    if (!shares.has(minute + 1)) minutesWithGaps.add(minute + 1);
  }
  const points = [...minutesWithGaps].sort((a, b) => a - b).map(minute => [x(minute), y(shares.get(minute) || 0)]);
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
  return `<text class="statistics-axis" x="${left}" y="14">平滑占比</text>
    ${Array.from({ length: tickCount + 1 }, (_, index) => {
      const share = index * vertical, row = y(share);
      return `<path class="statistics-gridline" d="M${left},${row}H${width - right}"/><text class="statistics-axis" x="${left - 8}" y="${row + 4}" text-anchor="end">${shareFormat.format(share)}</text>`;
    }).join('')}
    <path class="statistics-delay-zero" d="M${x(0)},${top}V${bottom}"/>
    ${horizontalTicks.map(minute => {
      const position = x(minute), label = minute < 0 ? '−' + tickFormat.format(-minute) : tickFormat.format(minute);
      return `<path class="statistics-gridline" d="M${position},${bottom}v5"/><text class="statistics-axis" x="${position}" y="${bottom + 20}" text-anchor="middle">${label}</text>`;
    }).join('')}
    <text class="statistics-axis" x="${left + plotWidth / 2}" y="${height - 7}" text-anchor="middle">延误分钟数</text>
    <path class="statistics-line" d="${path}"/>
    ${series.map((point, index) => {
      const share = shares.get(point.minutes), center = `cx="${x(point.minutes)}" cy="${y(share)}"`;
      return `<g data-stat-delay-point="${index}"><circle class="statistics-delay-hit" ${center} r="12" fill="transparent"/><circle class="statistics-dot" ${center} r="3.5"/><title>${pointLabel(point, share)}</title></g>`;
    }).join('')}`;
}

export function bindArrivalDelayChart(container, series) {
  const frame = container.querySelector('[data-stat-delay-plot]');
  if (!frame) return () => {};
  const shares = smoothedDelayShares(series);
  const svg = frame.querySelector('svg'), readout = frame.querySelector('output');
  const win = frame.ownerDocument.defaultView;
  let width = 0, active = -1;
  const dot = index => svg.querySelector(`[data-stat-delay-point="${index}"] .statistics-dot`);
  function show(index) {
    if (index === active || !series[index]) return;
    dot(active)?.classList.remove('is-active');
    active = index;
    dot(active)?.classList.add('is-active');
    const point = series[index];
    readout.textContent = pointLabel(point, shares.get(point.minutes));
  }
  function draw() {
    const next = Math.max(224, Math.round(frame.clientWidth || 640));
    if (width === next) return;
    width = next;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = delayPlot(series, shares, width);
    dot(active)?.classList.add('is-active');
  }
  const pointEvent = event => {
    const point = event.target.closest('[data-stat-delay-point]');
    if (point) show(Number(point.dataset.statDelayPoint));
  };
  const keydown = event => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const index = active === -1 && step < 0 ? series.length - 1 : active + step;
    show(Math.max(0, Math.min(series.length - 1, index)));
  };
  draw();
  const observer = win.ResizeObserver ? new win.ResizeObserver(draw) : null;
  if (observer) observer.observe(frame);
  else win.addEventListener('resize', draw);
  svg.addEventListener('pointerover', pointEvent);
  svg.addEventListener('click', pointEvent);
  frame.addEventListener('keydown', keydown);
  return () => {
    observer?.disconnect();
    win.removeEventListener('resize', draw);
    svg.removeEventListener('pointerover', pointEvent);
    svg.removeEventListener('click', pointEvent);
    frame.removeEventListener('keydown', keydown);
  };
}
