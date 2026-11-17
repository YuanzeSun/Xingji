// An installed worker can update while a mobile browser keeps the old page alive.
// Compare the running entry with its cached shell; never reload an editing page automatically.
export function watchAppUpdates({ canReload = () => true, notify = () => {}, onError = () => {}, reload = () => window.location.reload() } = {}) {
  if (!('serviceWorker' in navigator)) return;
  const worker = navigator.serviceWorker;
  const runningApp = document.querySelector('script[type="module"][src]')?.src;
  let registration, checking = false, lastCheck = Date.now(), notice;
  const askVersion = () => worker.controller?.postMessage({ type: 'XINGJI_CHECK_APP_VERSION' });
  const receiveVersion = event => {
    if (!runningApp || event.source !== worker.controller || event.data?.type !== 'XINGJI_APP_VERSION' || typeof event.data.appUrl !== 'string') return;
    let latest;
    try { latest = new URL(event.data.appUrl); } catch { return; }
    if (latest.origin !== location.origin || latest.href === runningApp || notice) return;
    notice = document.createElement('div');
    notice.className = 'app-update'; notice.setAttribute('role', 'status');
    const label = document.createElement('span'); label.textContent = '新版本已就绪';
    const button = document.createElement('button'); button.className = 'button small'; button.textContent = '更新并刷新';
    button.onclick = () => {
      const allowed = canReload();
      if (allowed !== true) { notify(allowed || '请先保存或关闭正在编辑的内容，再更新'); return; }
      reload();
    };
    notice.append(label, button); document.body.append(notice);
  };
  const check = async () => {
    if (!registration || checking || navigator.onLine === false || document.visibilityState === 'hidden' || Date.now() - lastCheck < 60000) return;
    checking = true; lastCheck = Date.now();
    try { await registration.update(); } catch { /* Keep offline access available. */ }
    finally { checking = false; askVersion(); }
  };
  worker.addEventListener('message', receiveVersion);
  worker.addEventListener('controllerchange', askVersion);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('online', check);
  window.addEventListener('focus', check);
  worker.register('./sw.js', { updateViaCache: 'none' }).then(value => { registration = value; askVersion(); }).catch(onError);
  return () => {
    worker.removeEventListener('message', receiveVersion);
    worker.removeEventListener('controllerchange', askVersion);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('online', check);
    window.removeEventListener('focus', check);
    notice?.remove();
  };
}
