import {flightNameLanguage} from './flight-passenger.js';
import {markFieldSources} from './field-sources.js';
import {ticketFieldLocked} from './barcode-fields.js';
import { identityPattern, requireCompleteIdentity } from './identity.js';
import { calendarDate } from './journey-date.js';
import { resolvePlace } from './places.js';

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
  return profile;
}
export const hasPersonalProfile = value => JSON.stringify(personalProfile(value)) !== JSON.stringify(personalProfile());

export function matchProfileIdentity(hint, profile) {
  const pattern = identityPattern(hint);
  if (!pattern.includes('*') || !/^[A-Z0-9*]{3,128}$/.test(pattern) || !/[A-Z0-9]/.test(pattern)) return '';
  const matches = (profile?.documents || []).filter(doc => {
    const number = identityPattern(doc.number);
    return /^[A-Z0-9]+$/.test(number) && number.length === pattern.length &&
      Array.from(pattern).every((char, index) => char === '*' || char === number[index]);
  });
  return matches.length === 1 ? matches[0].number : '';
}

export function applyTicketIdentity(record, hint, profile, source) {
  const pattern = identityPattern(hint);
  const masked = pattern.includes('*');
  const identity = masked ? matchProfileIdentity(pattern, profile) : /^[A-Z0-9]{3,128}$/.test(pattern) ? pattern : '';
  if (!identity) return;
  record.identity = identity;
  if (masked || source === 'pdf' || source === 'barcode') record.lockedFields = [...new Set([...record.lockedFields, 'identity'])].sort();
  markFieldSources(record, ['identity'], masked ? 'profile-match' : source);
  return true;
}

export function profilePassengerName(record, profile = {}) {
  if (profile.autoFill === false) return '';
  return record.type === 'flight' && flightNameLanguage(record) !== 'zh'
    ? [profile.lastName, profile.firstName].filter(Boolean).join('/')
    : profile.chineseName || '';
}

function prefilledDocument(record, profile) {
  if (!profile.autoFill || !profile.documents.length) return '';
  let type = 'national-id';
  if (record.type === 'flight') {
    const countries = ['origin', 'destination'].map(side => {
      const place = resolvePlace(record, side);
      return place.status === 'matched' ? place.country : '';
    });
    if (countries.some(country => country && !['CN','HK','MO','TW'].includes(country))) type = 'passport';
    else if (!countries.every(country => country === 'CN')) return '';
  }
  const documents = profile.documents.filter(doc => doc.type === type);
  if (type === 'national-id') {
    const numbers = [...new Set(documents.map(doc => doc.number).filter(Boolean))];
    return numbers.length === 1 ? numbers[0] : '';
  }
  if (documents.length === 1) return documents[0].number;
  const departure = calendarDate(record.departureDate);
  if (departure.length !== 10 || documents.some(doc => !doc.expiry)) return '';
  const eligible = documents.filter(doc => doc.expiry >= departure).sort((a, b) => a.expiry.localeCompare(b.expiry));
  const [first, second] = eligible;
  return first && first.expiry !== second?.expiry ? first.number : '';
}

export function applyProfileDefaults(record, profile, { passengerEdited = false, previousProfile = profile, previousRecord = record } = {}) {
  const out = { ...record };
  const settings = personalProfile(profile);
  if (!passengerEdited && !ticketFieldLocked(record, 'passenger') &&
      (!record.passenger || record.passenger === profilePassengerName(previousRecord, previousProfile === profile ? settings : personalProfile(previousProfile)))) {
    out.passenger = profilePassengerName(record, settings);
    if (out.passenger !== record.passenger || !record.passenger) markFieldSources(out, ['passenger'], 'profile');
  }
  const source = record.fieldSources?.identity;
  if (record.boardingCodeSource !== 'original' && source !== 'manual' && !ticketFieldLocked(record, 'identity') && (!record.identity || source === 'profile')) {
    const hasTicketSource = record.ticketCode ||
      record.sources?.some(item => item.kind === 'pdf' || item.kind === 'scan');
    const identity = hasTicketSource ? '' : prefilledDocument(record, settings);
    if (identity !== (record.identity || '')) {
      out.identity = identity;
      markFieldSources(out, ['identity'], 'profile');
    }
  }
  return out;
}
