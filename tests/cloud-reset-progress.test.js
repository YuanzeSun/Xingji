import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareArchiveReset, createPairedReset, continuePairedReset } from '../src/archive-reset.js';
import { GitHubStore } from '../src/github.js';
import { D1Store } from '../src/d1.js';
import { createRecord } from '../src/model.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { memoryD1, endpoint, token } from './helpers/d1.js';

test('reset recovery recognizes a GitHub commit before the checkpoint and stops for newer D1 data', async () => {
  const rows = [createRecord({ id: 'old-ticket' })];
  const github = new MemoryGitHub(rows, { flightMcpKey: 'one' });
  const d1 = memoryD1(rows, { flightMcpKey: 'two' });
  const ghStore = new GitHubStore({ id: 77, owner: 'user', repo: 'data', branch: 'main' }, 'fixture', github.fetch);
  const d1Store = new D1Store({ url: endpoint, id: d1.sqlite.prepare('SELECT id FROM archive_state').get().id }, token, d1.fetch.bind(d1));
  const request = await prepareArchiveReset(ghStore, d1Store, {});
  let progress = await createPairedReset(request, { config: ghStore.config, d1: d1Store.config }, false);
  await assert.rejects(continuePairedReset(ghStore, d1Store, progress, async () => {
    throw new Error('Browser closed before saving the GitHub checkpoint');
  }), /Browser closed/);
  const gitHead = github.head;
  assert.deepEqual(github.records(), []);
  assert.equal(progress.step, 'github');
  const remote = await d1Store.read();
  await d1Store.write([...remote.records, createRecord({ id: 'new-ticket' })], remote, remote.settings);
  const writes = d1.calls.filter(call => call.method === 'POST').length;
  await assert.rejects(continuePairedReset(ghStore, d1Store, progress, async update => { progress = update; }), /D1 票库已有变化/);
  assert.equal(github.head, gitHead);
  assert.equal(d1.calls.filter(call => call.method === 'POST').length, writes);
  assert.deepEqual((await d1Store.read()).records.map(record => record.id).sort(), ['new-ticket', 'old-ticket']);
  github.push([createRecord({ id: 'new-backup-ticket' })]);
  const newGithubHead = github.head;
  await assert.rejects(continuePairedReset(ghStore, d1Store, progress, async update => { progress = update; }), /GitHub 仓库已有变化/);
  assert.equal(github.head, newGithubHead);
  assert.equal(d1.calls.filter(call => call.method === 'POST').length, writes);
});

test('resume rejects another device’s identical reset and any write after this reset', async () => {
  for (const concurrentReset of [true, false]) {
    const rows = [createRecord({ id: 'ticket' })];
    const github = new MemoryGitHub(rows);
    const db = memoryD1(rows);
    const gh = new GitHubStore({ id: 77, owner: 'user', repo: 'data', branch: 'main' }, 'fixture', github.fetch);
    const d1 = new D1Store({ url: endpoint, id: db.sqlite.prepare('SELECT id FROM archive_state').get().id }, token, db.fetch.bind(db));
    const request = await prepareArchiveReset(gh, d1, {});
    let progress = await createPairedReset(request, { config: gh.config, d1: d1.config }, false);
    const save = async update => { progress = update; };
    db.sqlite.exec("CREATE TRIGGER block_reset BEFORE DELETE ON tickets BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    await assert.rejects(continuePairedReset(gh, d1, progress, save), /503/);
    assert.equal(progress.step, 'd1');
    db.sqlite.exec('DROP TRIGGER block_reset');
    const changed = await d1.replace(request.d1Snapshot, [], request.d1Snapshot.settings,
      { resetId: concurrentReset ? crypto.randomUUID() : progress.id });
    if (!concurrentReset) await d1.write([], changed, changed.settings);
    const writes = db.calls.filter(call => call.method === 'POST').length;
    await assert.rejects(continuePairedReset(gh, d1, progress, save), /D1 票库已有变化/);
    assert.equal(progress.step, 'd1');
    assert.equal(db.calls.filter(call => call.method === 'POST').length, writes);
    db.sqlite.close();
  }
});
