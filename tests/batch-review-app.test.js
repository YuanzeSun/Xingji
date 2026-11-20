import test from 'node:test';
import assert from 'node:assert/strict';
import { archive, createRecord } from '../src/model.js';
import { prepareCloud } from './helpers/cloud.js';
import { browser, until } from './helpers/d1-app.js';

test('a batch saves selected complete tickets and discards everything left in the review', async () => {
  const window = browser();
  location.hash = 'import';
  const github = await prepareCloud();
  const fields = {
    departureDate: '2024-10-01', origin: '北京南', destination: '南京南',
    departureTime: '08:00', passenger: '测试旅客', identity: 'TEST123',
    carriage: '05', seat: '08F', seatClass: '二等座'
  };
  const records = [
    createRecord({ ...fields, id: 'ready', service: 'G21' }),
    createRecord({ ...fields, id: 'needs-seat', service: 'G33', seat: '' }),
    createRecord({ ...fields, id: 'unselected', service: 'G45' }),
    createRecord({ ...fields, id: 'discard-incomplete', service: 'G47', seat: '' })
  ];
  const row = index => document.querySelectorAll('.review-row')[index];
  const select = index => row(index).querySelector('input');
  const save = () => document.querySelector('[data-action="save-candidates"]');
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('#import-files'));
    const input = document.querySelector('#import-files'), json = JSON.stringify(archive(records));
    Object.defineProperty(input, 'files', { value: [{ name: 'tickets.json', size: json.length, text: async () => json }] });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => row(3));
    assert.equal(select(0).checked, true);
    assert.equal(select(1).disabled, true);
    assert.equal(select(3).disabled, true);
    assert.match(row(1).textContent, /缺少 座位 \/ 铺位/);
    select(2).click();
    row(1).querySelector('[data-action="edit-candidate"]').click();
    await until(() => document.querySelector('#editor-form'));
    const editor = document.querySelector('#editor-form');
    assert.match(editor.querySelector('[type="submit"]').textContent, /完成校对/);
    editor.elements.seat.value = '09F';
    editor.elements.seat.dispatchEvent(new window.Event('input', { bubbles: true }));
    editor.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => row(1) && !select(1).disabled);
    assert.deepEqual(github.records(), []);
    select(1).click();
    save().click();
    await until(() => !document.querySelector('dialog') && github.records().length === 2);
    assert.deepEqual(github.records().map(record => record.id).sort(), ['needs-seat', 'ready']);
    assert.equal(github.records().find(record => record.id === 'needs-seat').seat, '09F');
    document.querySelector('[data-page="import"]').click();
    await until(() => document.querySelector('#import-files'));
    assert.equal(document.querySelector('[data-action="review"]'), null);
    assert.equal(document.querySelector('#import-status').textContent, '');
  } finally { window.close(); }
});
