import { PROFILE_FIELDS, DOCUMENT_TYPES, personalProfile, hasPersonalProfile, GENDER_OPTIONS, MAX_MEMBERSHIPS } from './personal-profile.js';
import { bindIdentityInput, maskIdentity, maskRailIdentity } from './identity.js';
import { escape as e } from './html.js';
import { bindUppercaseInputs } from './uppercase-input.js';

const documentName = doc => doc.label || DOCUMENT_TYPES[doc.type] || '其他证件';
const maskedDocument = (number, type) => maskRailIdentity(number, { isNationalId: type === 'national-id' });
const profileNumbers = new WeakMap();
function profileList(kind, title, rows) {
  const heading = `profile-${kind}-heading`;
  return `<h3 id="${heading}">${title}</h3>${rows ? `<div class="profile-documents" data-profile-list="${kind}" role="region" aria-labelledby="${heading}" tabindex="0">${rows}</div>` : ''}`;
}
function membershipFields(memberships) {
  const rows = memberships.map((entry, index) => `<fieldset class="profile-document profile-membership" data-membership-id="${e(entry.id)}">
    <legend><span>会员计划 ${index + 1}</span><button type="button" class="text-button danger" data-membership-remove aria-label="移除会员计划 ${index + 1}" data-setting-control>移除</button></legend>
    <div class="profile-document-fields">
      <label class="field"><span>计划航司代码</span><input data-membership-field="program" value="${e(entry.program)}" placeholder="如 CA、MF、LH" maxlength="2" autocomplete="off" spellcheck="false" data-setting-control /></label>
      <label class="field"><span>会员号</span><input data-membership-field="number" value="${e(maskIdentity(entry.number))}" maxlength="64" autocomplete="off" spellcheck="false" data-setting-control /></label>
    </div></fieldset>`).join('');
  const add = memberships.length < MAX_MEMBERSHIPS ? '<button type="button" class="button secondary small" data-membership-add data-setting-control>＋ 添加常旅客计划</button>' : '';
  return profileList('memberships', '常旅客资料', rows) + add;
}
export function personalProfilePanel(value, error = '') {
  const profile = { ...personalProfile(), ...value };
  const docs = value?.documents || [{id:'identity-card',type:'national-id'}, {id:'passport',type:'passport'}];
  const field = ([key,label,type,max]) => `<label class="field"><span>${e(label)}</span>${type === 'select' ? `<select name="${key}" data-setting-control>${GENDER_OPTIONS.map(([value,label])=>`<option value="${value}" ${profile[key] === value ? 'selected' : ''}>${label}</option>`).join('')}</select>` : `<input name="${key}" type="${type}" value="${e(profile[key])}" maxlength="${max}" autocomplete="off" data-setting-control />`}</label>`;
  return `<section class="panel personal-profile"><div class="panel-heading"><h2>个人常用资料</h2></div><form id="profile-form"><div class="profile-basics form-grid">${PROFILE_FIELDS.map(field).join('')}</div>${profileList('documents', '常用证件', docs.map((doc,index)=>`<fieldset class="profile-document" data-document-id="${e(doc.id)}"><legend><span>证件 ${index+1}</span><button type="button" class="text-button danger" data-profile-remove="${e(doc.id)}" aria-label="移除证件 ${index+1}" data-setting-control>移除</button></legend><div class="profile-document-fields"><label class="field"><span>证件类型</span><select data-doc-field="type" data-setting-control>${Object.entries(DOCUMENT_TYPES).map(([key,label])=>`<option value="${key}" ${key === doc.type ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>证件号码</span><input data-doc-field="number" value="${e(maskedDocument(doc.number, doc.type))}" autocomplete="off" spellcheck="false" maxlength="128" data-setting-control /></label><label class="field"><span>证件备注名</span><input data-doc-field="label" value="${e(doc.label)}" placeholder="可选，如旧护照" maxlength="80" data-setting-control /></label><label class="field"><span>有效期至</span><input type="date" data-doc-field="expiry" value="${e(doc.expiry)}" data-setting-control /></label></div></fieldset>`).join(''))}<button type="button" class="button secondary small" data-profile-add data-setting-control>＋ 添加其他证件</button>${membershipFields(profile.memberships || [])}<p class="form-error" role="alert">${e(error)}</p><div class="button-row"><button class="button primary" type="submit" data-setting-control>保存个人资料</button></div></form></section>`;
}
function collectRows(form, kind, field = kind) {
  return [...form.querySelectorAll(`[data-${kind}-id]`)].map(row => ({
    id: row.getAttribute(`data-${kind}-id`),
    ...Object.fromEntries([...row.querySelectorAll(`[data-${field}-field]`)].map(input => [input.getAttribute(`data-${field}-field`), profileNumbers.get(input) ?? input.value]))
  }));
}
export function collectPersonalProfile(form) {
  const data = new FormData(form);
  return { ...Object.fromEntries(PROFILE_FIELDS.map(([key])=>[key,String(data.get(key)||'')])),
    documents: collectRows(form, 'document', 'doc'), memberships: collectRows(form, 'membership') };
}
function bindMaskedNumber(input, number, mask) {
  profileNumbers.set(input, number || '');
  const hide = () => { input.value = mask(profileNumbers.get(input)); };
  input.addEventListener('focus', () => { input.value = profileNumbers.get(input); });
  input.addEventListener('input', () => {
    profileNumbers.set(input, input.value);
    if (input.ownerDocument.activeElement !== input) hide();
  });
  input.addEventListener('blur', hide);
  return hide;
}
export function bindPersonalProfileForm(form, { profile = {}, change, restructure, submit }) {
  if (!form) return;
  const documentNumbers = new Map((profile.documents || []).map(doc => [doc.id, doc.number]));
  for (const row of form.querySelectorAll('[data-document-id]')) {
    const input = row.querySelector('[data-doc-field="number"]'), type = row.querySelector('[data-doc-field="type"]');
    bindIdentityInput(input);
    const hide = bindMaskedNumber(input, documentNumbers.get(row.dataset.documentId), number => maskedDocument(number, type.value));
    type.addEventListener('change', hide);
  }
  const membershipNumbers = new Map((profile.memberships || []).map(entry => [entry.id, entry.number]));
  for (const row of form.querySelectorAll('[data-membership-id]')) {
    bindMaskedNumber(row.querySelector('[data-membership-field="number"]'), membershipNumbers.get(row.dataset.membershipId), maskIdentity);
  }
  bindUppercaseInputs(form, '[name="firstName"], [name="lastName"], [data-membership-field]');
  const capture = () => {
    const profile = collectPersonalProfile(form);
    change(profile);
  };
  const rebuild = (draft, focusSelector) => {
    const positions = new Map([...form.querySelectorAll('[data-profile-list]')].map(list => [list.dataset.profileList, list.scrollTop]));
    restructure(draft);
    const updated = form.ownerDocument.getElementById(form.id);
    if (!updated) return;
    for (const list of updated.querySelectorAll('[data-profile-list]')) list.scrollTop = positions.get(list.dataset.profileList) || 0;
    updated.querySelector(focusSelector)?.focus();
  };
  form.addEventListener('input',capture); form.addEventListener('change',capture); form.addEventListener('submit',submit);
  form.querySelector('[data-profile-add]').addEventListener('click',()=>{
    const profile = collectPersonalProfile(form);
    if (profile.documents.length >= 20) return;
    const id = crypto.randomUUID();
    profile.documents.push({id,type:'other',label:'',number:'',expiry:''});
    rebuild(profile, `[data-document-id="${id}"] [data-doc-field="type"]`);
  });
  for (const button of form.querySelectorAll('[data-profile-remove]')) button.addEventListener('click', () => {
    const draft = collectPersonalProfile(form);
    const selectedDocument = draft.documents.find(doc => doc.id === button.dataset.profileRemove);
    if (!selectedDocument || !form.ownerDocument.defaultView.confirm(`移除「${documentName(selectedDocument)}」？保存个人资料后，自动预填和证件匹配将跳过这份证件。`)) return;
    draft.documents = draft.documents.filter(doc => doc.id !== selectedDocument.id);
    rebuild(draft, '[data-profile-add]');
  });
  form.querySelector('[data-membership-add]')?.addEventListener('click', () => {
    const draft = collectPersonalProfile(form);
    const id = crypto.randomUUID();
    draft.memberships.push({ id, program: '', number: '' });
    rebuild(draft, `[data-membership-id="${id}"] [data-membership-field="program"]`);
  });
  for (const button of form.querySelectorAll('[data-membership-remove]')) button.addEventListener('click', () => {
    const id = button.closest('[data-membership-id]').dataset.membershipId;
    const draft = collectPersonalProfile(form);
    draft.memberships = draft.memberships.filter(entry => entry.id !== id);
    rebuild(draft, '[data-membership-add]');
  });
}
export function personalProfileSummary(value) {
  const profile = personalProfile(value);
  if (!hasPersonalProfile(profile)) return '未设置';
  return [...PROFILE_FIELDS.filter(([key])=>profile[key]).map(([key,label])=>`${label}：${profile[key]}`),
    ...profile.documents.map(doc=>`${documentName(doc)}：${maskedDocument(doc.number, doc.type) || '未填号码'}${doc.expiry ? ' · 有效期至 '+doc.expiry : ''}`),
    ...(profile.memberships || []).map(entry => `${entry.program}：${maskIdentity(entry.number)}`)].join('\n');
}
