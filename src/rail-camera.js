import { openCameraStream, stopCameraStream } from './camera-stream.js';

export function openRailCamera(container, onPhoto, { mediaDevices = navigator.mediaDevices } = {}) {
  container.innerHTML = `<div class="rail-camera"><div class="rail-camera-preview">
    <video playsinline autoplay muted aria-label="火车票拍照预览"></video><div class="rail-camera-guide" aria-hidden="true"></div></div>
    <p role="status" data-camera-status>正在打开相机…</p>
    <div class="button-row"><button class="button primary" type="button" data-shutter disabled>拍照并识别</button>
    <button class="button secondary" type="button" data-camera-back>返回填写</button></div></div>`;
  const video = container.querySelector('video');
  const shutter = container.querySelector('[data-shutter]');
  const status = container.querySelector('[data-camera-status]');
  const guide = container.querySelector('.rail-camera-guide');
  const doc = container.ownerDocument;
  let stream, closed = false;

  function close() {
    if (closed) return;
    closed = true;
    stopCameraStream(stream);
    video.srcObject = null;
    doc.removeEventListener('visibilitychange', onVisibility);
    container.replaceChildren();
  }
  function onVisibility() {
    if (doc.hidden) close();
  }
  doc.addEventListener('visibilitychange', onVisibility);
  container.querySelector('[data-camera-back]').onclick = close;
  video.onloadeddata = () => { if (!closed && video.videoWidth) shutter.disabled = false; };
  shutter.onclick = () => {
    if (closed || !video.videoWidth || !video.videoHeight) return;
    shutter.disabled = true;
    const canvas = doc.createElement('canvas');
    const frame = video.getBoundingClientRect(), box = guide.getBoundingClientRect();
    const scale = Math.max(frame.width / video.videoWidth, frame.height / video.videoHeight);
    const padding = 10;
    const left = Math.max(0, (box.left - frame.left + (video.videoWidth * scale - frame.width) / 2 - padding) / scale);
    const top = Math.max(0, (box.top - frame.top + (video.videoHeight * scale - frame.height) / 2 - padding) / scale);
    const width = Math.min(video.videoWidth - left, (box.width + padding * 2) / scale);
    const height = Math.min(video.videoHeight - top, (box.height + padding * 2) / scale);
    const context = canvas.getContext('2d');
    if (Number.isFinite(width) && width > 20 && Number.isFinite(height) && height > 20) {
      canvas.width = Math.round(width); canvas.height = Math.round(height);
      context.drawImage(video, left, top, width, height, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0);
    }
    canvas.toBlob(photo => {
      if (closed) return;
      if (!photo) {
        shutter.disabled = false;
        status.textContent = '未能拍照，请重试';
        return;
      }
      close();
      onPhoto(photo);
    }, 'image/jpeg', .94);
  };
  Promise.resolve().then(() => openCameraStream(mediaDevices)).then(async incoming => {
    if (closed) return stopCameraStream(incoming);
    stream = incoming;
    video.srcObject = stream;
    await video.play();
    if (closed) return;
    if (video.videoWidth) shutter.disabled = false;
    status.textContent = '让车票四角落在取景框内，再点击拍照';
  }).catch(error => {
    if (closed) return;
    stopCameraStream(stream);
    video.srcObject = null;
    status.textContent = error.name === 'NotAllowedError' ? '请允许使用相机，或选择火车票照片' : '无法打开相机，可以选择火车票照片';
  });
  return close;
}
