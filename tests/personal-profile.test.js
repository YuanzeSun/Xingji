import test from 'node:test';
import assert from 'node:assert/strict';
import { personalProfile, profileDefaults, applyProfileDefaults } from '../src/personal-profile.js';
import { sharedSettings, mergeSettings } from '../src/shared-settings.js';
import { createRecord, archive, readArchive } from '../src/model.js';
import { personalProfilePanel, personalProfileSummary } from '../src/personal-profile-form.js';
import { JSDOM } from 'jsdom';

const profile = personalProfile({ chineseName:'示例旅客', firstName:'SAN', lastName:'ZHANG', gender:'男', documents:[{id:'id',type:'national-id',number:'000000200001011234'}, {id:'pass',type:'passport',number:'E00000000'}, {id:'permit',type:'hk-macau-permit',number:'H00000000'}] });

test('personal information is entirely optional and only the explicitly configured part is filled', () => {
  assert.deepEqual(sharedSettings({profile:{}}), {flightMcpKey:''});
  for (const type of ['rail','flight']) assert.ok(Object.values(profileDefaults(type)).every(value=>value===''));
  const chineseOnly = {chineseName:'示例旅客'};
  const rail = profileDefaults('rail',chineseOnly), flight = profileDefaults('flight',chineseOnly);
  assert.equal(rail.passenger,'示例旅客'); assert.equal(rail.identity,''); assert.equal(Object.hasOwn(rail,'gender'),false);
  assert.equal(flight.passenger,''); assert.equal(flight.identity,'');
  assert.equal(profileDefaults('rail',{firstName:'SAN',lastName:'ZHANG'}).passenger,'');
  assert.equal(profileDefaults('flight',{firstName:'SAN',lastName:'ZHANG'}).passenger,'ZHANG/SAN');
  const passportOnly = {documents:[{id:'passport',type:'passport',number:'E00000000'}]};
  assert.equal(profileDefaults('flight',passportOnly).identity,'E00000000');
  assert.equal(profileDefaults('flight',passportOnly).passenger,'');
  assert.equal(profileDefaults('rail',passportOnly).identity,'');
  for (const type of ['rail','flight']) {
    const values = profileDefaults(type,{gender:'男'});
    assert.deepEqual(values,{passenger:'',identity:''});
  }
});

test('document defaults are selected per transport type, with explicit overrides and opt-out', () => {
  assert.equal(profileDefaults('rail',profile).identity,'000000200001011234');
  assert.equal(profileDefaults('flight',profile).identity,'E00000000');
  assert.equal(profileDefaults('flight',profile).passenger,'ZHANG/SAN');
  assert.equal(profileDefaults('rail',{...profile,railDocument:'permit'}).identity,'H00000000');
  assert.equal(profileDefaults('flight',{...profile,flightDocument:'none'}).identity,'');
  assert.ok(Object.values(profileDefaults('rail',{...profile,autoFill:false})).every(value=>value===''));
  assert.equal(profileDefaults('rail',{documents:[{id:'partial',type:'national-id',expiry:'2030-01-01'}]}).identity,'');
});

test('type changes and profile updates respect per-ticket corrections and intentionally blank fields', () => {
  const record = createRecord(applyProfileDefaults({type:'rail'},profile)), before = structuredClone(profile);
  const flight = applyProfileDefaults({...record,type:'flight'},profile,{previousType:'rail'});
  assert.equal(flight.passenger,'ZHANG/SAN'); assert.equal(flight.identity,'E00000000');
  const corrected = applyProfileDefaults({...record,type:'flight',passenger:'单票姓名',identity:''},profile,{previousType:'rail',edited:['passenger','identity']});
  assert.equal(corrected.passenger,'单票姓名'); assert.equal(corrected.identity,''); assert.ok(!Object.hasOwn(corrected,'identityType'));
  const changed = applyProfileDefaults(record,{...profile,chineseName:'新的姓名'},{previousProfile:profile});
  assert.equal(changed.passenger,'新的姓名');
  assert.equal(applyProfileDefaults({...record,passenger:'单票姓名'},{...profile,chineseName:'新的姓名'},{previousProfile:profile,edited:['passenger']}).passenger,'单票姓名');
  assert.deepEqual(profile,before); assert.equal(record.type,'rail');
});

test('ticket defaults and backups contain only the saved name and document number', () => {
  const settings = sharedSettings({flightMcpKey:'private-key',profile});
  const record = createRecord(applyProfileDefaults({type:'rail'},settings.profile));
  for(const key of ['identityType','gender','nationality','address'])assert.equal(Object.hasOwn(record,key),false);
  assert.deepEqual(readArchive(archive([record])),[record]);
  assert.ok(!JSON.stringify(record).includes('private-key'));
});

test('profile validation rejects malformed values; display summaries mask document numbers', () => {
  for (const value of [{documents:[{id:'d',expiry:'2000-02-30'}]}, {documents:[{id:'d',expiry:'0000-01-01'}]}, {autoFill:'yes'}, {documents:[{id:'a',type:'unknown'}]}, {documents:[{id:'a',number:'1'},{id:'a',number:'2'}]}]) assert.throws(()=>personalProfile(value));
  const dom = new JSDOM(personalProfilePanel());
  assert.equal(dom.window.document.querySelectorAll('[required]').length,0);
  for (const input of dom.window.document.querySelectorAll('input:not([type=checkbox]),textarea')) assert.equal(input.value,'');
  assert.deepEqual([...dom.window.document.querySelector('select[name=gender]').options].map(option=>option.value),['','男','女']);
  assert.equal(dom.window.document.querySelector('[name=birthDate],[name=phone],[name=email],[name=address],[name=personalInfo],[name=englishName],[name=nationality],[data-doc-field=country]'),null);
  const summary = personalProfileSummary(profile);
  assert.match(summary,/000000\*{8}1234/); assert.ok(!summary.includes('000000200001011234'));
  dom.window.close();
});

test('profile and service key merge independently while competing profile edits require a checked choice', () => {
  const empty = sharedSettings(), mine = sharedSettings({profile}), other = sharedSettings({flightMcpKey:'remote-key'});
  const combined = mergeSettings(empty,mine,other);
  assert.equal(combined.conflicts.length,0); assert.deepEqual(combined.settings.profile,profile); assert.equal(combined.settings.flightMcpKey,'remote-key');
  const competing = mergeSettings(mine,{...mine,profile:{...profile,chineseName:'本机姓名'}},{...mine,profile:{...profile,chineseName:'另一台姓名'}});
  assert.equal(competing.conflicts[0].field,'profile');
  assert.equal(mergeSettings(mine,{},mine).settings.profile,undefined);
});

test('English name parts remain optional and the profile contains only the current fields', () => {
  assert.equal(profileDefaults('flight',{firstName:'SAN'}).passenger,'SAN');
  assert.equal(profileDefaults('flight',{lastName:'ZHANG'}).passenger,'ZHANG');
  assert.equal(profileDefaults('flight',{firstName:'SAN MING',lastName:'ZHANG'}).passenger,'ZHANG/SAN MING');
  const onlyKnown=personalProfile({chineseName:'示例旅客',unexpected:'unused',documents:[{id:'id',type:'passport',number:'E00000000',unexpected:'unused'}]});
  assert.equal(Object.hasOwn(onlyKnown,'unexpected'),false);assert.equal(Object.hasOwn(onlyKnown.documents[0],'unexpected'),false);
  assert.deepEqual(Object.keys(onlyKnown.documents[0]),['id','type','label','number','expiry']);
  assert.equal(personalProfile({gender:'constructor'}).gender,'');
});
