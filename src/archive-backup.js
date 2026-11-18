import { archive, readArchive } from './model.js';
import { sharedSettings } from './shared-settings.js';
import { workerURL } from './d1.js';

const backupFormat = 'xingji-backup';
const slug = /^[A-Za-z0-9_.-]+$/;
const secret = value => {
  if (typeof value !== 'string' || /\s/.test(value)) throw new Error('备份中的访问凭证格式无效');
  return value;
};

function backupConnections({ github, d1 }) {
  if (github && (!slug.test(github.owner || '') || !slug.test(github.repo || '') || !Number.isSafeInteger(github.id) ||
      typeof github.branch !== 'string' || !github.branch)) throw new Error('备份中的 GitHub 仓库信息无效');
  if (d1 && !/^[0-9a-f]{32}$/.test(d1.id || '')) throw new Error('备份中的 D1 数据库信息无效');
  return {
    ...(github ? { github: { owner: github.owner, repo: github.repo, id: github.id, branch: github.branch, token: secret(github.token) } } : {}),
    ...(d1 ? { d1: { id: d1.id, url: workerURL(d1.url), token: secret(d1.token) } } : {})
  };
}

export function fullBackup(records, settings, connections) {
  return { ...archive(records), format: backupFormat, settings: sharedSettings(settings), connections: backupConnections(connections) };
}

export function readFullBackup(value) {
  if (value?.format !== backupFormat || !value.settings || !value.connections || typeof value.connections !== 'object' ||
      Array.isArray(value.connections)) throw new Error('请选择行迹导出的完整 JSON 备份');
  return {
    records: readArchive({ ...value, format: 'xingji-archive' }),
    settings: sharedSettings(value.settings),
    connections: backupConnections(value.connections)
  };
}
