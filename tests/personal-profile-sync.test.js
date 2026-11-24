import test from 'node:test';
import assert from 'node:assert/strict';
import { personalProfile, applyProfileDefaults } from '../src/personal-profile.js';
import { createRecord } from '../src/model.js';
import { sharedSettings } from '../src/shared-settings.js';
import { GitHubStore, synchronize } from '../src/github.js';
import { MemoryGitHub } from './helpers/cloud.js';
const config={owner:'user',repo:'data',id:77,branch:'main'};
const profile=personalProfile({chineseName:'示例旅客',documents:[{id:'id',type:'national-id',number:'000000200001011234'}]});
const store=server=>new GitHubStore({...config},'test-key',server.fetch);

test('a saved partial profile reaches another device and concurrent service key changes retain it',async()=>{
 const server=new MemoryGitHub([]),head=server.head;
 const uploaded=await synchronize(store(server),[],[],{},{baseHead:head,baseSettings:{},localSettings:{profile}});
 assert.equal(uploaded.conflicts.length,0);
 const other=await synchronize(store(server),[],[],{},{baseHead:head,baseSettings:{},localSettings:{flightMcpKey:'another-key'}});
 assert.equal(other.conflicts.length,0);assert.deepEqual(other.settings.profile,profile);
 assert.equal(server.settings().flightMcpKey,'another-key');
 const received=await store(server).read();
 const r=createRecord(applyProfileDefaults({type:'rail'},received.settings.profile));
 assert.equal(r.passenger,'示例旅客');assert.equal(r.identity,'');assert.equal(received.settings.profile.documents[0].number,'000000200001011234');
 assert.equal(createRecord(applyProfileDefaults({type:'flight',template:'air-boarding-pass'},received.settings.profile)).passenger,'');
});

test('competing profile edits never silently overwrite, and confirmed resolution is checked against current values',async()=>{
 const base=sharedSettings({profile}),server=new MemoryGitHub([],base),head=server.head;
 const local=sharedSettings({profile:{...profile,chineseName:'本机姓名'}});
 server.push([],{profile:{...profile,chineseName:'另一台姓名'}});
 const options={baseHead:head,baseSettings:base,localSettings:local};
 const first=await synchronize(store(server),[],[],{},options),c=first.conflicts[0];
 assert.equal(c.field,'profile');
 server.push([],{profile:{...profile,chineseName:'更新后的姓名'}});
 const stale={'settings:profile':{choice:'local',local:c.local,remote:c.remote}};
 assert.equal((await synchronize(store(server),[],[],stale,options)).conflicts.length,1);
 const latest=(await synchronize(store(server),[],[],{},options)).conflicts[0];
 const accepted=await synchronize(store(server),[],[],{'settings:profile':{choice:'remote',local:latest.local,remote:latest.remote}},options);
 assert.equal(accepted.conflicts.length,0);assert.equal(accepted.settings.profile.chineseName,'更新后的姓名');
});
