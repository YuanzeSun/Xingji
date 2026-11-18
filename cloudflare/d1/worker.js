const readState = 'SELECT id, head, generation, settings FROM archive_state WHERE singleton = 1';
const newHead = 'EXISTS (SELECT 1 FROM archive_state WHERE singleton = 1 AND head = ?)';
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const encoder = new TextEncoder();

async function authorized(header, secret) {
  if (!secret || !header?.startsWith('Bearer ') || header.length > 1024) return false;
  const [actual, expected] = await Promise.all([header.slice(7), secret].map(value => crypto.subtle.digest('SHA-256', encoder.encode(value))));
  const left = new Uint8Array(actual), right = new Uint8Array(expected);
  return left.reduce((difference, byte, index) => difference | (byte ^ right[index]), 0) === 0;
}

async function readArchive(db, tag, respond) {
  if (tag) {
    const state = await db.prepare(readState).first();
    if (state && tag === `"${state.id}:${state.head}"`) return respond(null, 304);
  }
  const [metadata, rows] = await db.batch([
    db.prepare(readState),
    db.prepare('SELECT payload FROM tickets ORDER BY id')
  ]);
  const { id, head, generation, settings } = metadata.results[0];
  return respond({ id, head, generation, settings: JSON.parse(settings), records: rows.results.map(row => JSON.parse(row.payload)) });
}

async function writeArchive(request, db, respond) {
  const input = await request.json().catch(() => null);
  if (!object(input) || !validId(input.id) || !validId(input.head) ||
      !Array.isArray(input.records) || !Array.isArray(input.removed) ||
      input.records.some(row => !object(row) || !validId(row.id) || !['rail', 'flight'].includes(row.type)) ||
      input.removed.some(id => !validId(id)) ||
      new Set([...input.records.map(row => row.id), ...input.removed]).size !== input.records.length + input.removed.length ||
      (input.settings !== undefined && !object(input.settings)) ||
      (input.replace !== undefined && typeof input.replace !== 'boolean') ||
      (input.replace && (!input.settings || input.removed.length))) {
    return respond({ error: '票库更新数据无效' }, 400);
  }

  const head = crypto.randomUUID(), generation = input.replace ? crypto.randomUUID() : null;
  const payloads = input.records.map(record => [record.id, JSON.stringify(record)]);
  const settings = input.settings === undefined ? null : JSON.stringify(input.settings);
  if (payloads.some(([, payload]) => payload.length > 600_000 && encoder.encode(payload).length >= 1_900_000) ||
      settings?.length > 100_000) return respond({ error: '票据或设置超过数据库大小限制' }, 413);

  // D1 executes every statement in the batch as a single transaction.
  const statements = [
    db.prepare('UPDATE archive_state SET head = ?, generation = COALESCE(?, generation), settings = COALESCE(?, settings) WHERE singleton = 1 AND id = ? AND head = ?')
      .bind(head, generation, settings, input.id, input.head)
  ];
  if (input.replace) statements.push(db.prepare(`DELETE FROM tickets WHERE ${newHead}`).bind(head));
  const remove = db.prepare(`DELETE FROM tickets WHERE id = ? AND ${newHead}`);
  for (const id of input.removed) statements.push(remove.bind(id, head));
  const put = db.prepare(`INSERT INTO tickets (id, payload) SELECT ?, ? WHERE ${newHead} ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`);
  for (const [id, payload] of payloads) statements.push(put.bind(id, payload, head));
  const [write] = await db.batch(statements);
  if (write.meta.changes !== 1) return respond({ error: 'D1 票库已变化，请重新核对' }, 409);
  return respond({ id: input.id, head, ...(generation ? { generation } : {}) });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim());
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin', 'Content-Type': 'application/json; charset=utf-8' };
    const respond = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers });
    if (origin && !allowed.includes(origin)) return respond({ error: '站点未获授权访问 D1' }, 403);
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    if (new URL(request.url).pathname !== '/v1/archive') return respond({ error: '接口不存在' }, 404);
    if (request.method === 'OPTIONS') {
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type, If-None-Match';
      headers['Access-Control-Max-Age'] = '600';
      return respond(null, 204);
    }
    if (!await authorized(request.headers.get('Authorization'), env.ARCHIVE_TOKEN)) return respond({ error: 'D1 访问凭证无效' }, 401);
    try {
      if (request.method === 'GET') return await readArchive(env.ARCHIVE, request.headers.get('If-None-Match'), respond);
      if (request.method === 'POST') return await writeArchive(request, env.ARCHIVE, respond);
      return respond({ error: '不支持此请求方式' }, 405);
    } catch (error) {
      if (/free tier|limit exceeded|daily row/i.test(error.message)) return respond({ error: 'D1 请求额度已用尽，请稍后再试' }, 429);
      return respond({ error: 'D1 数据库操作失败，请检查 Worker 绑定和数据库迁移' }, 503);
    }
  }
};
