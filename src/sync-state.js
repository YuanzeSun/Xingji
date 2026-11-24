import * as db from './db.js';
import { applyImport, clone, deduplicateRecords, mergeThreeWay, now, sameRecords } from './model.js';
import { applyReviewedTicket } from './ticket-import-review.js';
import { sharedSettings, sameSettings, mergeSettings, preservedSettings } from './shared-settings.js';

const keys = ['records', 'base', 'settings', 'settingsBase', 'github', 'd1', 'syncMeta', 'lastSync', 'archiveResetProgress'];
export { sameRecords };
const binding = config => config ? `${config.id}:${config.branch}` : '';
export const activeBinding = ({ d1, config }) => d1 ? `d1:${d1.id}:${d1.url}` : binding(config);
const sessionKeys = [...keys, 'githubToken', 'd1Token', 'showDemo', 'githubBackupReceipt'];

function unpack(raw, session = false) {
  return {
    records: raw.records || [],
    base: raw.base || [],
    settings: sharedSettings(raw.settings),
    settingsBase: sharedSettings(raw.settingsBase),
    config: raw.github || null,
    d1: raw.d1 || null,
    meta: { revision: 0, head: '', verified: false, pending: false, ...raw.syncMeta },
    lastSync: raw.lastSync || null,
    archiveResetProgress: raw.archiveResetProgress || null,
    ...(session ? { credentials: { github: raw.github ? raw.githubToken || '' : '', d1: raw.d1 ? raw.d1Token || '' : '' }, showDemo: raw.showDemo === true, githubBackupReceipt: raw.githubBackupReceipt || null } : {})
  };
}
export async function readSyncState({ session = false } = {}) {
  return unpack(await db.atomic(session ? sessionKeys : keys), session);
}

export function sameArchiveBaseline(current, expected) {
  return activeBinding(current) === activeBinding(expected) &&
    binding(current.config) === binding(expected.config) &&
    current.meta.revision === expected.meta.revision && current.meta.head === expected.meta.head;
}

function archiveFields(current, remote) {
  const records = clone(remote.records), settings = sharedSettings(remote.settings);
  const syncMeta = {
    revision: current.meta.revision + 1, head: remote.head, generation: remote.generation || '', verified: true, pending: false
  };
  return { records, settings, base: clone(records), settingsBase: clone(settings), syncMeta, lastSync: now() };
}

export function bindRepository(config, expectedD1 = null, credential, cloudLinkReady) {
  return db.atomic(sessionKeys, raw => {
    const current = unpack(raw);
    if (activeBinding({ d1: current.d1 }) !== activeBinding({ d1: expectedD1 })) throw new Error('主存储已变化，请刷新后重新连接');
    if (current.config && binding(current.config) !== binding(config)) throw new Error('本机缓存已绑定其他仓库，不能混入当前票库');
    const bound = clone(config);
    const write = { github: bound };
    if (credential !== undefined) write.githubToken = credential;
    if (cloudLinkReady !== undefined) write.cloudLinkReady = cloudLinkReady;
    return { write, result: unpack({ ...raw, ...write }, true) };
  });
}
export function saveArchiveResetProgress(progress, expected, captured) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    const previous = current.archiveResetProgress;
    if (previous?.id !== expected?.id || previous?.step !== expected?.step ||
        (captured && !sameArchiveBaseline(current, captured))) {
      throw new Error('本机重置状态已变化，请重新核对');
    }
    return { write: { archiveResetProgress: progress } };
  });
}

export function signOutCloud() {
  return db.atomic(['syncMeta'], raw => {
    const write = {
      github: null, d1: null, githubToken: '', d1Token: '', showDemo: false, cloudLinkReady: false, githubBackupReceipt: null,
      records: [], base: [], settings: {}, settingsBase: {}, archiveResetProgress: null,
      syncMeta: { revision: (raw.syncMeta?.revision || 0) + 1 }, lastSync: null
    };
    return { write, result: unpack(write, true) };
  });
}

export function keepUnlinkedArchive(captured, provider, archive, credential, resetId) {
  return db.atomic(sessionKeys, raw => {
    const current = unpack(raw);
    if (!sameArchiveBaseline(current, captured) || current.archiveResetProgress?.id !== resetId) {
      throw new Error('本机票库已变化，请重新登录');
    }
    const github = provider === 'github';
    const write = {
      ...archiveFields(current, archive),
      github: github ? current.config : null, d1: github ? null : current.d1,
      githubToken: github ? credential : '', d1Token: github ? '' : credential,
      cloudLinkReady: false, showDemo: false, githubBackupReceipt: null, archiveResetProgress: null
    };
    return { write, result: unpack(write, true) };
  });
}

export function activateD1(captured, config, remote, { credential, github, cloudLinkReady, resetId } = {}) {
  return db.atomic(sessionKeys, raw => {
    const current = unpack(raw);
    if (activeBinding(current) !== activeBinding(captured) || current.meta.revision !== captured.meta.revision || current.meta.head !== captured.meta.head) throw new Error('本机票库已变化，请重新核对后连接');
    if (current.archiveResetProgress && current.archiveResetProgress.id !== resetId) throw new Error('请先处理未完成的仓库重置');
    const write = { d1: config, ...archiveFields(current, remote) };
    if (resetId) {
      if (current.archiveResetProgress?.id !== resetId) throw new Error('重置记录已变化');
      Object.assign(write, { archiveResetProgress: null, githubBackupReceipt: null, showDemo: false });
    }
    if (credential !== undefined) write.d1Token = credential;
    if (cloudLinkReady !== undefined) write.cloudLinkReady = cloudLinkReady;
    if (github) {
      write.github = clone(github.config);
      write.githubToken = github.token;
    }
    return { write, result: unpack({ ...raw, ...write }, true) };
  });
}

function stageChange(config, d1, change) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (current.archiveResetProgress) throw new Error('请先处理未完成的仓库重置');
    if (!current.meta.verified || activeBinding(current) !== activeBinding({ config, d1 })) throw new Error('请先连接并同步云端票库');
    const { records = current.records, settings = current.settings, ...result } = change(current);
    const meta = { ...current.meta, rejection: null, revision: current.meta.revision + 1, pending: !sameRecords(records, current.base) || !sameSettings(settings, current.settingsBase) };
    return { write: { records, settings, syncMeta: meta }, result: { ...current, records, settings, meta, ...result } };
  });
}
function mergedRecords(expected, proposed, current) {
  const { records, conflicts } = mergeThreeWay(expected, proposed, current);
  if (conflicts.length) throw new Error('另一标签页已修改同一处，请保留当前输入并重新打开票据核对');
  return deduplicateRecords(records, { knownIdsOnly: true });
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
export function stageImport(candidates, config, d1, expectedSettings, settings) {
  return stageChange(config, d1, current => ({
    ...applyImport(current.records, candidates, { knownIdsOnly: true }),
    settings: settings ? mergedSettings(expectedSettings, { ...settings, connections: expectedSettings.connections }, current.settings) : current.settings
  }));
}
export function stageTicket(candidate, config, d1, decision) {
  return stageChange(config, d1, current => applyReviewedTicket(current.records, candidate, decision));
}
export function rejectPendingChange(captured, message) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (!current.meta.pending || !sameArchiveBaseline(current, captured)) return { result: current };
    if (current.meta.rejection === message) return { result: current };
    const meta = { ...current.meta, revision: current.meta.revision + 1, rejection: message };
    return { write: { syncMeta: meta }, result: { ...current, meta } };
  });
}
export function discardRejectedChange(captured) {
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (!current.meta.rejection || current.archiveResetProgress || !sameArchiveBaseline(current, captured)) {
      throw new Error('待同步的修改已变化，请重新核对。');
    }
    const records = clone(current.base), settings = clone(current.settingsBase);
    const meta = { ...current.meta, revision: current.meta.revision + 1, pending: false, rejection: null };
    return { write: { records, settings, syncMeta: meta }, result: { ...current, records, settings, meta } };
  });
}
export async function acknowledgeSync(captured, remote) {
  if (!remote.head) throw new Error('云端没有确认版本，保留本机待同步内容');
  return db.atomic(keys, raw => {
    const current = unpack(raw);
    if (activeBinding(current) !== activeBinding(captured) || current.meta.head !== captured.meta.head) return { result: { ...current, retry: true } };
    const merged = mergeThreeWay(captured.records, current.records, remote.records);
    const mergedSettings = mergeSettings(captured.settings, current.settings, remote.settings);
    if (merged.conflicts.length || mergedSettings.conflicts.length) return { result: { ...current, retry: true } };
    const records = deduplicateRecords(merged.records, { knownIdsOnly: true }), base = clone(remote.records), lastSync = now();
    const settings = mergedSettings.settings, settingsBase = sharedSettings(remote.settings);
    const pending = !sameRecords(records, base) || !sameSettings(settings, settingsBase);
    const changed = !sameRecords(records, current.records) || !sameRecords(base, current.base) || !sameSettings(settings, current.settings) || !sameSettings(settingsBase, current.settingsBase) || current.meta.head !== remote.head || !current.meta.verified || current.meta.pending !== pending;
    const meta = { revision: current.meta.revision + Number(changed), head: remote.head, generation: remote.generation || '', verified: true, pending };
    return { write: { records, base, settings, settingsBase, syncMeta: meta, lastSync }, result: { ...current, records, base, settings, settingsBase, meta, lastSync, changed } };
  });
}

function unpackReset(raw, session = false) {
  return unpack({ ...raw, settings: preservedSettings(raw.settings), settingsBase: preservedSettings(raw.settingsBase) }, session);
}

export function replaceWithRemote(captured, remote) {
  return db.atomic([...keys, 'githubToken'], raw => {
    const current = unpackReset(raw);
    if (current.d1 || !sameArchiveBaseline(current, captured)) throw new Error('本机票库已变化，请重新检查后确认重置');
    const write = {
      ...archiveFields(current, remote), github: current.config, githubToken: raw.githubToken || '', showDemo: false
    };
    return { clear: true, write, result: unpack(write, true) };
  });
}

export async function readResetState() {
  return unpackReset(await db.atomic(sessionKeys), true);
}
