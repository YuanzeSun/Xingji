import test from 'node:test';
import assert from 'node:assert/strict';
import { archive, createRecord } from '../src/model.js';
import { prepareCloud } from './helpers/cloud.js';
import { browser, until } from './helpers/d1-app.js';

test('file and text imports accept one ticket per review and reject multiple tickets', async () => {
  const window = browser();
  location.hash = 'import';
  const github = await prepareCloud();
  const fields = {
    departureDate: '2024-10-01', origin: '北京南', destination: '南京南',
    departureTime: '08:00', passenger: '测试旅客', identity: 'TEST123',
    carriage: '05', seatClass: '二等座'
  };
  const first = createRecord({ ...fields, id: 'one', service: 'G21' });
  const second = createRecord({ ...fields, id: 'two', service: 'G33' });
  const file = (...records) => {
    const json = JSON.stringify(archive(records));
    return { name: 'tickets.json', size: json.length, text: async () => json };
  };
  const input = () => document.querySelector('#import-files');
  const status = () => document.querySelector('#import-status').textContent;
  const pick = (...files) => {
    Object.defineProperty(input(), 'files', { value: files, configurable: true });
    input().dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  try {
    await import('../src/app.js');
    await until(input);
    assert.equal(input().multiple, false);

    const drop = new window.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file(first), file(second)] } });
    document.querySelector('#dropzone').dispatchEvent(drop);
    assert.match(status(), /一个文件/);
    assert.equal(document.querySelector('dialog'), null);

    pick(file(first, second));
    await until(() => status().includes('多张票据'));
    assert.equal(document.querySelector('dialog'), null);

    const text = document.querySelector('#import-text');
    text.value = '车次：G21\n出发站：北京南\n到达站：南京南\n日期：2024-10-01\n\n车次：G33\n出发站：南京南\n到达站：上海虹桥\n日期：2024-10-02';
    document.querySelector('[data-action="parse-text"]').click();
    await until(() => document.querySelector('#toast-root').textContent.includes('多张票据'));
    assert.ok(text.value);
    assert.equal(document.querySelector('dialog'), null);
    assert.deepEqual(github.records(), []);

    pick(file(first));
    await until(() => document.querySelector('#editor-form'));
    const editor = document.querySelector('#editor-form');
    assert.match(editor.querySelector('[type="submit"]').textContent, /保存票据/);
    editor.elements.seat.value = '09F';
    editor.elements.seat.dispatchEvent(new window.Event('input', { bubbles: true }));
    editor.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => !document.querySelector('dialog') && github.records().length === 1);
    assert.equal(github.records()[0].id, 'one');
    assert.equal(github.records()[0].seat, '09F');
  } finally { window.close(); }
});
