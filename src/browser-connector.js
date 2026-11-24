export const XINGJI_CONNECTOR_ID = 'cdfbjakbkjobffeijnoghaaccohghome';

export function supportsBrowserConnector(device = globalThis.navigator) {
  const userAgent = device?.userAgent || '';
  return /\b(?:Chrome|Chromium|Edg)\//.test(userAgent) &&
    !/Android|iPhone|iPad|iPod|\bMobile\b/i.test(userAgent) &&
    !(device?.platform === 'MacIntel' && device.maxTouchPoints > 1);
}

export function isBrowserConnectorInstalled(runtime = globalThis.chrome?.runtime) {
  if (typeof runtime?.sendMessage !== 'function') return Promise.resolve(false);
  return new Promise(resolve => {
    try {
      runtime.sendMessage(XINGJI_CONNECTOR_ID, { action: 'connectorStatus' }, response => {
        resolve(!runtime.lastError && response?.installed === true);
      });
    } catch {
      resolve(false);
    }
  });
}
