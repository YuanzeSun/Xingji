export function supportsDesktopMcp(device = globalThis.navigator) {
  return !/Android|iPhone|iPad|iPod/i.test(device?.userAgent || '') && !(device?.platform === 'MacIntel' && device?.maxTouchPoints > 1);
}
