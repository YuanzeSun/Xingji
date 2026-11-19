import { personalProfile, hasPersonalProfile } from './personal-profile.js';
import { backupConnections } from './cloud-connections.js';

export function sharedSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('云端连接设置格式无效');
  if (Object.keys(value).some(key => !['flightMcpKey','profile','connections'].includes(key))) throw new Error('云端设置包含当前版本不支持的字段，请更新页面后重试');
  const key = value.flightMcpKey ?? '';
  if (typeof key !== 'string' || key.length > 8192 || /[\x00-\x20\x7f]/.test(key)) throw new Error('飞常准 MCP Key 格式无效');
  const profile = personalProfile(value.profile);
  const connections = backupConnections(value.connections);
  return { flightMcpKey: key, ...(hasPersonalProfile(profile) ? { profile } : {}), ...(Object.keys(connections).length ? { connections } : {}) };
}
export const sameSettings = (a, b) => JSON.stringify(sharedSettings(a)) === JSON.stringify(sharedSettings(b));
export function mergeSettings(base, local, remote) {
  base = sharedSettings(base); local = sharedSettings(local); remote = sharedSettings(remote);
  const settings = { ...local }, conflicts = [];
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  for (const field of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    if (same(local[field],remote[field]) || same(remote[field],base[field])) continue;
    if (same(local[field],base[field])) { if (remote[field] === undefined) delete settings[field]; else settings[field] = structuredClone(remote[field]); }
    else conflicts.push({ id: 'settings', kind: 'settings', field, base: base[field], local: local[field], remote: remote[field] });
  }
  return { settings:sharedSettings(settings), conflicts };
}
export const maskedKey = value => value ? value.length > 8 ? `已设置 · 尾号 ${value.slice(-4)}` : '已设置 · 已隐藏' : '未设置';

export function preservedSettings(value = {}) {
  return sharedSettings({flightMcpKey:value?.flightMcpKey ?? '',profile:value?.profile,connections:value?.connections});
}

export const unlinkedSettings = settings => sharedSettings({ ...settings, connections: { unlinked: true } });
export const wasUnlinked = snapshot => snapshot?.settings?.connections?.unlinked === true;
