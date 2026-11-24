import test from 'node:test';
import assert from 'node:assert/strict';
import { personalProfile, profileDefaults, applyProfileDefaults, lockMatchedIdentity, matchProfileIdentity } from '../src/personal-profile.js';
import { printedIdentityHint } from '../src/identity.js';
import { ticketFieldLocked } from '../src/barcode-fields.js';
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
  assert.deepEqual(rail,{passenger:'示例旅客'});
  assert.deepEqual(flight,{passenger:''});
  assert.equal(profileDefaults('rail',{firstName:'SAN',lastName:'ZHANG'}).passenger,'');
  assert.equal(profileDefaults('flight',{firstName:'SAN',lastName:'ZHANG'}).passenger,'ZHANG/SAN');
  const passportOnly = {documents:[{id:'passport',type:'passport',number:'E00000000'}]};
  assert.deepEqual(profileDefaults('flight',passportOnly),{passenger:''});
  assert.deepEqual(profileDefaults('rail',passportOnly),{passenger:''});
  for (const type of ['rail','flight']) {
    const values = profileDefaults(type,{gender:'男'});
    assert.deepEqual(values,{passenger:''});
  }
});

test('a complete or masked ticket number locks only a unique matching document', () => {
  assert.equal(matchProfileIdentity('ｅ００００００００', profile),'E00000000');
  const hint = printedIdentityHint('票价 41.00\n0000002000XXXX1234 示例旅客');
  assert.equal(hint, '0000002000****1234');
  assert.equal(printedIdentityHint('证件号码：e000000＊＊'), 'e000000**');
  assert.equal(matchProfileIdentity('0000002000••••1234', profile),'000000200001011234');
  assert.equal(matchProfileIdentity('E000000＊＊', {...profile,autoFill:false}),'E00000000');
  for (const unmatched of ['', 'E12345678', '*********', 'E0000**', '000000200001011235']) assert.equal(matchProfileIdentity(unmatched,profile),'');
  const ambiguous = {...profile,documents:[...profile.documents,{type:'passport',number:'E00000001'}]};
  assert.equal(matchProfileIdentity('E000000**', ambiguous),'');
  assert.equal(matchProfileIdentity('E00000001', ambiguous),'E00000001');
  assert.equal(matchProfileIdentity('E00000000', {...ambiguous,documents:[...ambiguous.documents,{type:'other',number:'E00000000'}]}),'');
  const record = createRecord();
  lockMatchedIdentity(record, matchProfileIdentity(hint, profile));
  const [stored] = readArchive(archive([record]));
  assert.equal(stored.identity, '000000200001011234');
  assert.equal(stored.fieldSources.identity, 'profile-match');
  assert.ok(ticketFieldLocked(stored, 'identity'));
  assert.ok(!JSON.stringify(stored).includes(hint));
});

test('type changes and profile updates respect per-ticket corrections and intentionally blank fields', () => {
  const record = createRecord(applyProfileDefaults({type:'rail'},profile)), before = structuredClone(profile);
  const flight = applyProfileDefaults({...record,type:'flight'},profile,{previousType:'rail'});
  assert.equal(flight.passenger,'ZHANG/SAN'); assert.equal(flight.identity,'');
  const corrected = applyProfileDefaults({...record,type:'flight',passenger:'单票姓名',identity:''},profile,{previousType:'rail',edited:['passenger','identity']});
  assert.equal(corrected.passenger,'单票姓名'); assert.equal(corrected.identity,''); assert.ok(!Object.hasOwn(corrected,'identityType'));
  const changed = applyProfileDefaults(record,{...profile,chineseName:'新的姓名'},{previousProfile:profile});
  assert.equal(changed.passenger,'新的姓名');
  assert.equal(applyProfileDefaults({...record,passenger:'单票姓名'},{...profile,chineseName:'新的姓名'},{previousProfile:profile,edited:['passenger']}).passenger,'单票姓名');
  assert.deepEqual(profile,before); assert.equal(record.type,'rail');
});

test('ticket defaults and backups prefill the saved name without choosing a document', () => {
  const settings = sharedSettings({flightMcpKey:'private-key',profile});
  const record = createRecord(applyProfileDefaults({type:'rail'},settings.profile));
  for(const key of ['identityType','gender','nationality','address'])assert.equal(Object.hasOwn(record,key),false);
  assert.equal(record.identity, '');
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
  assert.match(summary,/0000002000\*{4}1234/); assert.ok(!summary.includes('000000200001011234'));
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
