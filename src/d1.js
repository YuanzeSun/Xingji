import { SCHEMA_VERSION, readArchive, validateRecord } from './model.js';
import { sameSettings, sharedSettings } from './shared-settings.js';
import { workerURL } from './cloud-connections.js';
export { workerURL };

export class D1Store {
  constructor(config, token, fetcher = fetch, { signal, cached } = {}) {
    this.config = config;
    this.token = token;
    this.fetcher = fetcher;
    this.signal = signal;
    this.cached = cached;
  }

  async request({ body, head } = {}) {
    const headers = { Authorization: `Bearer ${this.token}` };
    if (body) headers['Content-Type'] = 'application/json';
    if (head) headers['If-None-Match'] = `"${this.config.id}:${head}"`;
    const timeout = AbortSignal.timeout(30000);
    const response = await this.fetcher(workerURL(this.config.url) + '/v1/archive', {
      method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body), redirect: 'error', cache: 'no-store', credentials: 'omit',
      signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
    });
    if (response.status === 304 && head) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = { 401: 'D1 访问凭证无效，请重新授权', 409: '另一台设备刚更新了 D1 票库，请重新核对', 413: 'D1 票据或设置超过大小限制', 429: 'D1 免费额度已用尽，请稍后再试' };
      throw Object.assign(new Error(messages[response.status] || `D1 请求失败（${response.status}）`), { status: response.status });
    }
    if (typeof result.id !== 'string' || !/^[0-9a-f]{32}$/.test(result.id) || typeof result.head !== 'string' || !result.head) throw new Error('Worker 票库接口返回无效');
    if (this.config.id && this.config.id !== result.id) throw new Error('D1 数据库身份已变化，已保留本机缓存');
    return result;
  }

  async read() {
    const result = await this.request({ head: this.cached?.head });
    if (!result) return this.cached;
    return {
      id: result.id, head: result.head, generation: result.generation || '',
      records: readArchive({ format: 'xingji-archive', schemaVersion: SCHEMA_VERSION, records: result.records }),
      settings: sharedSettings(result.settings)
    };
  }

  async write(records, snapshot, settings) {
    const previous = new Map(snapshot.records.map(record => [record.id, JSON.stringify(record)]));
    const changed = records.filter(record => {
      const before = previous.get(record.id);
      previous.delete(record.id);
      return before !== JSON.stringify(record);
    });
    return (await this.request({ body: {
      id: snapshot.id, head: snapshot.head, records: changed.map(validateRecord), removed: [...previous.keys()],
      ...(sameSettings(settings, snapshot.settings) ? {} : { settings: sharedSettings(settings) })
    } })).head;
  }

  async replace(snapshot, records, settings) {
    const result = await this.request({ body: {
      id: snapshot.id, head: snapshot.head, records: records.map(validateRecord), removed: [], settings: sharedSettings(settings), replace: true
    } });
    return { ...result, records, settings };
  }
}
