import { openCameraStream, stopCameraStream } from './camera-stream.js';

function guidePixels(video, guide) {
  const frame = video.getBoundingClientRect();
  if (!frame.width || !frame.height) return null;
  const box = guide.getBoundingClientRect();
  const border = guide.ownerDocument.defaultView.getComputedStyle(guide);
  // The preview centers an object-fit: cover video, which can extend past its element.
  const scale = Math.max(frame.width / video.videoWidth, frame.height / video.videoHeight);
  const originX = frame.left + (frame.width - video.videoWidth * scale) / 2;
  const originY = frame.top + (frame.height - video.videoHeight * scale) / 2;
  const left = Math.ceil((Math.max(frame.left, box.left + parseFloat(border.borderLeftWidth)) - originX) / scale);
  const top = Math.ceil((Math.max(frame.top, box.top + parseFloat(border.borderTopWidth)) - originY) / scale);
  const right = Math.floor((Math.min(frame.right, box.right - parseFloat(border.borderRightWidth)) - originX) / scale);
  const bottom = Math.floor((Math.min(frame.bottom, box.bottom - parseFloat(border.borderBottomWidth)) - originY) / scale);
  if (!(right > left && bottom > top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

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
  function retryPhoto() {
    shutter.disabled = false;
    status.textContent = '未能拍照，请重试';
  }
  shutter.onclick = () => {
    if (closed || !video.videoWidth || !video.videoHeight) return;
    shutter.disabled = true;
    const crop = guidePixels(video, guide);
    const canvas = doc.createElement('canvas');
    const context = crop && canvas.getContext('2d');
    if (!context) return retryPhoto();
    const { left, top, width, height } = crop;
    canvas.width = width;
    canvas.height = height;
    try {
      context.drawImage(video, left, top, width, height, 0, 0, width, height);
      canvas.toBlob(photo => {
        if (closed) return;
        if (!photo) return retryPhoto();
        close();
        onPhoto(photo);
      }, 'image/jpeg', .94);
    } catch {
      retryPhoto();
    }
  };
  Promise.resolve().then(() => openCameraStream(mediaDevices)).then(async incoming => {
    if (closed) return stopCameraStream(incoming);
    stream = incoming;
    video.srcObject = stream;
    await video.play();
    if (closed) return;
    if (video.videoWidth) shutter.disabled = false;
    status.textContent = '';
  }).catch(error => {
    if (closed) return;
    stopCameraStream(stream);
    video.srcObject = null;
    status.textContent = error.name === 'NotAllowedError' ? '请允许使用相机，或选择火车票照片' : '无法打开相机，可以选择火车票照片';
  });
  return close;
}
