import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../../cloudflare/d1/worker.js';

export const endpoint = 'https://archive.example.workers.dev';
export const token = 'test-worker-credential';

export function memoryD1(records = [], settings = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../cloudflare/d1/migrations/0001_archive.sql', import.meta.url), 'utf8'));
  const put = sqlite.prepare('INSERT INTO tickets VALUES (?, ?)');
  for (const record of records) put.run(record.id, JSON.stringify(record));
  sqlite.prepare('UPDATE archive_state SET settings = ?').run(JSON.stringify(settings));
  const ARCHIVE = {
    prepare(sql) {
      const prepared = sqlite.prepare(sql);
      const bind = (...values) => ({
        first: async () => prepared.get(...values),
        execute: () => sql.startsWith('SELECT') ? { results: prepared.all(...values) } : { meta: prepared.run(...values) }
      });
      return { ...bind(), bind };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const calls = [];
  return {
    calls, sqlite, available: true,
    async fetch(url, options) {
      calls.push({ url, method: options?.method || 'GET', body: options?.body && JSON.parse(options.body) });
      if (!this.available) throw new TypeError('Network error');
      return worker.fetch(new Request(url, options), { ARCHIVE, ARCHIVE_TOKEN: token, ALLOWED_ORIGINS: 'http://localhost,https://yuanzesun.github.io' });
    }
  };
}
