import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { demoRecords } from '../src/demo.js';
import { createRecord, readArchive } from '../src/model.js';
import { GitHubStore, synchronize } from '../src/github.js';
import { createBoardingCode, readBoardingCode } from '../src/bcbp.js';
import { MemoryGitHub } from './helpers/cloud.js';

const script = await readFile(new URL('../apps/flutter/assets/renderer.js', import.meta.url), 'utf8');
const { XingjiTickets } = runInNewContext(script + '\n;({XingjiTickets})', { Intl: undefined });
const normalize = value => {
  const result = JSON.parse(XingjiTickets.normalizeArchive(JSON.stringify(value)));
  if (result.error) throw new Error(result.error);
  return result.records;
};
const sorted = records => Object.fromEntries(records.map(row => [row.id, row]));

async function fixture(t, records = [], settings = {}) {
  const storage = new MemoryGitHub(records, settings);
  const web = new GitHubStore({ owner: 'user', repo: 'data', branch: 'main', id: 77 }, 'web-test', storage.fetch);
  let beforeFlutterPublish = null;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    try {
      if (req.url === '/normalize') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(normalize(JSON.parse(body))));
        return;
      }
      if (req.method === 'PATCH' && beforeFlutterPublish) {
        const publish = beforeFlutterPublish;
        beforeFlutterPublish = null;
        await publish();
      }
      const response = await storage.fetch('http://127.0.0.1' + req.url, { method: req.method, body });
      res.writeHead(response.status, { 'Content-Type': 'application/json' }).end(await response.text());
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error.message }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const command = input => new Promise((resolve, reject) => {
    const peer = spawn(process.env.DART || 'dart', ['run', 'test/support/github_peer.dart', 'http://127.0.0.1:' + server.address().port], {
      cwd: new URL('../packages/xingji_core/', import.meta.url),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = [], diagnostics = [];
    peer.stdout.on('data', data => output.push(data));
    peer.stderr.on('data', data => diagnostics.push(data));
    peer.on('error', reject);
    peer.on('close', code => {
      if (code !== 0) { reject(new Error(Buffer.concat(diagnostics).toString())); return; }
      try { resolve(JSON.parse(Buffer.concat(output).toString())); }
      catch (failure) { reject(failure); }
    });
    peer.stdin.end(JSON.stringify(input));
  });
  return { web, storage, command, beforeFlutterPublish(action) { beforeFlutterPublish = action; } };
}

test('the same GitHub snapshots round-trip across production clients and the Flutter validation bundle', async t => {
  const { web, command, beforeFlutterPublish } = await fixture(t);
  const examples = demoRecords('2026-11-18');
  const specialDate = { year: null, dayOfYear: 319 };
  const boarding = createBoardingCode({
    passenger:'SAMPLE/USER',pnr:'TST404',origin:'PEK',destination:'HND',carrier:'CA',
    flightNumber:'181',date:specialDate,cabin:'Y',seat:'12A',sequence:'123',status:'1',
  },'Aztec');
  const flight = createRecord({
    id:'aztec-fixture',type:'flight',template:'air-boarding-pass',passenger:'SAMPLE/USER',
    origin:'PEK',destination:'HND',service:'CA181',seatClass:'Y',seat:'12A',
    departureDate:specialDate,actualArrivalDate:'2026-11-15',actualArrivalTime:'18:21',
    pnr:'TST404',boardingCode:boarding,boardingCodeSource:'generated',boardingLegIndex:'0',
    checkedBaggageCount:'2',baggageTagNumbers:'0000000000',fieldSources:{actualArrivalTime:'variflight'},
  });
  const yearOnly = createRecord({id:'only-year',departureDate:{year:2024,dayOfYear:null}});
  const deleted = createRecord({id:'removed',deleted:true});
  const settings = {
    flightMcpKey:'synthetic-credential',
    profile:{chineseName:'示例旅客',lastName:'SAMPLE',firstName:'USER',documents:[
      {id:'passport',type:'passport',number:'EXAMPLE',expiry:'2033-09-30'},
    ],flightDocument:'passport'},
  };
  const before = await web.read();
  await web.write([...examples,flight,yearOnly,deleted], before, settings);
  const webSnapshot = await web.read(), flutter = await command({});
  assert.deepEqual(sorted(flutter.records), sorted(webSnapshot.records));
  assert.deepEqual(flutter.settings, webSnapshot.settings);
  assert.deepEqual(flutter.records.find(row=>row.id === flight.id).boardingCode, boarding);

  const added = {
    id:'flutter-added',type:'flight',origin:'西宁',originCode:'XNN',destination:'PEK',
    seatClass:'Y',aircraft:'波音737-800',service:'CA123',departureDate:{year:2025,dayOfYear:null},
  };
  const modified = await command({edit:{[flight.id]:{gate:'A12'}},add:added});
  const readByWeb = await web.read();
  assert.deepEqual(sorted(modified.records),sorted(readByWeb.records));
  assert.deepEqual(modified.settings,webSnapshot.settings);
  assert.equal(readByWeb.records.find(row=>row.id===added.id).aircraft,'737-800');
  assert.equal(readByWeb.records.find(row=>row.id===flight.id).gate,'A12');
  assert.deepEqual(readByWeb.records.find(row=>row.id===flight.id).boardingCode,boarding);
  const files = new Set([...Object.keys(webSnapshot.contents),'archive/2025.json']);
  assert.deepEqual(Object.keys(readByWeb.contents).sort(), [...files].sort());

  await assert.rejects(command({edit:{[flight.id]:{checkedBaggageCount:'2998'}}}), /托运行李件数/);
  assert.equal((await web.read()).head,readByWeb.head);
  beforeFlutterPublish(() => synchronize(
    web,readByWeb.records,readByWeb.records.map(row => row.id === flight.id ? {...row,pnr:'NEW123'} : row),
    {},{baseHead:readByWeb.head,baseGeneration:readByWeb.generation,baseSettings:readByWeb.settings,localSettings:readByWeb.settings},
  ));
  const concurrent = await command({edit:{[flight.id]:{seat:'14A'}}});
  const saved = concurrent.records.find(row => row.id === flight.id);
  const decoded = readBoardingCode(saved.boardingCode);
  assert.equal(saved.seat,'14A');
  assert.equal(saved.pnr,'NEW123');
  assert.equal(decoded.seat,'14A');
  assert.equal(decoded.pnr,'NEW123');
  assert.equal(decoded.format,'Aztec');
  const reset = await web.resetRepository(concurrent.head);
  const afterReset = await command({});
  assert.deepEqual(afterReset.records,[]);
  assert.equal(afterReset.generation,reset.generation);
  assert.deepEqual(afterReset.settings,webSnapshot.settings);
});

test('a web commit racing a Flutter commit preserves independent changes and exposes same-field conflicts', async t => {
  const base = createRecord({
    id:'race-ticket',service:'G21',origin:'北京南',destination:'南京南',
    departureDate:'2026-11-17',passenger:'示例旅客',seat:'08F',price:'500',
  });
  const { web, storage, command, beforeFlutterPublish } = await fixture(t,[base]);
  async function race(remoteEdit, flutterEdit) {
    const snapshot = await web.read();
    beforeFlutterPublish(() => synchronize(
      web,snapshot.records,snapshot.records.map(row => ({...row,...remoteEdit})),
      {},{baseHead:snapshot.head,baseGeneration:snapshot.generation,baseSettings:snapshot.settings,localSettings:snapshot.settings},
    ));
    return command({edit:{[base.id]:flutterEdit}});
  }
  const merged = await race({price:'550'},{gate:'16A'});
  assert.equal(merged.records[0].price,'550');
  assert.equal(merged.records[0].gate,'16A');
  assert.ok(storage.calls.filter(call=>call.method==='PATCH').length >= 3);
  const conflict = await race({seat:'08A'},{seat:'09F'});
  assert.deepEqual(conflict.conflicts,[{id:base.id,field:'seat',local:'09F',remote:'08A'}]);
  assert.equal((await web.read()).records[0].seat,'08A');
  assert.equal((await command({})).records[0].seat,'08A');
});

test('the Flutter bundle validates records with the website rules even without Intl', () => {
  const archive = {format:'xingji-archive',schemaVersion:2,records:demoRecords('2026-11-18')};
  assert.deepEqual(normalize(archive),readArchive(archive));
  archive.records[0] = {...archive.records[0],departureZone:'Asia/Not-A-Zone'};
  assert.throws(() => normalize(archive),/时区/);
});
