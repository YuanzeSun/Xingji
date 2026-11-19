import * as db from './db.js';
import { clone, deduplicateRecords, mergeThreeWay, now, sameRecords } from './model.js';
import { sharedSettings, sameSettings, mergeSettings, preservedSettings } from './shared-settings.js';
import { upgradeCodeRecords, hasLegacyCodes } from './code-upgrade.js';

const keys = ['records', 'base', 'settings', 'settingsBase', 'github', 'd1', 'syncMeta', 'lastSync'];
export { sameRecords };
const binding = config => config ? `${config.id}:${config.branch}` : '';
export const activeBinding = ({ d1, config }) => d1 ? `d1:${d1.id}:${d1.url}` : binding(config);
function unpack(raw) {
  return { records: raw.records || [], base: raw.base || [], settings: sharedSettings(raw.settings), settingsBase: sharedSettings(raw.settingsBase), config: raw.github || null, d1: raw.d1 || null, meta: { revision: 0, head: '', verified: false, pending: false, ...raw.syncMeta }, lastSync: raw.lastSync || null };
}
export async function readSyncState() {
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await db.atomic(keys), snapshot = unpack(raw);
    if (!hasLegacyCodes(snapshot.records) && !hasLegacyCodes(snapshot.base)) return snapshot;
    const records = await upgradeCodeRecords(snapshot.records), base = await upgradeCodeRecords(snapshot.base);
    const migrated = await db.atomic(keys, current => {
      if (JSON.stringify(current.records) !== JSON.stringify(raw.records) || JSON.stringify(current.base) !== JSON.stringify(raw.base)) return { result: null };
      const latest = unpack(current), meta = { ...latest.meta, revision: latest.meta.revision + 1 };
      return { write: { records, base, syncMeta: meta }, result: { ...latest, records, base, meta } };
    });
    if (migrated) return migrated;
  }
  throw new Error('条码转换期间其他标签页持续修改，请刷新重试');
}
export async function bindRepository(config, expectedD1 = null, credential) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (activeBinding({ d1: current.d1 }) !== activeBinding({ d1: expectedD1 })) throw new Error('主存储已变化，请刷新后重新连接');
    if (current.config && binding(current.config) !== binding(config)) throw new Error('本机缓存已绑定其他仓库，不能混入当前票库');
    const bound = clone(config);
    const write = { github: bound };
    if (credential !== undefined) write.githubToken = credential;
    return { write, result: { ...current, config: bound } };
  });
}
export function signOutCloud() {
  return db.atomic(['syncMeta'], raw => {
    const write = {
      github: null, d1: null, githubToken: '', d1Token: '', showDemo: false, cloudLinkReady: false,
      records: [], base: [], settings: {}, settingsBase: {},
      syncMeta: { revision: (raw.syncMeta?.revision || 0) + 1 }, lastSync: null
    };
    return { write, result: unpack(write) };
  });
}

export function keepUnlinkedArchive(captured, provider, archive, credential) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (activeBinding(current) !== activeBinding(captured) || current.config?.id !== captured.config?.id ||
        current.config?.branch !== captured.config?.branch || current.meta.revision !== captured.meta.revision || current.meta.head !== captured.meta.head) {
      throw new Error('本机票库已变化，请重新登录');
    }
    const github = provider === 'github';
    const records = clone(archive.records), settings = sharedSettings(archive.settings);
    const syncMeta = { revision: current.meta.revision + 1, head: archive.head, generation: archive.generation, verified: true, pending: false };
    const write = {
      github: github ? current.config : null, d1: github ? null : current.d1,
      githubToken: github ? credential : '', d1Token: github ? '' : credential,
      records, base: clone(records), settings, settingsBase: clone(settings), syncMeta, lastSync: now(),
      cloudLinkReady: false, showDemo: false
    };
    return { write, result: unpack(write) };
  });
}

export async function activateD1(captured, config, remote, { credential, github, cloudLinkReady } = {}) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (activeBinding(current) !== activeBinding(captured) || current.meta.revision !== captured.meta.revision || current.meta.head !== captured.meta.head) throw new Error('本机票库已变化，请重新核对后连接');
    const records = clone(remote.records), settings = sharedSettings(remote.settings), lastSync = now();
    const meta = { revision: current.meta.revision + 1, head: remote.head, generation: remote.generation || '', verified: true, pending: false };
    const write = { d1: config, records, base: clone(records), settings, settingsBase: clone(settings), syncMeta: meta, lastSync };
    if (credential !== undefined) write.d1Token = credential;
    if (cloudLinkReady !== undefined) write.cloudLinkReady = cloudLinkReady;
    if (github) {
      write.github = clone(github.config);
      write.githubToken = github.token;
    }
    return { write, result: unpack({ ...raw, ...write }) };
  });
}

function stageChange(config, d1, change) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (!current.meta.verified || activeBinding(current) !== activeBinding({ config, d1 })) throw new Error('请先连接并同步云端票库');
    const { records = current.records, settings = current.settings } = change(current);
    const meta = { ...current.meta, revision: current.meta.revision + 1, pending: !sameRecords(records, current.base) || !sameSettings(settings, current.settingsBase) };
    return { write: { records, settings, syncMeta: meta }, result: { ...current, records, settings, meta } };
  });
}
function mergedRecords(expected, proposed, current) {
  const { records, conflicts } = mergeThreeWay(expected, proposed, current);
  if (conflicts.length) throw new Error('另一标签页已修改同一处，请保留当前输入并重新打开票据核对');
  return deduplicateRecords(records);
}
function mergedSettings(expected, proposed, current) {
  const { settings, conflicts } = mergeSettings(expected, proposed, current);
  if (conflicts.length) throw new Error('设置已在其他设备或标签页更新，请核对后再保存');
  return settings;
}
export function stageRecords(expected, proposed, config, d1 = null) {
  return stageChange(config, d1, current => ({ records: mergedRecords(expected, proposed, current.records) }));
}
export function stageSettings(expected, proposed, config, d1 = null) {
  return stageChange(config, d1, current => ({ settings: mergedSettings(expected, proposed, current.settings) }));
}
export function stageBackup(expected, proposed, config, d1) {
  return stageChange(config, d1, current => ({
    records: mergedRecords(expected.records, proposed.records, current.records),
    settings: mergedSettings(expected.settings, { ...proposed.settings, connections: expected.settings.connections }, current.settings)
  }));
}
export async function acknowledgeSync(captured, remote) {
  if (!remote.head) throw new Error('云端没有确认版本，保留本机待同步内容');
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (activeBinding(current) !== activeBinding(captured) || current.meta.head !== captured.meta.head) return { result: { ...current, retry: true } };
    const merged = mergeThreeWay(captured.records, current.records, remote.records);
    const mergedSettings = mergeSettings(captured.settings, current.settings, remote.settings);
    if (merged.conflicts.length || mergedSettings.conflicts.length) return { result: { ...current, retry: true } };
    const records = deduplicateRecords(merged.records), base = clone(remote.records), lastSync = now();
    const settings = mergedSettings.settings, settingsBase = sharedSettings(remote.settings);
    const pending = !sameRecords(records, base) || !sameSettings(settings, settingsBase);
    const changed = !sameRecords(records, current.records) || !sameRecords(base, current.base) || !sameSettings(settings, current.settings) || !sameSettings(settingsBase, current.settingsBase) || current.meta.head !== remote.head || !current.meta.verified || current.meta.pending !== pending;
    const meta = { revision: current.meta.revision + Number(changed), head: remote.head, generation: remote.generation || '', verified: true, pending };
    return { write: { records, base, settings, settingsBase, syncMeta: meta, lastSync }, result: { ...current, records, base, settings, settingsBase, meta, lastSync, changed } };
  });
}

export async function replaceWithRemote(captured, remote) {
  return db.atomic([...keys,'githubToken'], raw => {
    const current = unpack({...raw,settings:preservedSettings(raw.settings),settingsBase:preservedSettings(raw.settingsBase)});
    if (current.d1 || binding(current.config) !== binding(captured.config) || current.meta.revision !== captured.meta.revision || current.meta.head !== captured.meta.head) throw new Error('本机票库已变化，请重新检查后确认重置');
    const records = clone(remote.records), settings = sharedSettings(remote.settings), lastSync = now();
    const meta = { revision: current.meta.revision + 1, head: remote.head, generation: remote.generation || '', verified: true, pending: false };
    return { clear:true, write: { github:current.config,githubToken:raw.githubToken || '',showDemo:false,records, base: clone(records), settings, settingsBase: clone(settings), syncMeta: meta, lastSync }, result: { ...current, records, base: clone(records), settings, settingsBase: clone(settings), meta, lastSync } };
  });
}

export async function readResetState() {
  const raw=await db.atomic(keys);
  return unpack({...raw,settings:preservedSettings(raw.settings),settingsBase:preservedSettings(raw.settingsBase)});
}
