const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const cameraSettings = track => track?.getSettings?.() || {};

export function bindCodeCameraControls(panel, video, mediaDevices) {
  const view = panel.querySelector('[data-code-view]');
  const zoomControls = panel.querySelector('[data-code-zoom]');
  const slider = panel.querySelector('[data-code-zoom-slider]');
  const zoomValue = panel.querySelector('[data-code-zoom-value]');
  const focusButton = panel.querySelector('[data-code-focus]'), focusMark = panel.querySelector('[data-code-focus-mark]');
  const win = panel.ownerDocument.defaultView, listeners = new win.AbortController();
  const listen = (element, event, callback) => element.addEventListener(event, callback, { signal: listeners.signal });
  const fingers = new Map();
  let active, pinch, pinched = false, focusTimer;

  function updateAspect() {
    if (video.videoWidth && video.videoHeight) view.style.setProperty('--camera-aspect', video.videoWidth / video.videoHeight);
  }

  function drawZoom() {
    if (!active) return;
    view.style.setProperty('--camera-crop', crop());
    slider.value = active.zoom;
    const value = Number(active.zoom.toFixed(2));
    zoomValue.textContent = `${value}×`;
    slider.setAttribute('aria-valuetext', `${value} 倍`);
  }

  function updateZoomRange({ min, max, step }) {
    slider.min = min;
    slider.max = max;
    slider.step = step;
  }

  function crop() {
    return active && !active.hardware ? active.zoom / active.nativeZoom : 1;
  }

  function configure(session, changes) {
    const request = session.queue.then(async () => {
      if (session !== active) return false;
      const applied = { ...session.applied, ...changes };
      const { zoom, ...focus } = applied;
      const { advanced = [], ...base } = session.base;
      await session.track.applyConstraints({ ...base, ...(zoom === undefined ? {} : { zoom: { exact: zoom } }),
        advanced: Object.keys(focus).length ? [...advanced, focus] : advanced });
      session.applied = applied;
      return session === active;
    });
    session.queue = request.catch(() => {});
    return request;
  }

  async function setZoom(value) {
    const session = active;
    if (!session) return;
    const steps = Math.round((value - session.min) / session.step);
    session.zoom = clamp(Number((session.min + steps * session.step).toFixed(4)), session.min, session.max);
    drawZoom();
    if (!session.hardware || session.zooming) return;
    session.zooming = true;
    try {
      while (session === active && Math.abs(session.nativeZoom - session.zoom) > .001) {
        const requested = session.zoom;
        if (!await configure(session, { zoom: requested })) return;
        session.nativeZoom = requested;
      }
    } catch {
      if (session !== active) return;
      session.hardware = false;
      session.nativeZoom = cameraSettings(session.track).zoom || session.nativeZoom;
      session.min = session.nativeZoom;
      session.max = session.nativeZoom * 3;
      session.step = .05;
      session.zoom = clamp(session.zoom, session.min, session.max);
      updateZoomRange(session);
      drawZoom();
    } finally { session.zooming = false; }
  }

  async function focus(x, y) {
    const session = active;
    if (!session?.pointFocus || focusButton.disabled) return;
    const scale = crop();
    const point = { x: .5 + (x - .5) / scale, y: .5 + (y - .5) / scale };
    try {
      if (!await configure(session, { focusMode: session.focusMode, pointsOfInterest: [point] })) return;
      focusMark.style.left = `${x * 100}%`;
      focusMark.style.top = `${y * 100}%`;
      focusMark.hidden = false;
      win.clearTimeout(focusTimer);
      focusTimer = win.setTimeout(() => { focusMark.hidden = true; }, 800);
    } catch {
      if (session === active) { session.pointFocus = false; focusButton.hidden = true; view.removeAttribute('data-focus-supported'); }
    }
  }

  function fingerSpan() {
    const [a, b] = fingers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  listen(view, 'pointerdown', event => {
    if (!active) return;
    if (!fingers.size) pinched = false;
    if (event.pointerType !== 'touch' || fingers.size >= 2) return;
    view.setPointerCapture?.(event.pointerId);
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (fingers.size === 2) {
      pinch = { distance: Math.max(1, fingerSpan()), zoom: active.zoom };
      pinched = true;
    }
  });
  listen(view, 'pointermove', event => {
    if (!fingers.has(event.pointerId)) return;
    fingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && fingers.size === 2) void setZoom(pinch.zoom * fingerSpan() / pinch.distance);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(view, event, ({ pointerId }) => {
    if (fingers.delete(pointerId)) pinch = null;
  });
  listen(view, 'click', event => {
    if (pinched || !active?.pointFocus) return;
    const bounds = view.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    void focus(clamp((event.clientX - bounds.left) / bounds.width, 0, 1), clamp((event.clientY - bounds.top) / bounds.height, 0, 1));
  });
  listen(video, 'loadedmetadata', updateAspect);
  listen(video, 'resize', updateAspect);
  listen(slider, 'input', event => {
    event.stopPropagation();
    void setZoom(Number(slider.value));
  });
  listen(focusButton, 'click', () => void focus(.5, .5));

  function stop() {
    active = null;
    fingers.clear();
    pinch = null;
    pinched = false;
    zoomControls.hidden = focusButton.hidden = focusMark.hidden = true;
    win.clearTimeout(focusTimer);
    view.style.removeProperty('--camera-crop');
    view.removeAttribute('data-focus-supported');
  }

  return {
    start(track) {
      const capabilities = track?.getCapabilities?.() || {};
      const settings = cameraSettings(track);
      const range = capabilities.zoom;
      const hardware = !!track?.applyConstraints && Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.min > 0 && range.max > range.min;
      const min = hardware ? range.min : 1, max = hardware ? range.max : 3;
      const zoom = hardware ? clamp(settings.zoom ?? 1, min, max) : 1;
      const modes = capabilities.focusMode || [];
      const continuous = modes.includes('continuous');
      const focusMode = continuous ? 'continuous' : modes.includes('single-shot') ? 'single-shot' : '';
      const pointFocus = !!track?.applyConstraints && !!focusMode && !!mediaDevices?.getSupportedConstraints?.()?.pointsOfInterest;
      const session = { track, min, max, zoom, nativeZoom: zoom, step: hardware && range.step > 0 ? range.step : .05,
        hardware, pointFocus, focusMode, base: track?.getConstraints?.() || {}, applied: {}, queue: Promise.resolve() };
      active = session;
      zoomControls.hidden = false;
      focusButton.hidden = !pointFocus;
      view.toggleAttribute('data-focus-supported', pointFocus);
      updateAspect();
      updateZoomRange(session);
      drawZoom();
      if (track?.applyConstraints && continuous && settings.focusMode !== 'continuous') void configure(session, { focusMode }).catch(() => {});
    },
    crop,
    stop,
    dispose() { stop(); listeners.abort(); }
  };
}
