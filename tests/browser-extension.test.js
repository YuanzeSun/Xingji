import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { supportsDesktopMcp } from '../src/device.js';

test('the extension has no scripts and changes only the flight endpoint response for the app origin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extensions/xingji-variflight/manifest.json', import.meta.url), 'utf8'));
  const rules = JSON.parse(await readFile(new URL('../extensions/xingji-variflight/rules.json', import.meta.url), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background, undefined); assert.equal(manifest.content_scripts, undefined);
  assert.deepEqual(manifest.permissions, ['declarativeNetRequestWithHostAccess']);
  assert.deepEqual(manifest.host_permissions, ['https://yuanzesun.github.io/*', 'https://c-gw.variflight.com/*']);
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
