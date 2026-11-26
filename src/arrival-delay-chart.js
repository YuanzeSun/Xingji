const height = 230, left = 42, right = 24, top = 27, bottom = 180;
const tickFormat = new Intl.NumberFormat('zh-CN', { notation: 'compact' });
const minuteLabel = minutes => minutes < 0 ? '−' + Math.abs(minutes) : String(minutes);
const pointLabel = ({ minutes, count }) => `${minuteLabel(minutes)} 分钟 · ${count} 班`;

function horizontalStep(span, width) {
  const approximate = Math.max(1, span / Math.max(2, Math.floor(width / 62)));
  const magnitude = 10 ** Math.floor(Math.log10(approximate));
  return [1, 2, 5, 10].map(step => step * magnitude).find(step => step >= approximate);
}

function delayPlot(series, width) {
  const plotWidth = width - left - right;
  const low = Math.min(0, series[0].minutes - 1), high = Math.max(0, series.at(-1).minutes + 1);
  const horizontal = horizontalStep(high - low, plotWidth);
  const first = Math.floor(low / horizontal) * horizontal, last = Math.ceil(high / horizontal) * horizontal;
  const peak = series.reduce((max, row) => Math.max(max, row.count), 1);
  const vertical = Math.max(1, Math.ceil(peak / 4)), ceiling = Math.ceil(peak / vertical) * vertical;
  const x = minute => left + (minute - first) / (last - first) * plotWidth;
  const y = count => bottom - count / ceiling * (bottom - top);
  const counts = new Map(series.map(({ minutes, count }) => [minutes, count]));
  const minutesWithGaps = new Set([first, last]);
  // Only the edges of an empty interval are needed to draw its zero baseline.
  for (const minute of counts.keys()) {
    minutesWithGaps.add(minute - 1);
    minutesWithGaps.add(minute);
    minutesWithGaps.add(minute + 1);
  }
  const points = [...minutesWithGaps].sort((a, b) => a - b).map(minute => [x(minute), y(counts.get(minute) || 0)]);
  const path = points.map(([endX, endY], index) => {
    if (!index) return `M${endX},${endY}`;
    const [startX, startY] = points[index - 1];
    const middle = (startX + endX) / 2;
    // Horizontal tangents give a smooth curve without overshooting adjacent counts.
    return `C${middle},${startY} ${middle},${endY} ${endX},${endY}`;
  }).join('');
  const horizontalTicks = Array.from({ length: (last - first) / horizontal + 1 }, (_, index) => first + index * horizontal);
  return `<text class="statistics-axis" x="${left}" y="14">次数</text>
    ${Array.from({ length: ceiling / vertical + 1 }, (_, index) => {
      const count = index * vertical, row = y(count);
      return `<path class="statistics-gridline" d="M${left},${row}H${width - right}"/><text class="statistics-axis" x="${left - 8}" y="${row + 4}" text-anchor="end">${tickFormat.format(count)}</text>`;
    }).join('')}
    <path class="statistics-delay-zero" d="M${x(0)},${top}V${bottom}"/>
    ${horizontalTicks.map(minute => {
      const position = x(minute), label = minute < 0 ? '−' + tickFormat.format(-minute) : tickFormat.format(minute);
      return `<path class="statistics-gridline" d="M${position},${bottom}v5"/><text class="statistics-axis" x="${position}" y="${bottom + 20}" text-anchor="middle">${label}</text>`;
    }).join('')}
    <text class="statistics-axis" x="${left + plotWidth / 2}" y="${height - 7}" text-anchor="middle">延误分钟数</text>
    <path class="statistics-line" d="${path}"/>
    ${series.map((point, index) => {
      const center = `cx="${x(point.minutes)}" cy="${y(point.count)}"`;
      return `<g data-stat-delay-point="${index}"><circle class="statistics-delay-hit" ${center} r="12" fill="transparent"/><circle class="statistics-dot" ${center} r="3.5"/><title>${pointLabel(point)}</title></g>`;
    }).join('')}`;
}

export function bindArrivalDelayChart(container, series) {
  const frame = container.querySelector('[data-stat-delay-plot]');
  if (!frame) return () => {};
  const svg = frame.querySelector('svg'), readout = frame.querySelector('output');
  const win = frame.ownerDocument.defaultView;
  let width = 0, active = -1;
  const dot = index => svg.querySelector(`[data-stat-delay-point="${index}"] .statistics-dot`);
  function show(index) {
    if (index === active || !series[index]) return;
    dot(active)?.classList.remove('is-active');
    active = index;
    dot(active)?.classList.add('is-active');
    readout.textContent = pointLabel(series[index]);
  }
  function draw() {
    const next = Math.max(224, Math.round(frame.clientWidth || 640));
    if (width === next) return;
    width = next;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.innerHTML = delayPlot(series, width);
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
