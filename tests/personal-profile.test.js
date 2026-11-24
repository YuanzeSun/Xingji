import test from 'node:test';
import assert from 'node:assert/strict';
import { personalProfile, profilePassengerName, applyProfileDefaults, applyTicketIdentity, matchProfileIdentity } from '../src/personal-profile.js';
import { printedIdentityHint } from '../src/identity.js';
import { DEMO_BOARDING_CODE } from '../src/demo-boarding-code.js';
import { ticketFieldLocked } from '../src/barcode-fields.js';
import { sharedSettings, mergeSettings } from '../src/shared-settings.js';
import { createRecord, archive, readArchive } from '../src/model.js';
import { personalProfilePanel, personalProfileSummary } from '../src/personal-profile-form.js';
import { JSDOM } from 'jsdom';

const profile = personalProfile({ chineseName:'示例旅客', firstName:'SAN', lastName:'ZHANG', gender:'男', documents:[{id:'id',type:'national-id',number:'000000200001011234'}, {id:'pass',type:'passport',number:'E00000000'}, {id:'permit',type:'hk-macau-permit',number:'H00000000'}] });

test('personal information is entirely optional and only the explicitly configured part is filled', () => {
  assert.deepEqual(sharedSettings({profile:{}}), {flightMcpKey:''});
  for (const type of ['rail','flight']) assert.equal(profilePassengerName({type}), '');
  const chineseOnly = {chineseName:'示例旅客'};
  assert.equal(profilePassengerName({type:'rail'},chineseOnly),'示例旅客');
  assert.equal(profilePassengerName({type:'flight'},chineseOnly),'');
  assert.equal(profilePassengerName({type:'rail'},{firstName:'SAN',lastName:'ZHANG'}),'');
  assert.equal(profilePassengerName({type:'flight'},{firstName:'SAN',lastName:'ZHANG'}),'ZHANG/SAN');
  const passportOnly = {documents:[{id:'passport',type:'passport',number:'E00000000'}]};
  for (const type of ['rail','flight']) {
    assert.equal(profilePassengerName({type},passportOnly),'');
    assert.equal(profilePassengerName({type},{gender:'男'}),'');
  }
});

test('a complete or masked ticket number locks only a unique matching document', () => {
  const hint = printedIdentityHint('票价 41.00\n0000002000XXXX1234 示例旅客');
  assert.equal(hint, '0000002000****1234');
  assert.equal(printedIdentityHint('证件号码：e000000＊＊'), 'e000000**');
  assert.equal(matchProfileIdentity('0000002000••••1234', profile),'000000200001011234');
  assert.equal(matchProfileIdentity('E000000＊＊', {...profile,autoFill:false}),'E00000000');
  for (const unmatched of ['', 'E12345678', '*********', 'E0000**', '000000200001011235']) assert.equal(matchProfileIdentity(unmatched,profile),'');
  const ambiguous = {...profile,documents:[...profile.documents,{type:'passport',number:'E00000001'}]};
  assert.equal(matchProfileIdentity('E000000**', ambiguous),'');
  assert.equal(matchProfileIdentity('E000000**', {...ambiguous,documents:[...ambiguous.documents,{type:'other',number:'E00000000'}]}),'');
  const record = createRecord();
  applyTicketIdentity(record, hint, profile, 'pdf');
  const [stored] = readArchive(archive([record]));
  assert.equal(stored.identity, '000000200001011234');
  assert.equal(stored.fieldSources.identity, 'profile-match');
  assert.ok(ticketFieldLocked(stored, 'identity'));
  assert.ok(!JSON.stringify(stored).includes(hint));
  const invoice = createRecord({railInvoice:{electronicTicketNumber:'2600000000000000000000001'}});
  applyTicketIdentity(invoice, 'ｐ００１２３４５６', undefined, 'pdf');
  assert.equal(invoice.identity, 'P00123456');
  assert.equal(invoice.fieldSources.identity, 'pdf');
  assert.ok(ticketFieldLocked(invoice, 'identity'));
});

test('a manually entered flight preselects documents from its route and exact departure day', () => {
  const passport = (number, expiry) => ({type:'passport', number, expiry});
  const passports = [passport('P000002', '2030-06-10'), passport('P000001', '2025-06-10')];
  const standard = {...profile, documents:[...passports, profile.documents[0]]};
  const flight = values => createRecord({type:'flight', template:'air-boarding-pass', origin:'PEK', destination:'LHR', ...values});
  const identity = (values, settings = standard) => applyProfileDefaults(flight(values), settings).identity;
  assert.equal(identity({destination:'SHA'}), '000000200001011234');
  assert.equal(identity({destination:'HKG'}), '');
  assert.equal(identity({destination:'',origin:''}), '');
  assert.equal(identity({departureDate:'2025-06-10'}), 'P000001');
  assert.equal(identity({departureDate:'2025-06-11'}), 'P000002');
  assert.equal(identity({departureDate:'2030-06-11'}), '');
  assert.equal(identity({departureDate:{year:2026,dayOfYear:null}}), '');
  assert.equal(identity({departureDate:'2026-06-11'}, {...profile, documents:[...passports, passport('P000003', '')]}), '');
  assert.equal(identity({}, {...profile, documents:[passport('P000003', '')]}), 'P000003');
  assert.equal(identity({departureDate:'2026-06-11'}, {...profile, documents:[...passports, passport('P000003', '2030-06-10')]}), '');
  assert.equal(identity({departureDate:'2026-02-01'}, {...standard, autoFill:false}), '');

  const draft = applyProfileDefaults(flight({departureDate:'2026-02-01'}), standard);
  assert.equal(draft.identity, 'P000002');
  assert.equal(applyProfileDefaults({...draft, boardingCodeSource:'original'}, standard).identity, 'P000002');
  assert.equal(applyProfileDefaults(flight({departureDate:'2026-02-01', boardingCodeSource:'original', boardingCode:DEMO_BOARDING_CODE, boardingLegIndex:'0'}), standard).identity, '');
  assert.equal(applyProfileDefaults({...draft, identity:'', fieldSources:{identity:'manual'}}, standard).identity, '');
  assert.equal(applyProfileDefaults({...draft, identity:'MYDOC123', fieldSources:{identity:'manual'}}, standard).identity, 'MYDOC123');
});

test('type changes and profile updates respect per-ticket corrections and intentionally blank fields', () => {
  const record = createRecord(applyProfileDefaults({type:'rail'},profile)), before = structuredClone(profile);
  const flight = applyProfileDefaults({...record,type:'flight'},profile,{previousRecord:record});
  assert.equal(flight.passenger,'ZHANG/SAN'); assert.equal(flight.identity,'');
  const corrected = applyProfileDefaults({...record,type:'flight',passenger:'单票姓名',identity:'',fieldSources:{identity:'manual'}},profile,{previousRecord:record,passengerEdited:true});
  assert.equal(corrected.passenger,'单票姓名'); assert.equal(corrected.identity,''); assert.ok(!Object.hasOwn(corrected,'identityType'));
  const changed = applyProfileDefaults(record,{...profile,chineseName:'新的姓名'},{previousProfile:profile});
  assert.equal(changed.passenger,'新的姓名');
  assert.equal(applyProfileDefaults({...record,passenger:''},{...profile,chineseName:'新的姓名'},{previousProfile:profile,passengerEdited:true}).passenger,'');
  assert.deepEqual(profile,before); assert.equal(record.type,'rail');
});

test('manual railway defaults and backups contain the saved name and a uniquely chosen national ID', () => {
  const settings = sharedSettings({flightMcpKey:'private-key',profile});
  const record = createRecord(applyProfileDefaults({type:'rail'},settings.profile));
  for(const key of ['identityType','gender','nationality','address'])assert.equal(Object.hasOwn(record,key),false);
  assert.equal(record.identity, '000000200001011234');
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
  assert.equal(profilePassengerName({type:'flight'},{firstName:'SAN'}),'SAN');
  assert.equal(profilePassengerName({type:'flight'},{lastName:'ZHANG'}),'ZHANG');
  assert.equal(profilePassengerName({type:'flight'},{firstName:'SAN MING',lastName:'ZHANG'}),'ZHANG/SAN MING');
  const onlyKnown=personalProfile({chineseName:'示例旅客',unexpected:'unused',documents:[{id:'id',type:'passport',number:'E00000000',unexpected:'unused'}]});
  assert.equal(Object.hasOwn(onlyKnown,'unexpected'),false);assert.equal(Object.hasOwn(onlyKnown.documents[0],'unexpected'),false);
  assert.deepEqual(Object.keys(onlyKnown.documents[0]),['id','type','label','number','expiry']);
  assert.equal(personalProfile({gender:'constructor'}).gender,'');
});
