import { archive, readArchive } from './model.js';
import { sharedSettings } from './shared-settings.js';
import { backupConnections } from './cloud-connections.js';

const backupFormat = 'xingji-backup';
export function fullBackup(records, settings, connections) {
  const { connections: saved, ...preferences } = sharedSettings(settings);
  return { ...archive(records), format: backupFormat, settings: preferences, connections: backupConnections({ ...saved, ...backupConnections(connections) }) };
}

export function readFullBackup(value) {
  if (value?.format !== backupFormat || !value.settings || !value.connections || typeof value.connections !== 'object' ||
      Array.isArray(value.connections)) throw new Error('请选择行迹导出的完整 JSON 备份');
  const { connections: _accounts, ...settings } = sharedSettings(value.settings);
  return {
    records: readArchive({ ...value, format: 'xingji-archive' }),
    settings,
    connections: backupConnections(value.connections)
  };
}
