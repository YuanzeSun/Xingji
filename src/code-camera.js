import { openCameraStream, stopCameraStream } from './camera-stream.js';
import { bindCodeCameraControls } from './code-camera-controls.js';
export function codeCameraMarkup() {
  return `<div class="code-camera" data-code-camera hidden>
    <div class="code-camera-view" data-code-view><video data-code-video autoplay muted playsinline aria-label="二维码或条码相机预览"></video><span class="code-camera-focus-mark" data-code-focus-mark aria-hidden="true" hidden></span></div>
    <div class="code-camera-controls">
      <label class="code-camera-zoom" data-code-zoom hidden><input type="range" min="1" max="3" step="0.05" value="1" data-code-zoom-slider aria-label="缩放倍率" list="code-camera-zoom-stops"><output data-code-zoom-value aria-live="off">1×</output><datalist id="code-camera-zoom-stops"><option value="0.5"></option><option value="1"></option><option value="2"></option><option value="3"></option></datalist></label>
      <button type="button" class="button secondary" data-code-focus aria-label="在画面中央对焦" hidden>对焦</button>
    </div>
    <p data-code-camera-status role="status">将码对准相机，识别后自动录入</p>
    <div class="code-actions"><button type="button" class="button small secondary" data-code-shutter disabled>拍照识别</button><button type="button" class="text-button" data-code-stop>关闭相机</button></div>
  </div>`;
}

export function bindCodeCamera(section, onCapture, {
  mediaDevices = navigator.mediaDevices, schedule = (fn, ms) => setTimeout(fn, ms), unschedule = clearTimeout, onStart = () => {}, onCancel = () => {}, asCanvas = false
} = {}) {
  const panel = section.querySelector('[data-code-camera]'), video = panel.querySelector('video');
  const status = panel.querySelector('[data-code-camera-status]'), trigger = section.querySelector('[data-code-start]');
  const doc = section.ownerDocument, win = doc.defaultView;
  const shutter = panel.querySelector('[data-code-shutter]'), focusButton = panel.querySelector('[data-code-focus]');
  const focusHint = '将码对准相机，点按画面可对焦';
  const controls = bindCodeCameraControls(panel, video, mediaDevices);
  let stream, timer, generation = 0, disposed = false, reading = -1, frame = 0;
  function stop() {
    generation++; frame = 0; unschedule(timer); timer = null;
    controls.stop();
    stopCameraStream(stream);
    stream = null; if (video.srcObject) video.pause(); video.srcObject = null; panel.hidden = true; trigger.disabled = false;
    shutter.disabled = true;
  }
  async function capture(request = generation, manual = false) {
    if (disposed || !stream || reading === request || request !== generation) return;
    reading = request; unschedule(timer); timer = null;
    try {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const crop = controls.crop(), width = video.videoWidth / crop, height = video.videoHeight / crop;
        const canvas = doc.createElement('canvas'), scale = Math.min(1, (asCanvas ? 2400 : 1600) / Math.max(width, height));
        canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
        canvas.getContext('2d').drawImage(video, (video.videoWidth - width) / 2, (video.videoHeight - height) / 2,
          width, height, 0, 0, canvas.width, canvas.height);
        const image = asCanvas ? canvas : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (disposed || request !== generation) return;
        if (image && await onCapture(image, { cameraFrame: manual ? 0 : ++frame })) { if (request === generation) stop(); return; }
      }
      if (request === generation) status.textContent = focusButton.hidden ? '将完整的码对准相机，保持清晰、稳定' : focusHint;
    } catch (error) { if (request === generation) status.textContent = error.message || '暂未读到码，请调整距离重试'; }
    finally {
      if (reading === request) reading = -1;
      if (!disposed && stream && request === generation) timer = schedule(() => capture(request), asCanvas ? 200 : 900);
    }
  }
  async function open(request) {
    if (mediaDevices.getSupportedConstraints?.()?.zoom === true) {
      try { return await openCameraStream(mediaDevices, { zoom: true }); }
      catch (error) {
        if (request !== generation) return null;
        if (!['NotAllowedError', 'OverconstrainedError', 'NotFoundError', 'NotSupportedError', 'TypeError'].includes(error.name)) throw error;
      }
    }
    return openCameraStream(mediaDevices);
  }
  async function start() {
    stop(); if (disposed) return;
    onStart();
    const request = generation;
    panel.hidden = false; trigger.disabled = true; status.textContent = '正在开启相机…';
    try {
      if (!mediaDevices?.getUserMedia) throw new Error('此浏览器无法开启相机，请上传图片');
      const incoming = await open(request);
      if (disposed || request !== generation) { stopCameraStream(incoming); return; }
      stream = incoming; video.srcObject = stream; video.muted = true; await video.play();
      if (request !== generation) return;
      controls.start(stream.getVideoTracks?.()[0]);
      shutter.disabled = false;
      status.textContent = focusButton.hidden ? '将码对准相机，识别后自动录入' : focusHint;
      timer = schedule(() => capture(request), asCanvas ? 80 : 350);
    } catch (error) {
      if (disposed || request !== generation) return;
      stop(); panel.hidden = false;
      status.textContent = error.name === 'NotAllowedError' ? '未获相机权限，请允许访问后重试，或上传图片' : error.name === 'NotFoundError' ? '未找到相机，请上传图片' : error.message || '相机无法开启，请上传图片';
    }
  }
  const cancel = () => { stop(); onCancel(); };
  const pause = () => { if (!panel.hidden) cancel(); };
  const visibility = () => { if (doc.visibilityState === 'hidden') pause(); };
  trigger.addEventListener('click', start);
  shutter.addEventListener('click', () => capture(generation, true));
  panel.querySelector('[data-code-stop]').addEventListener('click', cancel);
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('pagehide', pause);
  return {
    stop: cancel,
    dispose() {
      disposed = true;
      stop();
      controls.dispose();
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('pagehide', pause);
    }
  };
}
