import { openCameraStream, stopCameraStream } from './camera-stream.js';
import { videoCrop, frameMetrics, frameMotion, frameQuality, scanCandidate, createScanConsensus } from './scan-engine.js';

export { prepareScanImage } from './scan-image.js';

const AUTOMATIC_READ_INTERVAL = 1200;
const STABILITY_WAIT = 1400;

export function scannerMarkup(type = 'rail') {
  return `<section class="live-scanner" id="live-scanner"><header class="scanner-header"><div><h2>扫描票据</h2><p>票面或完整登机牌条码放入框内</p></div><button class="scanner-close" type="button" data-action="close-modal" aria-label="关闭相机"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header><div class="scanner-types" role="group" aria-label="扫描票据类型">${[['auto', '自动'], ['rail', '火车票'], ['flight', '机票']].map(([value, title]) => `<button type="button" data-scan-type="${value}" aria-pressed="${type === value}" class="${type === value ? 'selected' : ''}">${title}</button>`).join('')}</div><div class="scanner-stage"><video id="scanner-video" autoplay muted playsinline aria-label="实时相机预览"></video><div id="scanner-guide" class="scanner-guide" style="--ticket-ratio:${type === 'flight' ? 2.46 : 1.58}"><span></span><span></span><span></span><span></span></div></div><div class="scanner-feedback"><div class="scanner-status-line"><span class="scanner-state-dot" aria-hidden="true"></span><p id="scanner-status" role="status" aria-live="polite">正在打开相机…</p></div><div class="scanner-actions"><button type="button" id="scanner-retry" class="button secondary" hidden>重新开启相机</button><button type="button" id="scanner-shutter" class="button secondary" disabled>拍照识别</button><button type="button" class="text-button" data-action="close-modal">返回填写</button></div></div></section>`;
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
  readBoardingFrame = async (image, cameraFrame) => (await import('./code-reader.js')).readBoardingCodesFromImage(image, { cameraFrame }),
  schedule = (fn, delay) => setTimeout(fn, delay), unschedule = id => clearTimeout(id), readFrame,
  now = () => Date.now(), prepareImage = image => image
} = {}) {
  const video = root.querySelector('#scanner-video'), guide = root.querySelector('#scanner-guide');
  const status = root.querySelector('#scanner-status'), retry = root.querySelector('#scanner-retry'), shutter = root.querySelector('#scanner-shutter');
  const doc = root.ownerDocument, win = doc.defaultView, consensus = createScanConsensus();
  const analysis = doc.createElement('canvas'); analysis.width = 320;
  let disposed = false, active = false, generation = 0, typeEpoch = 0, timer, stream, worker;
  let fingerprint = null, steady = 0, busy = false, firstFrameAt, lastRead = -Infinity, recognitionErrors = 0;
  let readingCode = false, capturedFrame = null, boardingAttempts = 0, workerUnavailable = false;
  function message(text) { if (!disposed && status.textContent !== text) status.textContent = text; }
  function release() {
    generation++; active = false; unschedule(timer); timer = undefined;
    stopCameraStream(stream); stream = null;
    video.pause(); video.srcObject = null;
    const old = worker; worker = null; if (old) Promise.resolve(old.terminate()).catch(() => {});
    resetFrames(); busy = false; readingCode = false; workerUnavailable = false;
    shutter.disabled = true;
  }
  function resetFrames() {
    fingerprint = null; steady = 0; firstFrameAt = undefined; lastRead = -Infinity;
    capturedFrame = null; boardingAttempts = 0; recognitionErrors = 0; consensus.reset();
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
    return { metrics, snapshot(padding = 0) {
      const x = Math.max(0, crop.x - crop.width * padding), y = Math.max(0, crop.y - crop.height * padding);
      const width = Math.min(video.videoWidth, crop.x + crop.width * (1 + padding)) - x;
      const height = Math.min(video.videoHeight, crop.y + crop.height * (1 + padding)) - y;
      const canvas = doc.createElement('canvas'); canvas.width = Math.round(Math.min(type === 'rail' ? 1800 : 2400, width)); canvas.height = Math.max(1, Math.round(canvas.width * height / width));
      canvas.getContext('2d').drawImage(video, x, y, width, height, 0, 0, canvas.width, canvas.height);
      return canvas;
    } };
  }
  async function scanBoardingFrame(canvas, request) {
    const requestedType = type, requestedTypeEpoch = typeEpoch;
    readingCode = true;
    try {
      const codes = await readBoardingFrame(canvas, ++boardingAttempts);
      if (!codes.length || disposed || request !== generation || requestedTypeEpoch !== typeEpoch || capturedFrame) return;
      const candidate = scanCandidate('', 90, requestedType, { boardingCodes: codes });
      if (candidate?.boardingCodeSource !== 'original') return;
      capturedFrame = { canvas, codes, candidate };
      shutter.disabled = true;
      guide.classList.add('reading');
      message('已读到登机牌条码，正在补全票面…');
    } catch { /* The combined OCR pass can still attempt to read the frame. */ }
    finally { if (request === generation) readingCode = false; }
  }
  async function recognize(capture, request) {
    const { canvas, candidate: boarding, codes, manual } = capture;
    busy = true; lastRead = now(); guide.classList.add('reading');
    if (!boarding) message('正在读取票面…');
    const requestedType = type, requestedTypeEpoch = typeEpoch;
    const current = () => !disposed && active && request === generation && requestedTypeEpoch === typeEpoch &&
      (!capturedFrame || capturedFrame === capture);
    try {
      let result;
      try {
        if (worker) result = await worker.recognize(prepareImage(canvas, requestedType), { type: requestedType,
          refineRailDate: requestedType !== 'flight' && !boarding, decodedBoardingCodes: codes });
      } catch (error) { if (!boarding) throw error; }
      if (!current()) return;
      const candidate = boarding
        ? (result && scanCandidate(result.text, Math.max(result.confidence || 0, 90), requestedType, { ...result, boardingCodes: codes })) || boarding
        : scanCandidate(result.text, result.confidence, requestedType, result);
      // The snapshot cannot change while OCR runs. Agreement between reads
      // remains the gate for opening automatic text-only results.
      const confirmed = manual || candidate?.boardingCodeSource === 'original' ? candidate : consensus.observe(candidate, result.confidence);
      if (!confirmed) {
        recognitionErrors = 0;
        if (manual) capturedFrame = null;
        message(candidate ? `已读到 ${candidate.service}，正在核对…`
          : manual ? '未读到完整票面，请调整位置后重拍' : '请让整张票面进入框内，或点击拍照识别');
        return;
      }
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('扫描图像未能生成，请重试')), 'image/png'));
      if (!current()) return;
      release(); onResult?.(confirmed, blob);
    } catch (error) {
      if (!current()) return;
      capturedFrame = null; consensus.reset(); recognitionErrors++;
      if (recognitionErrors >= 3) { release(); message('识别暂时未能完成，请重新扫描'); retry.hidden = false; }
      else message('正在重新读取票面…');
    } finally {
      if (request === generation) {
        busy = false;
        if (!capturedFrame) guide.classList.remove('reading');
      }
    }
  }
  function tick(request) {
    if (disposed || !active || request !== generation) return;
    try {
      const sample = capturedFrame ? null : frame();
      if (capturedFrame) {
        if (!busy && (worker || workerUnavailable && capturedFrame.candidate)) void recognize(capturedFrame, request);
      } else if (sample) {
        const timestamp = now();
        firstFrameAt ??= timestamp;
        shutter.disabled = workerUnavailable;
        if (type !== 'rail' && !readingCode && sample.metrics.contrast > 2) void scanBoardingFrame(sample.snapshot(.16), request);
        const quality = frameQuality(sample.metrics), motion = frameMotion(fingerprint, sample.metrics.fingerprint);
        fingerprint = sample.metrics.fingerprint;
        steady = !quality && motion <= 4.5 ? steady + 1 : 0;
        if (worker && !busy && timestamp - lastRead >= AUTOMATIC_READ_INTERVAL) {
          if (sample.metrics.contrast > 2 && (steady >= 3 || timestamp - firstFrameAt >= STABILITY_WAIT)) {
            void recognize({ canvas: sample.snapshot(.06) }, request);
          } else if (lastRead === -Infinity) {
            message(quality || '将票面放在框内，尽量保持平稳');
          }
        }
      }
    } catch { release(); message('相机画面暂时不可用，请重试'); retry.hidden = false; return; }
    if (active && request === generation) timer = schedule(() => tick(request), 280);
  }
  function takePhoto() {
    if (shutter.disabled || !active || capturedFrame) return;
    try {
      const sample = frame();
      if (!sample) { message('请等相机画面出现后再拍照'); return; }
      capturedFrame = { canvas: sample.snapshot(.16), manual: true };
      shutter.disabled = true; consensus.reset();
      guide.classList.add('reading');
      if (!busy && worker) void recognize(capturedFrame, generation);
      else message('已拍照，等待文字识别…');
    } catch { message('未能拍下当前画面，请重试'); }
  }
  async function start() {
    if (disposed) return; release(); active = true; const request = generation;
    retry.hidden = true; retry.textContent = '重新开启相机'; message('正在打开相机…');
    try {
      if (!mediaDevices?.getUserMedia) throw new Error('当前浏览器无法开启相机，可选择图片或填写信息');
      const incoming = await openCameraStream(mediaDevices);
      if (disposed || !active || request !== generation) { stopCameraStream(incoming); return; }
      stream = incoming; video.srcObject = stream; video.muted = true;
      stream.getVideoTracks().forEach(track => track.addEventListener?.('ended', pause, { once: true }));
      await video.play();
      if (disposed || !active || request !== generation) return;
      message('正在加载文字识别…');
      tick(request);
      try {
        const engine = await loadRecognizer(text => {
          if (!disposed && active && request === generation && !worker && !capturedFrame) message(text);
        });
        if (disposed || !active || request !== generation) { await engine.terminate(); return; }
        worker = engine;
      } catch {
        if (disposed || !active || request !== generation) return;
        if (type === 'rail') {
          release();
          message('文字识别暂不可用，请重试');
          retry.textContent = '重试识别'; retry.hidden = false;
          return;
        }
        workerUnavailable = true;
        shutter.disabled = true;
        if (!capturedFrame?.candidate) {
          capturedFrame = null;
          guide.classList.remove('reading');
          message('文字识别暂不可用，可重试或扫描登机牌条码');
          retry.textContent = '重试识别'; retry.hidden = false;
        }
      }
    } catch (error) {
      if (disposed || request !== generation) return;
      release(); message(cameraError(error)); retry.hidden = false;
    }
  }
  const visibility = () => { if (doc.visibilityState === 'hidden') pause(); };
  const changeType = event => {
    const button = event.target.closest('[data-scan-type]'); if (!button) return;
    if (type === button.dataset.scanType) return;
    type = button.dataset.scanType; typeEpoch++; resetFrames();
    if (type === 'rail' && workerUnavailable) {
      pause(); message('文字识别暂不可用，请重试'); retry.textContent = '重试识别';
    }
    guide.style.setProperty('--ticket-ratio', type === 'flight' ? 2.46 : 1.58);
    for (const b of root.querySelectorAll('[data-scan-type]')) { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', String(b === button)); }
  };
  retry.addEventListener('click', start); shutter.addEventListener('click', takePhoto); root.addEventListener('click', changeType);
  doc.addEventListener('visibilitychange', visibility); win.addEventListener('pagehide', pause);
  void start();
  return () => { disposed = true; release(); retry.removeEventListener('click', start); shutter.removeEventListener('click', takePhoto); root.removeEventListener('click', changeType); doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('pagehide', pause); };
}
