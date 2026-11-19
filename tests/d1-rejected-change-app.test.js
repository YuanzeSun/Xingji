import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { fullBackup } from '../src/archive-backup.js';
import { readSyncState } from '../src/sync-state.js';
import { memoryD1 } from './helpers/d1.js';
import { browser, connect, until } from './helpers/d1-app.js';

test('a rejected D1 write survives reload, can be corrected, and can be withdrawn without a cloud write', async () => {
  let window = browser();
  const d1 = memoryD1([createRecord({ id: 'original', service: 'G21' })]);
  let rejected = 0;
  globalThis.fetch = async (url, options) => {
    if (options?.method === 'POST' && JSON.parse(options.body).records.some(record => record.id === 'new' && record.seat === '08F')) {
      rejected++;
      return new Response('{}', { status: 413, headers: { 'Content-Type': 'application/json' } });
    }
    return d1.fetch(url, options);
  };
  const click = selector => document.querySelector(selector).click();
  const rejectedNotice = () => document.querySelector('[data-action="discard-rejected-change"]');
  async function setSeat(seat) {
    click('[data-action="view"][data-id="new"]');
    await until(() => document.querySelector('[data-action="edit"]')?.disabled === false);
    click('[data-action="edit"]');
    await until(() => document.querySelector('#editor-form'));
    const form = document.querySelector('#editor-form');
    form.elements.seat.value = seat;
    form.elements.seat.dispatchEvent(new window.Event('input', { bubbles: true }));
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('dialog'));
  }
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('#d1-form'));
    connect(window, 'd1');
    await until(() => document.querySelector('[data-action="import-json"]')?.disabled === false);

    const ticket = createRecord({
      id: 'new', service: 'G22', origin: '北京南', destination: '南京南', departureDate: '2026-01-04',
      departureTime: '08:00', passenger: '测试旅客', identity: 'TEST1', carriage: '05', seat: '08F', seatClass: '二等座'
    });
    const json = JSON.stringify(fullBackup([ticket], {}, {}));
    const input = document.querySelector('#import-json-file');
    Object.defineProperty(input, 'files', { value: [{ name: 'backup.json', size: json.length, text: async () => json }] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => document.querySelector('[data-backup-restore]'));
    click('[data-backup-restore] [type=submit]');
    await until(() => rejectedNotice() && !document.querySelector('dialog'));
    assert.match(document.querySelector('#connection-state').textContent, /超过大小限制/);
    assert.equal((await readSyncState()).meta.pending, true);
    assert.equal(rejected, 1);

    window.close();
    window = browser();
    await import('../src/app.js?blocked-reload');
    await until(() => rejectedNotice()?.disabled === false);
    assert.equal(document.querySelector('[data-action="import-json"]').disabled, false);
    window.dispatchEvent(new window.Event('online'));
    document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(rejected, 1, 'reloading and reconnecting must not resend a definitively rejected payload');
    click('[data-page="archive"]');
    await until(() => document.querySelector('[data-action="view"][data-id="new"]'));
    await setSeat('09F');
    assert.equal(rejectedNotice(), null);
    assert.equal((await readSyncState()).meta.pending, false);
    assert.equal(JSON.parse(d1.sqlite.prepare('SELECT payload FROM tickets WHERE id = ?').get('new').payload).seat, '09F');

    await setSeat('08F');
    assert.ok(rejectedNotice());
    assert.equal(rejected, 2);
    const writes = d1.calls.filter(call => call.method === 'POST').length;
    globalThis.confirm = () => true;
    rejectedNotice().click();
    await until(() => document.querySelector('[data-action="new"]')?.disabled === false && !rejectedNotice());
    const current = await readSyncState();
    assert.equal(current.meta.pending, false);
    assert.ok(!current.meta.rejection);
    assert.equal(current.records.find(record => record.id === 'new').seat, '09F');
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, writes);
  } finally { window.close(); }
});
