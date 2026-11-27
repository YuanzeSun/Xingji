import { SCHEMA_VERSION, readArchive, validateRecord } from './model.js';
import { sameSettings, sharedSettings } from './shared-settings.js';
import { workerURL } from './cloud-connections.js';
export { workerURL };

function databaseError(code, action) {
  switch (code) {
    case 'D1_BINDING_MISSING': return 'Worker 缺少 ARCHIVE 绑定。请在 Bindings 添加 D1 database，变量名填 ARCHIVE。';
    case 'D1_DATABASE_NOT_FOUND': return 'Worker 找不到绑定的 D1 数据库。请在 Bindings 核对 ARCHIVE 指向的数据库。';
    case 'D1_SCHEMA_MISSING': return 'D1 票库表或初始化记录缺失。请在 ARCHIVE 所指数据库的 Console 执行行迹的初始化 SQL。';
    default: return action + ' D1 票库失败（503）。请重试或查看 Worker 日志。';
  }
}

export class D1Store {
  constructor(config, token, fetcher = fetch, { signal, cached } = {}) {
    this.config = config;
    this.token = token;
    this.fetcher = fetcher.bind(globalThis);
    this.signal = signal;
    this.cached = cached;
  }

  async request({ body, head, after = '', match } = {}) {
    const headers = { Authorization: `Bearer ${this.token}` };
    if (body) headers['Content-Type'] = 'application/json';
    if (head) headers['If-None-Match'] = `"${this.config.id}:${head}"`;
    if (match) headers['If-Match'] = match;
    const timeout = AbortSignal.timeout(30000);
    const url = workerURL(this.config.url) + '/v1/archive' + (body ? '' : `?${new URLSearchParams({ after })}`);
    const response = await this.fetcher(url, {
      method: body ? 'POST' : 'GET', headers, body: body && JSON.stringify(body), redirect: 'error', cache: 'no-store', credentials: 'omit',
      signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout
    });
    if (response.status === 304 && head) return null;
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = { 400: 'D1 拒绝了这次票库更新，请核对提交的票据和设置', 401: 'D1 访问凭证无效，请重新授权', 409: '另一台设备刚更新了 D1 票库，请重新核对', 413: 'D1 票据或设置超过大小限制', 429: 'D1 免费额度已用尽，请稍后再试' };
      const message = response.status === 503 ? databaseError(result?.code, body ? '写入' : '读取') : messages[response.status];
      throw Object.assign(new Error(message || `D1 请求失败（${response.status}）`), { status: response.status, writeRejected: !!body && [400, 413].includes(response.status) });
    }
    if (typeof result.id !== 'string' || !/^[0-9a-f]{32}$/.test(result.id) || typeof result.head !== 'string' || !result.head) throw new Error('Worker 票库接口返回无效');
    if (this.config.id && this.config.id !== result.id) throw new Error('D1 数据库身份已变化，已保留本机缓存');
    return result;
  }

  async read() {
    const result = await this.readRaw(this.cached?.head);
    return result ? {
      ...result, records: readArchive({ format: 'xingji-archive', schemaVersion: SCHEMA_VERSION, records: result.records })
    } : this.cached;
  }

  async readRaw(head) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.#readSnapshot(head); }
      catch (error) {
        if (error.status !== 409) throw error;
        if (attempt >= 2) throw new Error('D1 票库持续更新，请稍后重试', { cause: error });
      }
    }
  }

  async #readSnapshot(cachedHead) {
    const first = await this.request({ head: cachedHead });
    if (!first) return null;
    if (typeof first.generation !== 'string' || !Object.hasOwn(first, 'settings') || !Array.isArray(first.records)) {
      throw new Error('Worker 票库接口返回无效');
    }
    const { id, head, generation, settings } = first;
    const records = [...first.records];
    const match = `"${id}:${head}"`;
    let page = first, after = '';
    while (page.next != null) {
      const cursor = page.next;
      if (typeof cursor !== 'string' || cursor <= after || cursor !== page.records.at(-1)?.id) {
        throw new Error('Worker 票库分页游标无效');
      }
      after = cursor;
      page = await this.request({ after, match });
      if (page.id !== id) throw new Error('D1 数据库身份已变化，已保留本机缓存');
      if (page.head !== head || page.generation !== generation) {
        throw Object.assign(new Error('D1 票库已变化，请重新读取'), { status: 409 });
      }
      const firstId = Array.isArray(page.records) && page.records[0]?.id;
      if (typeof firstId !== 'string' || firstId <= after || !Object.hasOwn(page, 'next')) {
        throw new Error('Worker 票库分页内容无效');
      }
      records.push(...page.records);
    }
    return { id, head, generation, records, settings: sharedSettings(settings) };
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

  async replace(snapshot, records, settings, { resetId } = {}) {
    const result = await this.request({ body: {
      id: snapshot.id, head: snapshot.head, records: records.map(validateRecord), removed: [], settings: sharedSettings(settings), replace: true,
      ...(resetId ? { resetId } : {})
    } });
    return { ...result, records, settings };
  }
}
