import { PROFILE_FIELDS, DOCUMENT_TYPES, personalProfile, hasPersonalProfile, GENDER_OPTIONS } from './personal-profile.js';
import { bindIdentityInput, maskRailIdentity } from './identity.js';
import { escape as e } from './html.js';
import { bindUppercaseNames } from './name-case.js';

const documentName = doc => doc.label || DOCUMENT_TYPES[doc.type] || '其他证件';
const maskedDocument = (number, type) => maskRailIdentity(number, { isNationalId: type === 'national-id' });
const profileNumbers = new WeakMap();
const options = (docs,selected) => `<option value="">按证件类型自动选择</option><option value="none" ${selected === 'none' ? 'selected' : ''}>不预填证件</option>` + docs.map(doc=>`<option value="${e(doc.id)}" ${selected === doc.id ? 'selected' : ''}>${e(documentName(doc))} · ${e(maskedDocument(doc.number, doc.type) || '未填写号码')}</option>`).join('');
export function personalProfilePanel(value, error = '') {
  const profile = { ...personalProfile(), ...value };
  const docs = value?.documents || [{id:'identity-card',type:'national-id'}, {id:'passport',type:'passport'}];
  const field = ([key,label,type,max]) => `<label class="field"><span>${e(label)}</span>${type === 'select' ? `<select name="${key}" data-setting-control>${GENDER_OPTIONS.map(([value,label])=>`<option value="${value}" ${profile[key] === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` : `<input name="${key}" type="${type}" value="${e(profile[key])}" maxlength="${max}" autocomplete="off" data-setting-control />`}</label>`;
  return `<section class="panel personal-profile"><div class="panel-heading"><div><h2>个人常用资料</h2><p>全部选填。只预填已保存的项目，每张票仍可单独修改。</p></div></div><form id="profile-form"><label class="checkbox-row"><input type="checkbox" name="autoFill" ${profile.autoFill ? 'checked' : ''} data-setting-control />新建票据时预填我的资料</label><div class="profile-basics form-grid">${PROFILE_FIELDS.map(field).join('')}</div><h3>常用证件</h3><div class="profile-documents">${docs.map((doc,index)=>`<fieldset class="profile-document" data-document-id="${e(doc.id)}"><legend><span>证件 ${index+1}</span><button type="button" class="text-button danger" data-profile-remove="${e(doc.id)}" aria-label="移除证件 ${index+1}" data-setting-control>移除</button></legend><div class="profile-document-fields"><label class="field"><span>证件类型</span><select data-doc-field="type" data-setting-control>${Object.entries(DOCUMENT_TYPES).map(([key,label])=>`<option value="${key}" ${key === doc.type ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>证件号码</span><input data-doc-field="number" value="${e(maskedDocument(doc.number, doc.type))}" autocomplete="off" spellcheck="false" maxlength="128" data-setting-control /></label><label class="field"><span>证件备注名</span><input data-doc-field="label" value="${e(doc.label)}" placeholder="可选，如旧护照" maxlength="80" data-setting-control /></label><label class="field"><span>有效期至</span><input type="date" data-doc-field="expiry" value="${e(doc.expiry)}" data-setting-control /></label></div></fieldset>`).join('')}</div><button type="button" class="button secondary small" data-profile-add data-setting-control>＋ 添加其他证件</button><div class="form-grid profile-document-defaults"><label class="field"><span>火车票默认证件</span><select name="railDocument" data-setting-control>${options(docs,profile.railDocument)}</select></label><label class="field"><span>机票默认证件</span><select name="flightDocument" data-setting-control>${options(docs,profile.flightDocument)}</select></label></div><p class="fine-print">保存到当前私有仓库，随设置同步到其他设备。</p><p class="form-error" role="alert">${e(error)}</p><div class="button-row"><button class="button primary" type="submit" data-setting-control>保存个人资料</button><button class="text-button" type="button" data-action="profile-reload">重新载入已保存资料</button></div></form></section>`;
}
export function collectPersonalProfile(form) {
  const data = new FormData(form);
  return { autoFill:form.elements.autoFill.checked, ...Object.fromEntries(PROFILE_FIELDS.map(([key])=>[key,String(data.get(key)||'')])),
    railDocument:String(data.get('railDocument')||''), flightDocument:String(data.get('flightDocument')||''),
    documents:[...form.querySelectorAll('[data-document-id]')].map(row=>({id:row.dataset.documentId,...Object.fromEntries([...row.querySelectorAll('[data-doc-field]')].map(input=>[input.dataset.docField,profileNumbers.get(input) ?? input.value]))})) };
}
export function bindPersonalProfileForm(form, { documents = [], change, restructure, submit }) {
  if (!form) return;
  const numbersById = new Map(documents.map(doc => [doc.id, doc.number]));
  for (const row of form.querySelectorAll('[data-document-id]')) {
    const input = row.querySelector('[data-doc-field="number"]'), type = row.querySelector('[data-doc-field="type"]');
    profileNumbers.set(input, numbersById.get(row.dataset.documentId) || '');
    bindIdentityInput(input);
    const hideNumber = () => { input.value = maskedDocument(profileNumbers.get(input), type.value); };
    input.addEventListener('focus', () => { input.value = profileNumbers.get(input); });
    input.addEventListener('input', () => {
      profileNumbers.set(input, input.value);
      if (form.ownerDocument.activeElement !== input) hideNumber();
    });
    input.addEventListener('blur', hideNumber);
    type.addEventListener('change', hideNumber);
  }
  bindUppercaseNames(form, ['firstName', 'lastName']);
  const capture = () => {
    const profile = collectPersonalProfile(form);
    for (const key of ['railDocument','flightDocument']) form.elements[key].innerHTML = options(profile.documents,profile[key]);
    change(profile);
  };
  form.addEventListener('input',capture); form.addEventListener('change',capture); form.addEventListener('submit',submit);
  form.querySelector('[data-profile-add]').addEventListener('click',()=>{
    const profile = collectPersonalProfile(form);
    if (profile.documents.length >= 20) return;
    profile.documents.push({id:crypto.randomUUID(),type:'other',label:'',number:'',expiry:''});
    restructure(profile);
  });
  for (const button of form.querySelectorAll('[data-profile-remove]')) button.addEventListener('click',()=>{
    const profile = collectPersonalProfile(form); profile.documents = profile.documents.filter(doc=>doc.id !== button.dataset.profileRemove);
    for (const key of ['railDocument','flightDocument']) if (profile[key] === button.dataset.profileRemove) profile[key] = '';
    restructure(profile);
  });
}
export function personalProfileSummary(value) {
  const profile = personalProfile(value);
  if (!hasPersonalProfile(profile)) return '未设置';
  const selected = key => profile[key] === 'none' ? '不预填' : !profile[key] ? '按证件类型自动选择'
    : profile.documents.filter(doc=>doc.id===profile[key]).map(doc=>`${documentName(doc)} · ${maskedDocument(doc.number, doc.type)}`).join('');
  return [`新票预填：${profile.autoFill ? '开启' : '关闭'}`, ...PROFILE_FIELDS.filter(([key])=>profile[key]).map(([key,label])=>`${label}：${profile[key]}`),
    ...profile.documents.map(doc=>`${documentName(doc)}：${maskedDocument(doc.number, doc.type) || '未填号码'}${doc.expiry ? ' · 有效期至 '+doc.expiry : ''}`),
    `火车票默认证件：${selected('railDocument')}`,`机票默认证件：${selected('flightDocument')}`].join('\n');
}
