import { alignMergedIds, archive, readArchive, mergeThreeWay, partition, deduplicateRecords, resolveRecordConflict, sameRecords, yearOf } from './model.js';
import { sharedSettings, sameSettings, mergeSettings, preservedSettings, unlinkedSettings } from './shared-settings.js';

export class GitHubError extends Error { constructor(message, status, retryAt = 0) { super(message); this.status = status; this.retryAt = retryAt; } }
export class ArchiveResetError extends Error {
  constructor(snapshot, remoteReset = false) {
    super(remoteReset ? '云端票库已被重置，本机旧缓存已停止上传' : '检测到云端票库索引或数据文件已被删除，已停止写入');
    this.code = remoteReset ? 'ARCHIVE_RESET' : 'ARCHIVE_FILES_MISSING'; this.snapshot = snapshot;
  }
}
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export class GitHubStore {
  constructor(config, token, fetcher = fetch, { signal } = {}) { this.config = config; this.token = token; this.fetcher = fetcher.bind(globalThis); this.signal = signal; }
  async request(path, options = {}) {
    const { owner, repo } = this.config;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('仓库名称格式无效');
    const response = await this.fetcher(`https://api.github.com/repos/${owner}/${repo}${path}`, { ...options, cache: 'no-store', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
    if (!response.ok) {
      const messages = { 401: 'GitHub凭证无效或已过期，请重新配置', 403: 'GitHub权限不足或请求额度已用尽，请检查凭证', 404: '找不到仓库或文件，请检查仓库名称和凭证权限', 409: '另一台设备刚更新了票库，请重新同步', 422: '仓库版本已变化或写入参数无效，请重新同步' };
      const retry = response.headers.get('retry-after'), reset = response.headers.get('x-ratelimit-reset');
      const retryAt = retry ? Date.now() + (Number(retry) || 60) * 1000 : response.headers.get('x-ratelimit-remaining') === '0' && reset ? Number(reset) * 1000 : 0;
      throw new GitHubError(messages[response.status] || `GitHub请求失败（${response.status}）`, response.status, retryAt);
    }
    return response.json();
  }
  async verify() {
    const repo = await this.request('');
    if (!repo.private) throw new Error('数据仓库必须是私有仓库，请勿将个人行程写入公开仓库');
    if (!repo.permissions?.push) throw new Error('当前凭证没有此仓库的写入权限');
    if (!Number.isSafeInteger(repo.id) || (this.config.id && this.config.id !== repo.id)) throw new Error('仓库身份发生变化，已停止同步并保留本机缓存');
    this.config.id = repo.id;
    this.config.branch ||= repo.default_branch || 'main';
    return repo;
  }
  async head() {
    const { branch = 'main' } = this.config;
    try { return (await this.request(`/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha; }
    catch (error) { if ([404, 409].includes(error.status)) throw new Error('仓库分支不存在或尚未初始化，请先在仓库创建README'); throw error; }
  }
  async assertDescendant(previous, head) {
    if (!previous || previous === head) return;
    const comparison = await this.request(`/compare/${encodeURIComponent(previous)}...${encodeURIComponent(head)}`);
    if (!['ahead', 'identical'].includes(comparison.status)) throw new Error('云端历史被回退或分叉，已停止写入并保留本机缓存');
  }
  async readBlob(sha) {
    const blob = await this.request(`/git/blobs/${sha}`);
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('云端文件内容不完整，保留本机缓存');
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0)));
  }
  async readArchiveIndex() {
    const head = await this.head();
    const commit = await this.request(`/git/commits/${head}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('仓库文件目录过大，请使用独立的数据仓库');
    const shards = tree.tree.filter(e => /^archive\/(\d{4}|unknown)\.json$/.test(e.path) && e.type === 'blob');
    const index = tree.tree.find(entry => entry.path === 'archive/index.json' && entry.type === 'blob');
    const manifest = index ? JSON.parse(await this.readBlob(index.sha)) : null;
    if (index) {
      if (manifest?.format !== 'xingji-index' || manifest.schemaVersion !== 1 ||
          !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) ||
          !Number.isSafeInteger(manifest.recordCount) || !Object.hasOwn(manifest, 'settings')) {
        throw new Error('云端票库索引无效');
      }
      if (typeof manifest.generation !== 'string' || !/^[A-Za-z0-9-]{0,100}$/.test(manifest.generation)) {
        throw new Error('云端票库重置标识无效');
      }
    }
    const snapshot = {
      records: [], settings: sharedSettings(manifest?.settings), head, tree: commit.tree.sha,
      paths: shards.map(item => item.path), contents: {}, initialized: !!index, generation: manifest?.generation ?? ''
    };
    return { snapshot, manifest, shards };
  }
  async read(index) {
    const { snapshot, manifest, shards } = index ?? await this.readArchiveIndex();
    if (!manifest) {
      if (shards.length) throw new ArchiveResetError(snapshot);
      return snapshot;
    }
    const manifestPaths = Object.keys(manifest.files);
    const shardPaths = new Set(snapshot.paths);
    if (manifestPaths.some(path => !shardPaths.has(path))) throw new ArchiveResetError({ ...snapshot, initialized: false, settings: sharedSettings(), generation: '' });
    if (manifestPaths.length !== snapshot.paths.length) throw new Error('云端票库文件不完整，已停止同步');
    const records = [], contents = {};
    // Bound API concurrency to avoid burst throttling on decades of history.
    for (let i = 0; i < shards.length; i += 4) {
      const groups = await Promise.all(shards.slice(i, i + 4).map(async item => {
        const content = await this.readBlob(item.sha);
        if (await digest(content) !== manifest.files[item.path]) throw new Error('云端票库文件校验失败，保留本机缓存');
        const rows = readArchive(JSON.parse(content));
        if (rows.some(record => yearOf(record) !== item.path.slice(8, -5))) throw new Error('云端票据年份与文件不匹配');
        contents[item.path] = content;
        return rows;
      }));
      records.push(...groups.flat());
    }
    if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('远端票库包含重复ID，请先导出检查');
    if (records.length !== manifest.recordCount) throw new Error('云端票据数量与索引不匹配');
    return { ...snapshot, records, contents };
  }
  async resetTarget(fallbackSettings = {}) {
    await this.verify();
    const head=await this.head(),commit=await this.request('/git/commits/'+head),tree=await this.request('/git/trees/'+commit.tree.sha+'?recursive=1');
    if(tree.truncated)throw new Error('仓库目录不完整，无法安全重置');
    const index=tree.tree.find(entry=>entry.path==='archive/index.json' && entry.type==='blob');
    let settings=preservedSettings(fallbackSettings), generation = '', recordCount;

    if(index){
      const blob=await this.request('/git/blobs/'+index.sha);
      if(blob.encoding!=='base64' || typeof blob.content!=='string')throw new Error('无法读取要保留的个人资料和 MCP 设置');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));
      let manifest;try{manifest=JSON.parse(text);}catch{throw new Error('无法读取索引中的个人资料和 MCP 设置，请先备份');}
      settings=preservedSettings(manifest.settings || {});
      generation = manifest.generation || '';
      recordCount = manifest.recordCount;
    }
    return {head,tree:commit.tree.sha,settings,generation,recordCount,paths:tree.tree.filter(entry=>entry.type!=='tree').map(entry=>entry.path)};
  }
  async resetRepository(expectedHead, fallbackSettings = {}, { unlink = false, generation = crypto.randomUUID() } = {}) {
    const snapshot=await this.resetTarget(fallbackSettings);
    if(snapshot.head!==expectedHead)throw new GitHubError('仓库已变化，请重新检查后确认重置',409);
    const settings = unlink ? unlinkedSettings(snapshot.settings) : snapshot.settings;
    const manifest={format:'xingji-index',schemaVersion:1,recordCount:0,generation,files:{},settings};
    const tree=await this.request('/git/trees',{method:'POST',body:JSON.stringify({tree:[{path:'archive/index.json',mode:'100644',type:'blob',content:JSON.stringify(manifest,null,2)}]})});
    const commit=await this.request('/git/commits',{method:'POST',body:JSON.stringify({message:'Reset private archive and retain personal settings',tree:tree.sha,parents:[snapshot.head]})});
    try { await this.request('/git/refs/heads/'+encodeURIComponent(this.config.branch||'main'),{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})}); }
    catch(error) { let head;try{head=await this.head();}catch{}if(head!==commit.sha)throw error; }
    return {records:[],settings,head:commit.sha,generation};
  }
  async write(records, snapshot, settings = snapshot.settings, message = 'Sync private ticket metadata') {
    const groups = partition(records);
    const previous = partition(snapshot.records || []);
    const contents = {}, files = {}, tree = [];
    for (const year of Object.keys(groups).sort()) {
      const path = `archive/${year}.json`, unchanged = JSON.stringify(groups[year]) === JSON.stringify(previous[year]);
      const content = unchanged && snapshot.contents?.[path] ? snapshot.contents[path] : JSON.stringify(archive(groups[year]), null, 2);
      contents[path] = content; files[path] = await digest(content);
      if (content !== snapshot.contents?.[path]) tree.push({ path, mode: '100644', type: 'blob', content });
    }
    tree.push({ path: 'archive/index.json', mode: '100644', type: 'blob', content: JSON.stringify({ format: 'xingji-index', schemaVersion: 1, recordCount: records.length, generation: snapshot.generation || '', files, settings: sharedSettings(settings) }, null, 2) });
    for (const path of snapshot.paths) if (!Object.hasOwn(groups, path.slice(8, -5))) tree.push({ path, mode: '100644', type: 'blob', sha: null });
    const createdTree = await this.request('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: snapshot.tree, tree }) });
    const commit = await this.request('/git/commits', { method: 'POST', body: JSON.stringify({ message, tree: createdTree.sha, parents: [snapshot.head] }) });
    // A non-forced ref update rejects concurrent sibling commits instead of overwriting them.
    await this.request(`/git/refs/heads/${encodeURIComponent(this.config.branch || 'main')}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
    return commit.sha;
  }
}
export async function synchronize(store, base, local, resolutions = {}, { baseHead = '', baseGeneration = '', baseSettings, localSettings, remoteSnapshot } = {}) {
  const snapshot = remoteSnapshot ?? await store.read();
  if (baseHead && snapshot.initialized === false) throw new ArchiveResetError(snapshot);
  if (baseHead && (snapshot.generation || '') !== baseGeneration) throw new ArchiveResetError(snapshot, true);
  if (baseHead && store.assertDescendant) await store.assertDescendant(baseHead, snapshot.head);
  const collapse = rows => deduplicateRecords(rows, { knownIdsOnly: true });
  const merge = mergeThreeWay(...alignMergedIds(base, local, snapshot.records).map(collapse));
  const settingMerge = mergeSettings(baseSettings, localSettings, snapshot.settings);
  const unresolved = [];
  for (const conflict of [...merge.conflicts, ...settingMerge.conflicts]) {
    const resolution = resolutions[`${conflict.id}:${conflict.field}`];
    if (!resolution || JSON.stringify(resolution.local) !== JSON.stringify(conflict.local) || JSON.stringify(resolution.remote) !== JSON.stringify(conflict.remote) || JSON.stringify(resolution.context) !== JSON.stringify(conflict.context)) unresolved.push(conflict);
    else if(conflict.kind === 'settings')settingMerge.settings[conflict.field]=resolution.choice === 'remote' ? conflict.remote : conflict.local;
    else resolveRecordConflict(merge.records.find(r=>r.id===conflict.id),conflict,resolution.choice);
  }
  if (unresolved.length) return { ...merge, settings: settingMerge.settings, conflicts: unresolved, snapshot };
  merge.records = collapse(merge.records);
  let head = snapshot.head;
  if (snapshot.initialized === false || !sameRecords(merge.records, snapshot.records) || !sameSettings(settingMerge.settings, snapshot.settings)) head = await store.write(merge.records, snapshot, settingMerge.settings) || head;
  return { records: merge.records, settings: settingMerge.settings, conflicts: [], head, generation: snapshot.generation || '' };
}
