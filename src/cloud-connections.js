const object = value => value && typeof value === 'object' && !Array.isArray(value);
const slug = /^[A-Za-z0-9_.-]+$/;

export function workerURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 Worker 地址'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
      url.search || url.hash || url.pathname !== '/') throw new Error('请输入 Worker 的根地址，例如 https://your-archive.workers.dev');
  return url.origin;
}

const secret = value => {
  if (typeof value !== 'string' || /\s/.test(value)) throw new Error('备份中的访问凭证格式无效');
  return value;
};

export function backupConnections(value = {}) {
  if (!object(value)) throw new Error('备份中的账号信息无效');
  const { github, d1 } = value;
  if (github != null && (!object(github) || typeof github.owner !== 'string' || !slug.test(github.owner) ||
      typeof github.repo !== 'string' || !slug.test(github.repo) || !Number.isSafeInteger(github.id) ||
      typeof github.branch !== 'string' || !github.branch)) throw new Error('备份中的 GitHub 仓库信息无效');
  if (d1 != null && (!object(d1) || typeof d1.id !== 'string' || !/^[0-9a-f]{32}$/.test(d1.id) || typeof d1.url !== 'string')) throw new Error('备份中的 D1 数据库信息无效');
  return {
    ...(github ? { github: { owner: github.owner, repo: github.repo, id: github.id, branch: github.branch, token: secret(github.token) } } : {}),
    ...(d1 ? { d1: { id: d1.id, url: workerURL(d1.url), token: secret(d1.token) } } : {})
  };
}
