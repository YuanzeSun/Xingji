import {flightNameLanguage} from './flight-passenger.js';
import {markFieldSources} from './field-sources.js';
import {ticketFieldLocked} from './barcode-fields.js';
import { requireCompleteIdentity } from './identity.js';

export const PROFILE_FIELDS = [
  ['chineseName','中文姓名','text',100], ['firstName','英文名（First name）','text',150], ['lastName','英文姓（Last name）','text',100],
  ['gender','性别','select',40]
];
export const GENDER_OPTIONS = [['','未设置'],['男','男'],['女','女']];
export const DOCUMENT_TYPES = { 'national-id':'居民身份证', passport:'护照', 'hk-macau-permit':'港澳通行证', 'taiwan-permit':'台湾通行证', 'residence-permit':'居留证', other:'其他证件' };
const text = (value, label, max = 100) => {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label}格式无效或过长`);
  return value.trim();
};
const fullDate = (value, label) => {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00Z') : null;
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value || Number(value.slice(0,4)) < 1800 || Number(value.slice(0,4)) > 2200) throw new Error(`${label}请填写有效的年月日`);
  return value;
};
export function personalProfile(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('个人资料格式无效');
  if (value.autoFill !== undefined && typeof value.autoFill !== 'boolean') throw new Error('预填设置格式无效');
  const profile = { autoFill:value.autoFill !== false };
  for (const [key,label,,max] of PROFILE_FIELDS) profile[key] = text(value[key], label, max);
  const gender = profile.gender.toLowerCase();
  profile.gender = ['男','male','m'].includes(gender) ? '男' : ['女','female','f'].includes(gender) ? '女' : '';
  if (value.documents !== undefined && (!Array.isArray(value.documents) || value.documents.length > 20)) throw new Error('最多保存20份常用证件');
  const ids = new Set();
  profile.documents = (value.documents || []).map((doc,index)=>{
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('常用证件格式无效');
    const id = text(doc.id, '证件编号') || `document-${index}`;
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id) || ids.has(id)) throw new Error('证件编号无效或重复');
    ids.add(id);
    const type = doc.type || 'other';
    if (!Object.hasOwn(DOCUMENT_TYPES,type)) throw new Error('未知证件类型');
    const number = text(doc.number,'证件号码',128);
    requireCompleteIdentity(number);
    return { id, type, label:text(doc.label,'证件名称',80), number, expiry:fullDate(text(doc.expiry,'有效期',10),'有效期') };
  }).filter(doc=>doc.label || doc.number || doc.expiry);
  for (const key of ['railDocument','flightDocument']) {
    const selected = text(value[key], '默认证件');
    profile[key] = selected === 'none' || profile.documents.some(doc=>doc.id === selected) ? selected : '';
  }
  return profile;
}
export const hasPersonalProfile = value => JSON.stringify(personalProfile(value)) !== JSON.stringify(personalProfile());
export function profileDefaults(type, value, record={}) {
  const profile = personalProfile(value), defaults = Object.fromEntries(['passenger','identity'].map(key=>[key,'']));
  if (!profile.autoFill) return defaults;
  const domestic=type==='flight' && flightNameLanguage(record)==='zh';
  defaults.passenger = type === 'flight' && !domestic ? [profile.lastName,profile.firstName].filter(Boolean).join('/') : profile.chineseName;
  const choice = type === 'flight' ? profile.flightDocument : profile.railDocument;
  const doc = choice === 'none' ? null : choice ? profile.documents.find(doc=>doc.id === choice)
    : profile.documents.find(doc=>doc.type === (type === 'flight' && !domestic ? 'passport' : 'national-id') && doc.number);
  if (doc?.number) defaults.identity = doc.number;
  return defaults;
}
export function applyProfileDefaults(record, profile, { edited = [], previousProfile = profile, previousType = record.type, previousRecord = record } = {}) {
  const next = profileDefaults(record.type, profile,record), previous = profileDefaults(previousType, previousProfile,previousRecord), out = { ...record };
  const protectedFields = new Set(edited);
  for (const key of Object.keys(next)) {
    if (!ticketFieldLocked(record,key) && !protectedFields.has(key) && (!record[key] || record[key] === previous[key])) {
      out[key] = next[key];
      if(out[key]!==record[key] || !record[key])markFieldSources(out,[key],'profile');
    }
  }
  return out;
}
