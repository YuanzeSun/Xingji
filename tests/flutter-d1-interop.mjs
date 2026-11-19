import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { D1Store } from '../src/d1.js';
import { GitHubStore } from '../src/github.js';
import { createRecord } from '../src/model.js';
import { pairedD1, pairedGitHub } from '../src/archive-migration.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { memoryD1, token } from './helpers/d1.js';

const train = (id, service) => createRecord({
  id, type: 'rail', template: 'rail-receipt', service, origin: '北京南', destination: '南京南',
  departureDate: '2026-11-01', departureTime: '15:00', passenger: '示例旅客'
});

async function fixture(t) {
  const cloud = memoryD1([train('from-d1', 'G21')], { flightMcpKey: 'd1-key' });
  const repo = new MemoryGitHub([train('from-github', 'G103')], { flightMcpKey: 'github-key' });
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const url = new URL(req.url, base), isD1 = url.pathname === '/v1/archive';
    requests.push({ pathname: url.pathname, method: req.method, tag: req.headers['if-none-match'] });
    try {
      const result = await (isD1 ? cloud.fetch(url, { method: req.method, headers: req.headers, body: body || undefined }) :
        repo.fetch('https://api.github.com' + url.pathname + url.search, { method: req.method, headers: req.headers, body: body || undefined }));
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(await result.text());
    } catch { res.destroy(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(() => { cloud.sqlite.close(); resolve(); })));
  const d1 = new D1Store({ url: base }, token);
  const github = new GitHubStore({ owner:'user', repo:'data', branch:'main', id:77 }, 'github-test', repo.fetch);
  async function dart(command) {
    const peer = spawn(process.env.DART || 'dart', ['run', 'test/support/d1_peer.dart', base], {
      cwd: new URL('../packages/xingji_core', import.meta.url), stdio: ['pipe','pipe','pipe']
    });
    let stdout = '', stderr = '';
    peer.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk);
    peer.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
    peer.stdin.end(JSON.stringify(command));
    const [exit] = await once(peer, 'close');
    assert.equal(exit, 0, stderr);
    return JSON.parse(stdout);
  }
  return { d1, github, requests, cloud, dart };
}

test('Dart and the web client see the same D1 records and settings; a D1 edit leaves GitHub alone', async t => {
  const { d1, github, requests, dart } = await fixture(t);
  const first = await d1.read();
  const result = await dart({ action:'edit', gate:'8A' });
  assert.equal(result.records[0].gate, '8A');
  assert.equal(result.settings.flightMcpKey, 'flutter-key');
  assert.equal(result.generation, first.generation);
  assert.ok(requests.some(entry => entry.method === 'GET' && entry.tag));
  assert.equal(requests.some(entry => entry.pathname.includes('/repos/')), false);
  const web = await d1.read();
  assert.deepEqual(web.records, result.records);
  assert.equal((await github.read()).records[0].service, 'G103');
});

test('both authority choices publish links readable by the website; only explicit backup copies later edits', async t => {
  for (const source of ['github', 'd1']) await t.test(source, async t => {
    const { d1, github, dart } = await fixture(t);
    const binding = await dart({ action:'bind', source });
    assert.equal(binding.error, undefined);
    const primary = await d1.read(), backup = await github.read();
    assert.equal(primary.settings.flightMcpKey, source + '-key');
    assert.deepEqual(primary.records, backup.records);
    assert.equal(pairedGitHub(primary, { id: primary.id, url: d1.config.url }).token, 'github-test');
    assert.equal(pairedD1(backup, github.config).token, token);
    const edited = await dart({ action:'edit', gate:'D18' });
    assert.equal(edited.error, undefined);
    assert.equal((await github.read()).records[0].gate, '');
    assert.equal((await dart({ action:'backup' })).error, undefined);
    assert.equal((await github.read()).records[0].gate, 'D18');
  });
});

test('a paired reset recognizes a lost Worker reply after restart and preserves each side’s settings', async t => {
  const { cloud, d1, github, dart } = await fixture(t);
  assert.equal((await dart({ action:'bind', source:'d1' })).error, undefined);
  assert.equal((await dart({ action:'edit', gate:'D18' })).error, undefined);
  cloud.loseAcknowledgement = true;
  const interrupted = await dart({ action:'reset' });
  assert.ok(interrupted.error);
  assert.ok(interrupted.journal.githubHead);
  const resumed = await dart({ action:'reset', journal:interrupted.journal });
  assert.equal(resumed.error, undefined);
  const primary = await d1.read(), git = await github.read();
  assert.deepEqual(primary.records, []);
  assert.deepEqual(git.records, []);
  assert.deepEqual(primary.settings, {flightMcpKey:'flutter-key', connections:{unlinked:true}});
  assert.deepEqual(git.settings, {flightMcpKey:'d1-key', connections:{unlinked:true}});
  assert.equal(primary.generation, interrupted.journal.id);
  assert.equal(git.generation, interrupted.journal.id);
});

test('a resumed reset preserves changes made after the lost reply', async t => {
  const { cloud, d1, dart } = await fixture(t);
  assert.equal((await dart({ action:'bind', source:'d1' })).error, undefined);
  cloud.loseAcknowledgement = true;
  const interrupted = await dart({ action:'reset' });
  assert.ok(interrupted.journal.githubHead);
  const reset = await d1.read();
  const added = train('after-reset', 'G37');
  await d1.write([added], reset, reset.settings);
  const resumed = await dart({ action:'reset', journal:interrupted.journal });
  assert.match(resumed.error, /D1 票库已有变化/);
  assert.equal((await d1.read()).records[0].id, added.id);
});
