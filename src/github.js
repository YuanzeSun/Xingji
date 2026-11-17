import {calendarDate} from './journey-date.js';
import { archive, readArchive, mergeThreeWay, partition, deduplicateRecords, resolveRecordConflict, sameRecords } from './model.js';
import { sharedSettings, sameSettings, mergeSettings, preservedSettings } from './shared-settings.js';
import { upgradeCodeRecords, hasLegacyCodes } from './code-upgrade.js';

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
  async read() {
    const head = await this.head();
    const commit = await this.request(`/git/commits/${head}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('仓库文件目录过大，请使用独立的数据仓库');
    const paths = tree.tree.filter(e => /^archive\/(\d{4}|unknown)\.json$/.test(e.path) && e.type === 'blob');
    const index = tree.tree.find(entry => entry.path === 'archive/index.json' && entry.type === 'blob');
    const empty = { records: [], settings: sharedSettings(), head, tree: commit.tree.sha, paths: paths.map(item => item.path), contents: {}, initialized: false, generation: '' };
    const textOf = async item => {
      const blob = await this.request(`/git/blobs/${item.sha}`);
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('云端文件内容不完整，保留本机缓存');
      return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(blob.content.replace(/\s/g, '')), c => c.charCodeAt(0)));
    };
    if (!index) {
      if (paths.length) throw new ArchiveResetError(empty);
      return empty;
    }
    const manifest = JSON.parse(await textOf(index));
    const settings = sharedSettings(manifest.settings);
    if (manifest.format !== 'xingji-index' || manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object' || Array.isArray(manifest.files) || !Number.isSafeInteger(manifest.recordCount)) throw new Error('云端票库索引无效');
    if (Object.keys(manifest.files).some(path => !empty.paths.includes(path))) throw new ArchiveResetError(empty);
    if (JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify(empty.paths.sort())) throw new Error('云端票库文件不完整，已停止同步');
    if (manifest.generation !== undefined && (typeof manifest.generation !== 'string' || !/^[A-Za-z0-9-]{0,100}$/.test(manifest.generation))) throw new Error('云端票库重置标识无效');
    const records = [], contents = {}, rewritePaths = [];
    // Bound API concurrency to avoid burst throttling on decades of history.
    for (let i = 0; i < paths.length; i += 4) {
      const groups = await Promise.all(paths.slice(i, i + 4).map(async item => {
        const content = await textOf(item);
        if (await digest(content) !== manifest.files[item.path]) throw new Error('云端票库文件校验失败，保留本机缓存');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed.records) && hasLegacyCodes(parsed.records)) {
          parsed.records = await upgradeCodeRecords(parsed.records); rewritePaths.push(item.path);
        }
        const rows = readArchive(parsed);
        if (rows.some(record => (calendarDate(record.departureDate).slice(0, 4) || 'unknown') !== item.path.slice(8, -5))) throw new Error('云端票据年份与文件不匹配');
        contents[item.path] = content;
        return rows;
      }));
      records.push(...groups.flat());
    }
    if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('远端票库包含重复ID，请先导出检查');
    if (records.length !== manifest.recordCount) throw new Error('云端票据数量与索引不匹配');
    return { records, settings, head, tree: commit.tree.sha, paths: paths.map(p => p.path), contents, initialized: true, rewritePaths, generation: manifest.generation || '' };
  }
  async resetTarget(fallbackSettings = {}) {
    await this.verify();
    const head=await this.head(),commit=await this.request('/git/commits/'+head),tree=await this.request('/git/trees/'+commit.tree.sha+'?recursive=1');
    if(tree.truncated)throw new Error('仓库目录不完整，无法安全重置');
    const index=tree.tree.find(entry=>entry.path==='archive/index.json' && entry.type==='blob');
    let settings=preservedSettings(fallbackSettings);
    if(index){
      const blob=await this.request('/git/blobs/'+index.sha);
      if(blob.encoding!=='base64' || typeof blob.content!=='string')throw new Error('无法读取要保留的个人资料和 MCP 设置');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));
      let manifest;try{manifest=JSON.parse(text);}catch{throw new Error('无法读取索引中的个人资料和 MCP 设置，请先备份');}
      settings=preservedSettings(manifest.settings || {});
    }
    return {head,tree:commit.tree.sha,settings,paths:tree.tree.filter(entry=>entry.type!=='tree').map(entry=>entry.path)};
  }
  async resetRepository(expectedHead, fallbackSettings = {}) {
    const snapshot=await this.resetTarget(fallbackSettings);
    if(snapshot.head!==expectedHead)throw new GitHubError('仓库已变化，请重新检查后确认重置',409);
    const generation=crypto.randomUUID(),manifest={format:'xingji-index',schemaVersion:1,recordCount:0,generation,files:{},settings:snapshot.settings};
    const tree=await this.request('/git/trees',{method:'POST',body:JSON.stringify({tree:[{path:'archive/index.json',mode:'100644',type:'blob',content:JSON.stringify(manifest,null,2)}]})});
    const commit=await this.request('/git/commits',{method:'POST',body:JSON.stringify({message:'Reset private archive and retain personal settings',tree:tree.sha,parents:[snapshot.head]})});
    try { await this.request('/git/refs/heads/'+encodeURIComponent(this.config.branch||'main'),{method:'PATCH',body:JSON.stringify({sha:commit.sha,force:false})}); }
    catch(error) { let head;try{head=await this.head();}catch{}if(head!==commit.sha)throw error; }
    return {records:[],settings:snapshot.settings,head:commit.sha,generation};
  }
  async write(records, snapshot, settings = snapshot.settings, message = 'Sync private ticket metadata') {
    const groups = partition(records);
    const previous = partition(snapshot.records || []);
    const contents = {}, files = {}, tree = [];
    for (const year of Object.keys(groups).sort()) {
      const path = `archive/${year}.json`, unchanged = !snapshot.rewritePaths?.includes(path) && JSON.stringify(groups[year]) === JSON.stringify(previous[year]);
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
export async function synchronize(store, base, local, resolutions = {}, { baseHead = '', baseGeneration = '', baseSettings, localSettings } = {}) {
  const snapshot = await store.read();
  if (baseHead && snapshot.initialized === false) throw new ArchiveResetError(snapshot);
  if (baseHead && (snapshot.generation || '') !== baseGeneration) throw new ArchiveResetError(snapshot, true);
  if (baseHead && store.assertDescendant) await store.assertDescendant(baseHead, snapshot.head);
  const grouped = deduplicateRecords([...base, ...local, ...snapshot.records]), aliases = new Map();
  for (const record of grouped) for (const id of [record.id, ...record.mergedIds]) aliases.set(id, { id: record.id, ids: [record.id, ...record.mergedIds] });
  const align = rows => deduplicateRecords(rows).map(record => { const group = aliases.get(record.id); return { ...record, id: group.id, mergedIds: group.ids.filter(id => id !== group.id).sort() }; });
  const merge = mergeThreeWay(align(base), align(local), align(snapshot.records));
  const settingMerge = mergeSettings(baseSettings, localSettings, snapshot.settings);
  const unresolved = [];
  for (const conflict of [...merge.conflicts, ...settingMerge.conflicts]) {
    const resolution = resolutions[`${conflict.id}:${conflict.field}`];
    if (!resolution || JSON.stringify(resolution.local) !== JSON.stringify(conflict.local) || JSON.stringify(resolution.remote) !== JSON.stringify(conflict.remote) || JSON.stringify(resolution.context) !== JSON.stringify(conflict.context)) unresolved.push(conflict);
    else if(conflict.kind === 'settings')settingMerge.settings[conflict.field]=resolution.choice === 'remote' ? conflict.remote : conflict.local;
    else resolveRecordConflict(merge.records.find(r=>r.id===conflict.id),conflict,resolution.choice);
  }
  if (unresolved.length) return { ...merge, settings: settingMerge.settings, conflicts: unresolved, snapshot };
  merge.records = deduplicateRecords(merge.records);
  let head = snapshot.head;
  if (snapshot.initialized === false || snapshot.rewritePaths?.length || !sameRecords(merge.records, snapshot.records) || !sameSettings(settingMerge.settings, snapshot.settings)) head = await store.write(merge.records, snapshot, settingMerge.settings) || head;
  return { records: merge.records, settings: settingMerge.settings, conflicts: [], head, generation: snapshot.generation || '' };
}
