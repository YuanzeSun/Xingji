import { openCameraStream, stopCameraStream } from './camera-stream.js';
import { videoCrop, frameMetrics, frameMotion, frameQuality, scanCandidate, createScanConsensus } from './scan-engine.js';

export { prepareScanImage } from './scan-image.js';

export function scannerMarkup(type = 'rail') {
  return `<section class="live-scanner" id="live-scanner"><header class="scanner-header"><div><h2>扫描票据</h2><p>票面或完整登机牌条码放入框内</p></div><button class="scanner-close" type="button" data-action="close-modal" aria-label="关闭相机"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header><div class="scanner-types" role="group" aria-label="扫描票据类型">${[['auto', '自动'], ['rail', '火车票'], ['flight', '机票']].map(([value, title]) => `<button type="button" data-scan-type="${value}" aria-pressed="${type === value}" class="${type === value ? 'selected' : ''}">${title}</button>`).join('')}</div><div class="scanner-stage"><video id="scanner-video" autoplay muted playsinline aria-label="实时相机预览"></video><div id="scanner-guide" class="scanner-guide" style="--ticket-ratio:${type === 'flight' ? 2.46 : 1.58}"><span></span><span></span><span></span><span></span></div></div><div class="scanner-feedback"><div class="scanner-status-line"><span class="scanner-state-dot" aria-hidden="true"></span><p id="scanner-status" role="status" aria-live="polite">正在打开相机…</p></div><div class="scanner-actions"><button type="button" id="scanner-retry" class="button secondary" hidden>重新开启相机</button><button type="button" class="text-button" data-action="close-modal">返回填写</button></div></div></section>`;
}
function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') return '请允许相机访问，然后重新开启扫描';
  if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') return '未找到可用相机，可以选择图片或填写信息';
  if (error?.name === 'NotReadableError') return '相机正在被其他应用使用，关闭后重试';
  return error?.message || '相机未能开启，请重试';
}
export function mountScanner(root, {
  type = 'rail', onResult, mediaDevices = navigator.mediaDevices,
  loadRecognizer = async progress => (await import('./ocr.js')).createRecognizer(progress),
  schedule = (fn, delay) => setTimeout(fn, delay), unschedule = id => clearTimeout(id), readFrame,
  now = () => Date.now(), prepareImage = image => image
} = {}) {
  const video = root.querySelector('#scanner-video'), guide = root.querySelector('#scanner-guide');
  const status = root.querySelector('#scanner-status'), retry = root.querySelector('#scanner-retry');
  const doc = root.ownerDocument, win = doc.defaultView, consensus = createScanConsensus();
  const analysis = doc.createElement('canvas'); analysis.width = 320;
  let disposed = false, active = false, generation = 0, motionEpoch = 0, typeEpoch = 0, timer, stream, worker;
  let fingerprint = null, steady = 0, busy = false, lastRead = 0, recognitionErrors = 0;
  function message(text) { if (!disposed && status.textContent !== text) status.textContent = text; }
  function release() {
    generation++; active = false; unschedule(timer); timer = undefined;
    stopCameraStream(stream); stream = null;
    video.pause(); video.srcObject = null;
    const old = worker; worker = null; if (old) Promise.resolve(old.terminate()).catch(() => {});
    fingerprint = null; steady = 0; busy = false; consensus.reset();
    guide.classList.remove('reading');
  }
  function pause() { if (!active) return; release(); message('扫描已暂停'); retry.textContent = '继续扫描'; retry.hidden = false; }
  function frame() {
    if (readFrame) return readFrame(video, guide);
    if (video.readyState < 2) return null;
    const crop = videoCrop(video.videoWidth, video.videoHeight, video.getBoundingClientRect(), guide.getBoundingClientRect());
    if (!crop || crop.width < 1 || crop.height < 1) return null;
    analysis.height = Math.max(1, Math.round(320 * crop.height / crop.width));
    const ctx = analysis.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, analysis.width, analysis.height);
    const metrics = frameMetrics(ctx.getImageData(0, 0, analysis.width, analysis.height));
    return { metrics, snapshot() {
      const canvas = doc.createElement('canvas'); canvas.width = Math.round(Math.min(type === 'rail' ? 1800 : 2400, crop.width)); canvas.height = Math.max(1, Math.round(canvas.width * crop.height / crop.width));
      canvas.getContext('2d').drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
      return canvas;
    } };
  }
  async function recognize(canvas, request) {
    busy = true; lastRead = now(); guide.classList.add('reading'); message('正在读取票面…');
    const requestedType = type, requestedTypeEpoch = typeEpoch, frameEpoch = motionEpoch;
    const current = () => !disposed && active && request === generation && requestedTypeEpoch === typeEpoch;
    try {
      const result = await worker.recognize(prepareImage(canvas, requestedType), { type: requestedType, refineRailDate: requestedType !== 'flight' });
      if (!current()) return;
      recognitionErrors = 0;
      const candidate = scanCandidate(result.text, result.confidence, requestedType, result);
      const verifiedCode = candidate?.boardingCodeSource === 'original';
      if (!verifiedCode && frameEpoch !== motionEpoch) return;
      const confirmed = verifiedCode ? candidate : consensus.observe(candidate, result.confidence);
      if (!confirmed) { message(candidate ? `已读到 ${candidate.service}，保持片刻…` : '让整张票面进入框内，保持字迹清晰'); return; }
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('扫描图像未能生成，请重试')), 'image/png'));
      if (!current() || (!verifiedCode && frameEpoch !== motionEpoch)) return;
      release(); onResult?.(confirmed, blob);
    } catch (error) {
      if (!current()) return;
      consensus.reset(); recognitionErrors++;
      if (recognitionErrors >= 3) { release(); message('识别暂时未能完成，请重新扫描'); retry.hidden = false; }
      else message('正在重新读取票面…');
    } finally {
      if (request === generation) { busy = false; guide.classList.remove('reading'); }
    }
  }
  function tick(request) {
    if (disposed || !active || request !== generation) return;
    try {
      const sample = frame();
      if (sample) {
        const quality = frameQuality(sample.metrics), motion = frameMotion(fingerprint, sample.metrics.fingerprint); fingerprint = sample.metrics.fingerprint;
        const mayContainCode = type !== 'rail' && sample.metrics.contrast >= 10 && sample.metrics.sharpness >= 3;
        if ((quality && !mayContainCode) || motion > 4.5) { steady = 0; motionEpoch++; consensus.reset(); message(quality || '保持稳定，正在对焦…'); }
        else {
          steady++;
          if (steady >= 3 && !busy && now() - lastRead >= 1200) void recognize(sample.snapshot(), request);
        }
      }
    } catch { release(); message('相机画面暂时不可用，请重试'); retry.hidden = false; return; }
    if (active && request === generation) timer = schedule(() => tick(request), 280);
  }
  async function start() {
    if (disposed) return; release(); active = true; const request = generation;
    lastRead = 0; recognitionErrors = 0; retry.hidden = true; retry.textContent = '重新开启相机'; message('正在打开相机…');
    try {
      if (!mediaDevices?.getUserMedia) throw new Error('当前浏览器无法开启相机，可选择图片或填写信息');
      const incoming = await openCameraStream(mediaDevices);
      if (disposed || !active || request !== generation) { stopCameraStream(incoming); return; }
      stream = incoming; video.srcObject = stream; video.muted = true;
      stream.getVideoTracks().forEach(track => track.addEventListener?.('ended', pause, { once: true }));
      await video.play();
      if (disposed || !active || request !== generation) return;
      message('准备文字识别…');
      const engine = await loadRecognizer(text => { if (!disposed && active && request === generation && !busy) message(text); });
      if (disposed || !active || request !== generation) { await engine.terminate(); return; }
      worker = engine; message('将票面对准框内，保持片刻'); tick(request);
    } catch (error) {
      if (disposed || request !== generation) return;
      release(); message(cameraError(error)); retry.hidden = false;
    }
  }
  const visibility = () => { if (doc.visibilityState === 'hidden') pause(); };
  const changeType = event => {
    const button = event.target.closest('[data-scan-type]'); if (!button) return;
    if (type === button.dataset.scanType) return;
    type = button.dataset.scanType; typeEpoch++; steady = 0; fingerprint = null; consensus.reset();
    guide.style.setProperty('--ticket-ratio', type === 'flight' ? 2.46 : 1.58);
    for (const b of root.querySelectorAll('[data-scan-type]')) { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }
  };
  retry.addEventListener('click', start); root.addEventListener('click', changeType);
  doc.addEventListener('visibilitychange', visibility); win.addEventListener('pagehide', pause);
  void start();
  return () => { disposed = true; release(); retry.removeEventListener('click', start); root.removeEventListener('click', changeType); doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('pagehide', pause); };
}
