import { escape as e } from './html.js';

export const ROUTE_PLAYBACK_MS = 4000;

export function detailMapControls(label, { regional = false } = {}) {
  return `<div class="map-controls"><button type="button" data-route-zoom="in" aria-label="放大${e(label)}">＋</button><button type="button" data-route-zoom="out" aria-label="缩小${e(label)}">−</button><button type="button" data-route-zoom="fit" aria-label="显示完整${e(label)}">↔</button>${regional ? '<button type="button" data-route-zoom="region" aria-label="区域总览，查看周边省界" title="区域总览，查看周边省界">区域</button>' : ''}</div>`;
}

export function bindDetailMapControls(frame, { fitViewport, draw }) {
  const view = frame.ownerDocument.defaultView, svg = frame.querySelector('svg');
  const listeners = new view.AbortController(), { signal } = listeners;
  const pointers = new Map();
  let width, height, viewport, fitted, fitMode = 'fit', adjusted = false, animation = 0, gesture;

  function measure() {
    const rect = frame.getBoundingClientRect(), nextWidth = rect.width || 640, nextHeight = rect.height || 340;
    if (nextWidth === width && nextHeight === height) return false;
    width = nextWidth;
    height = nextHeight;
    return true;
  }
  function paint() {
    animation = 0;
    draw(viewport, width, height, pointers.size > 0);
  }
  function schedule() {
    if (!animation) animation = view.requestAnimationFrame(paint);
  }
  function fit(mode = 'fit') {
    fitMode = mode;
    adjusted = false;
    fitted = fitViewport(width, height, mode === 'region');
    viewport = { ...fitted };
  }
  const unit = () => 1000 / viewport.zoom / width;
  const location = event => {
    const rect = frame.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  function zoom(factor, [x, y] = [width / 2, height / 2]) {
    const before = unit();
    viewport.zoom = Math.max(fitted.zoom * .5, Math.min(fitted.zoom * 32, viewport.zoom * factor));
    const delta = before - unit();
    viewport.x += (x - width / 2) * delta;
    viewport.y += (y - height / 2) * delta;
    adjusted = true;
    schedule();
  }
  function pointerGesture() {
    const points = [...pointers.values()];
    if (!points.length) return null;
    const center = [0, 1].map(index => points.reduce((sum, point) => sum + point[index], 0) / points.length);
    const span = points.length === 2 ? Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) : 0;
    return { center, span };
  }
  frame.addEventListener('pointerdown', event => {
    if (event.target.closest('button') || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    svg.focus({ preventScroll: true });
    frame.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, location(event));
    gesture = pointerGesture();
  }, { signal });
  frame.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.set(event.pointerId, location(event));
    const next = pointerGesture(), scale = unit();
    viewport.x -= (next.center[0] - gesture.center[0]) * scale;
    viewport.y -= (next.center[1] - gesture.center[1]) * scale;
    if (next.span && gesture.span) zoom((next.span / gesture.span) ** 1.25, next.center);
    adjusted = true;
    gesture = next;
    schedule();
  }, { signal });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) frame.addEventListener(type, event => {
    if (!pointers.delete(event.pointerId)) return;
    gesture = pointerGesture();
    schedule();
  }, { signal });
  frame.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .008), location(event));
  }, { passive: false, signal });
  frame.addEventListener('click', event => {
    const mode = event.target.closest('[data-route-zoom]')?.dataset.routeZoom;
    if (mode === 'in' || mode === 'out') zoom(mode === 'in' ? 1.5 : 1 / 1.5);
    else if (mode) { fit(mode); schedule(); }
  }, { signal });
  svg.addEventListener('keydown', event => {
    const { key } = event;
    if (!['0', '+', '=', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    if (key === '0') { fit(); schedule(); }
    else if (key === '+' || key === '=' || key === '-') zoom(key === '-' ? 1 / 1.5 : 1.5);
    else {
      const step = 60 * unit();
      viewport.x += key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0;
      viewport.y += key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0;
      adjusted = true;
      schedule();
    }
  }, { signal });

  const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(() => {
    if (!measure()) return;
    if (!adjusted) fit(fitMode);
    schedule();
  }) : null;
  measure();
  fit();
  paint();
  observer?.observe(frame);
  return () => { observer?.disconnect(); if (animation) view.cancelAnimationFrame(animation); listeners.abort(); };
}
