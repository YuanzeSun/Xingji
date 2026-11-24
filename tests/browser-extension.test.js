import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportsDesktopMcp } from '../src/device.js';
import { isBrowserConnectorInstalled } from '../src/browser-connector.js';

test('the shared extension exposes the 12306 reader and scopes flight header changes to the Xingji origin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extensions/xingji-connector/manifest.json', import.meta.url), 'utf8'));
  const rules = JSON.parse(await readFile(new URL('../extensions/xingji-connector/rules.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.background, { service_worker: 'background.js', type: 'module' });
  assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions, ['scripting', 'declarativeNetRequestWithHostAccess']);
  assert.deepEqual(manifest.host_permissions, ['https://cx.12306.cn/*', 'https://yuanzesun.github.io/*', 'https://c-gw.variflight.com/*']);
  assert.deepEqual(manifest.externally_connectable.matches, ['https://yuanzesun.github.io/Xingji/*']);
  assert.deepEqual(manifest.declarative_net_request.rule_resources, [{ id: 'flight_session', enabled: true, path: 'rules.json' }]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].condition.urlFilter, '|https://c-gw.variflight.com/chat_message/mcp/api|');
  assert.deepEqual(rules[0].condition.initiatorDomains, ['yuanzesun.github.io']);
  assert.deepEqual(rules[0].condition.requestMethods, ['post', 'options']);
  assert.equal(rules[0].action.type, 'modifyHeaders'); assert.equal(rules[0].action.requestHeaders, undefined);
  assert.ok(rules[0].action.responseHeaders.some(header => header.header === 'Access-Control-Expose-Headers' && header.operation === 'append' && header.value === 'Mcp-Session-Id'));
});

test('MCP is available on desktop browsers and hidden on Android, iPhone and iPad', () => {
  assert.equal(supportsDesktopMcp({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/142', platform: 'Win32', maxTouchPoints: 10 }), true);
  assert.equal(supportsDesktopMcp({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/142', platform: 'MacIntel', maxTouchPoints: 0 }), true);
  for (const userAgent of ['Mozilla/5.0 (Linux; Android 15)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18)', 'Mozilla/5.0 (iPad; CPU OS 18)']) assert.equal(supportsDesktopMcp({ userAgent }), false);
  assert.equal(supportsDesktopMcp({ userAgent: 'Mozilla/5.0 (Macintosh) Safari', platform: 'MacIntel', maxTouchPoints: 5 }), false);
});

test('connector status requires an acknowledgement from the installed worker', async t => {
  let listener;
  globalThis.chrome = { runtime: { onMessageExternal: { addListener: handler => { listener = handler; } } } };
  t.after(() => { delete globalThis.chrome; });
  await import('../extensions/xingji-connector/background.js');

  const runtime = sender => ({ sendMessage(_id, message, callback) {
    let response;
    listener(message, sender, value => { response = value; });
    callback(response);
  } });
  const app = { frameId: 0, url: 'https://yuanzesun.github.io/Xingji/#data' };
  assert.equal(await isBrowserConnectorInstalled(runtime(app)), true);
  assert.equal(await isBrowserConnectorInstalled(runtime({ ...app, frameId: 1 })), false);
  assert.equal(await isBrowserConnectorInstalled(runtime({ ...app, url: 'https://yuanzesun.github.io/other/' })), false);
  assert.equal(await isBrowserConnectorInstalled({}), false);
  assert.equal(await isBrowserConnectorInstalled({ sendMessage() { throw new Error('Context invalidated'); } }), false);
});
