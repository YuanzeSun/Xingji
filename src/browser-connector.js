export const XINGJI_CONNECTOR_ID = 'cdfbjakbkjobffeijnoghaaccohghome';

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
