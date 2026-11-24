import { createHash } from 'node:crypto';
import { archive, readArchive, partition } from '../../src/model.js';
import * as db from '../../src/db.js';
import { sharedSettings } from '../../src/shared-settings.js';

const hash = text => createHash('sha256').update(text).digest('hex');
export class MemoryGitHub {
  id = 77; private = true; authorized = true; available = true; sequence = 0; calls = []; blobs = new Map(); trees = new Map(); commits = new Map();
  constructor(records = [], settings = {}) { this.push(records, settings); }
  blob(content) { const sha = hash(content); this.blobs.set(sha, content); return sha; }
  tree(files) { const sha = 'tree-' + ++this.sequence; this.trees.set(sha, structuredClone(files)); return sha; }
  commit(tree, parent = this.head) { const sha = 'head-' + ++this.sequence; this.commits.set(sha, { tree, parent }); return sha; }
  push(records, settings = this.head ? this.settings() : {}) {
    const files = {}, digests = {};
    const previousIndex = this.head && this.trees.get(this.commits.get(this.head).tree)['archive/index.json'];
    const generation = previousIndex ? JSON.parse(this.blobs.get(previousIndex)).generation : '';
    for (const [year, rows] of Object.entries(partition(records))) { const path = `archive/${year}.json`, text = JSON.stringify(archive(rows), null, 2); files[path] = this.blob(text); digests[path] = hash(text); }
    files['archive/index.json'] = this.blob(JSON.stringify({ format: 'xingji-index', schemaVersion: 1, recordCount: records.length, generation, files: digests, settings: sharedSettings(settings) }));
    this.head = this.commit(this.tree(files)); return this.head;
  }
  ancestor(a, b) { while (b) { if (a === b) return true; b = this.commits.get(b)?.parent; } return false; }
  records() { const files = this.trees.get(this.commits.get(this.head).tree); return Object.entries(files).filter(([p]) => /^archive\/(\d{4}|unknown)\.json$/.test(p)).flatMap(([, sha]) => readArchive(JSON.parse(this.blobs.get(sha)))); }
  settings() { const files = this.trees.get(this.commits.get(this.head).tree); return sharedSettings(JSON.parse(this.blobs.get(files['archive/index.json'])).settings); }
  corrupt(path, content) { const files = { ...this.trees.get(this.commits.get(this.head).tree) }; if (content === null) delete files[path]; else files[path] = this.blob(content); this.head = this.commit(this.tree(files)); }
  fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.replace('/repos/user/data', ''), method = options.method || 'GET';
    this.calls.push({ path, method, body: options.body && JSON.parse(options.body), cache: options.cache });
    if (!this.available) throw new TypeError('Failed to fetch');
    const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    if (!this.authorized) return response({}, 401);
    const body = options.body ? JSON.parse(options.body) : null;
    if (!path) return response({ id: this.id, private: this.private, default_branch: 'main', permissions: { push: true } });
    if (path === '/git/ref/heads/main') return response({ object: { sha: this.head } });
    if (path.startsWith('/compare/')) { const [base, head] = path.slice(9).split('...'); return response({ status: base === head ? 'identical' : this.ancestor(base, head) ? 'ahead' : this.ancestor(head, base) ? 'behind' : 'diverged' }); }
    if (path.startsWith('/git/commits/')) { const c = this.commits.get(path.slice(13)); return c ? response({ tree: { sha: c.tree } }) : response({}, 404); }
    if (path.startsWith('/git/trees/')) { const files = this.trees.get(path.slice(11)); return response({ tree: Object.entries(files).map(([path, sha]) => ({ path, sha, type: 'blob' })) }); }
    if (path.startsWith('/git/blobs/')) { const text = this.blobs.get(path.slice(11)); return response({ encoding: 'base64', content: Buffer.from(text).toString('base64') }); }
    if (path === '/git/trees' && method === 'POST') { const files = body.base_tree ? { ...this.trees.get(body.base_tree) } : {}; for (const item of body.tree) { if (item.sha === null) delete files[item.path]; else files[item.path] = this.blob(item.content); } return response({ sha: this.tree(files) }); }
    if (path === '/git/commits' && method === 'POST') return response({ sha: this.commit(body.tree, body.parents[0]) });
    if (path === '/git/refs/heads/main' && method === 'PATCH') {
      if (body.force || !this.ancestor(this.head, body.sha)) return response({}, 422);
      this.head = body.sha;
      if (this.loseAcknowledgement) { this.loseAcknowledgement = false; throw new TypeError('Connection lost after commit'); }
      return response({ object: { sha: this.head } });
    }
    throw new Error('Unhandled GitHub request: ' + method + ' ' + path);
  };
}
export async function prepareCloud(records = [], settings = {}) {
  const server = new MemoryGitHub(records, settings);
  globalThis.fetch = server.fetch;
  await db.setMany([['records', records], ['base', structuredClone(records)], ['github', { owner: 'user', repo: 'data', branch: 'main', id: 77 }], ['syncMeta', { revision: 1, head: server.head, verified: true, pending: false }], ['lastSync', new Date().toISOString()], ['githubToken', 'test-key']]);
  await db.setMany([['settings', sharedSettings(settings)], ['settingsBase', sharedSettings(settings)]]);
  return server;
}
