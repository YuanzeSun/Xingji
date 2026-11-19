import { openCameraStream, stopCameraStream } from './camera-stream.js';
export function codeCameraMarkup() {
  return `<div class="code-camera" data-code-camera hidden><video data-code-video autoplay muted playsinline aria-label="二维码或条码相机预览"></video><p data-code-camera-status role="status">将码对准相机，识别后自动录入</p><div class="code-actions"><button type="button" class="button small secondary" data-code-shutter>拍照识别</button><button type="button" class="text-button" data-code-stop>关闭相机</button></div></div>`;
}

export function bindCodeCamera(section, onCapture, {
  mediaDevices = navigator.mediaDevices, schedule = (fn, ms) => setTimeout(fn, ms), unschedule = clearTimeout, onCancel = () => {}, asCanvas = false
} = {}) {
  const panel = section.querySelector('[data-code-camera]'), video = panel.querySelector('video');
  const status = panel.querySelector('[data-code-camera-status]'), trigger = section.querySelector('[data-code-start]');
  const doc = section.ownerDocument, win = doc.defaultView;
  let stream, timer, generation = 0, disposed = false, reading = -1;
  function stop() {
    generation++; unschedule(timer); timer = null;
    stopCameraStream(stream);
    stream = null; if (video.srcObject) video.pause(); video.srcObject = null; panel.hidden = true; trigger.disabled = false;
  }
  async function capture(request = generation) {
    if (disposed || !stream || reading === request || request !== generation) return;
    reading = request; unschedule(timer); timer = null;
    try {
      if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
        const canvas = doc.createElement('canvas'), scale = Math.min(1, (asCanvas ? 2400 : 1600) / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = asCanvas ? canvas : await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (disposed || request !== generation) return;
        if (image && await onCapture(image)) { if (request === generation) stop(); return; }
      }
      if (request === generation) status.textContent = '将完整的码对准相机，保持清晰、稳定';
    } catch (error) { if (request === generation) status.textContent = error.message || '暂未读到码，请调整距离重试'; }
    finally {
      if (reading === request) reading = -1;
      if (!disposed && stream && request === generation) timer = schedule(() => capture(request), 900);
    }
  }
  async function start() {
    stop(); if (disposed) return;
    const request = generation;
    panel.hidden = false; trigger.disabled = true; status.textContent = '正在开启相机…';
    try {
      if (!mediaDevices?.getUserMedia) throw new Error('此浏览器无法开启相机，请上传图片');
      const incoming = await openCameraStream(mediaDevices);
      if (disposed || request !== generation) { stopCameraStream(incoming); return; }
      stream = incoming; video.srcObject = stream; video.muted = true; await video.play();
      if (request !== generation) return;
      status.textContent = '将码对准相机，识别后自动录入';
      timer = schedule(() => capture(request), 350);
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
  panel.querySelector('[data-code-shutter]').addEventListener('click', () => capture());
  panel.querySelector('[data-code-stop]').addEventListener('click', cancel);
  doc.addEventListener('visibilitychange', visibility);
  win.addEventListener('pagehide', pause);
  return {
    stop: cancel,
    dispose() {
      disposed = true;
      stop();
      doc.removeEventListener('visibilitychange', visibility);
      win.removeEventListener('pagehide', pause);
    }
  };
}
