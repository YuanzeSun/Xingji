import {escape as e} from './html.js';
import {calendarDate,JOURNEY_DATE_FIELDS,journeyDate} from './journey-date.js';
import {hasRailQRCode} from './ticket-code.js';
import {RAIL_TIMETABLE_REFERENCES} from './rail-journey.js';
import { FLIGHT_DATE_DEFAULT_ATTR } from './flight-times.js';
export const sourceFieldValue=(record,key)=>key.endsWith('DateYear') ? journeyDate(record[key.slice(0,-4)])?.year : record[key];
export const railBarcodeFieldLocked=(record,key)=>hasRailQRCode(record) &&
  key!=='ticketCode' && record.fieldSources?.[key]==='barcode' && !!record.lockedFields?.includes(key);
export const railInvoiceFieldLocked = (record, key) => record.type === 'rail' &&
  !!record.railInvoice?.electronicTicketNumber && record.fieldSources?.[key] === 'pdf';

export const RAIL_POINTS_SOURCE = 'rail-points';
export const RAILGO_REFERENCE_SOURCE = 'railgo-reference';
export const railTimetableSource = journey => journey.timetableReference?.provider ||
  (journey.query.referenceFor ? RAILGO_REFERENCE_SOURCE : 'rail-lookup');
export const isRailPointsRecord = record => record.type === 'rail' && !!record.sources?.some(source => source.kind === RAIL_POINTS_SOURCE);
export const railPointsFieldLocked = (record, key) => record.type === 'rail' &&
  record.fieldSources?.[key] === RAIL_POINTS_SOURCE && !!record.lockedFields?.includes(key);
export const railImportFieldLocked = (record, key) => railInvoiceFieldLocked(record, key) || railPointsFieldLocked(record, key);
export const matchedIdentityLocked = (record, key) => key === 'identity' &&
  record.fieldSources?.identity === 'profile-match' && !!record.lockedFields?.includes(key);
export const railCodeEntryLocked = record => record.type === 'rail' &&
  (!!record.railInvoice?.electronicTicketNumber || isRailPointsRecord(record));
const referenceLabels=Object.fromEntries(Object.entries(RAIL_TIMETABLE_REFERENCES).map(([key, { name }]) => [key, name]));
export const isRailLookupSource = kind => typeof kind === 'string' &&
  (kind === 'railgo' || kind === RAILGO_REFERENCE_SOURCE || Object.hasOwn(referenceLabels, kind));
const FIELD_SOURCES=Object.freeze({manual:'手动输入',barcode:'条码',variflight:'飞常准',railgo:'RailGo',profile:'个人资料','profile-match':'证件匹配',ocr:'图片识别',pdf:'PDF 导入',default:'默认值',generated:'自动生成',database:'地点数据库',lookup:'查询补全',[RAIL_POINTS_SOURCE]:'12306 积分',[RAILGO_REFERENCE_SOURCE]:'RailGo 参考',...referenceLabels});
const metadata=new Set(['fieldSources','lookupValues','boardingCodeSource','boardingCodeOperatingFlight','deleted']);
const editorSettings=new Set(['type','template','flightStatus','provenance']);
export const hasFieldValue=value=>value!==undefined && value!==null && value!==false && value!=='' && (!Array.isArray(value) || value.length>0);
const imports={manual:'manual',scan:'ocr',pdf:'pdf','rail-lookup':'railgo','flight-lookup':'variflight',[RAIL_POINTS_SOURCE]:RAIL_POINTS_SOURCE,[RAILGO_REFERENCE_SOURCE]:RAILGO_REFERENCE_SOURCE};
export const importFieldSource=kind=>Object.hasOwn(referenceLabels,kind) ? kind : Object.hasOwn(imports,kind) ? imports[kind] : '';

export function normalizeRailFieldDates(record, dates) {
  const result = {};
  if (record.type !== 'rail' || record.deleted || !dates || typeof dates !== 'object' || Array.isArray(dates)) return result;
  for (const [key, value] of Object.entries(dates).sort()) {
    if (!isRailLookupSource(record.fieldSources[key]) || !hasFieldValue(sourceFieldValue(record, key)) ||
      typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    try { if (calendarDate(value) === value) result[key] = value; } catch { /* An invalid date has no attribution. */ }
  }
  return result;
}

const knownSource = kind => typeof kind === 'string' && Object.hasOwn(FIELD_SOURCES, kind);
export function isFieldSourceEntry(key, kind, fields) {
  return knownSource(kind) && !metadata.has(key) &&
    (fields.includes(key) || (key.endsWith('DateYear') && JOURNEY_DATE_FIELDS.includes(key.slice(0, -4))));
}
export function normalizeFieldSources(input) {
  return input && typeof input === 'object' && !Array.isArray(input)
    ? Object.fromEntries(Object.keys(input).sort().map(key => [key, input[key]])) : {};
}
export function fieldSourceKind(record, key) {
  const kind = record.fieldSources?.[key];
  return knownSource(kind) ? kind : '';
}
export function markFieldSources(record,fields,kind) {
  if(!Object.hasOwn(FIELD_SOURCES,kind))throw new Error('未知字段来源');
  record.fieldSources={...record.fieldSources};
  const dates = record.railFieldDates && { ...record.railFieldDates };
  for(const key of fields)if(!metadata.has(key)){
    if (dates) delete dates[key];
    if(hasFieldValue(sourceFieldValue(record,key)) || kind==='manual')record.fieldSources[key]=kind;
    else delete record.fieldSources[key];
  }
  if (dates) record.railFieldDates = dates;
}
export function copyFieldSource(target,source,key) {
  target.fieldSources={...target.fieldSources};
  const fields = JOURNEY_DATE_FIELDS.includes(key) ? [key, key+'Year'] : [key];
  for (const field of fields) {
    if (source.fieldSources?.[field]) target.fieldSources[field] = source.fieldSources[field];
    else delete target.fieldSources[field];
    const date = source.railFieldDates?.[field];
    if (date || target.railFieldDates?.[field]) {
      target.railFieldDates = { ...target.railFieldDates };
      if (date) target.railFieldDates[field] = date;
      else delete target.railFieldDates[field];
    }
  }
}
export function fieldSourceLabel(record,key) {
  const value = JOURNEY_DATE_FIELDS.includes(key) ? journeyDate(record[key])?.dayOfYear : sourceFieldValue(record,key);
  if(!hasFieldValue(value))return '未填写';
  const source = fieldSourceKind(record, key), label = FIELD_SOURCES[source] || '未记录';
  const dataDate = isRailLookupSource(source) && record.railFieldDates?.[key];
  return dataDate ? label + ' · ' + dataDate : label;
}
export function fieldSourceBadge(key,record) {
  if(editorSettings.has(key))return '';
  const label=fieldSourceLabel(record,key);
  return `<small class="field-source" data-field-source="${e(key)}" data-source-kind="${e(fieldSourceKind(record, key))}" title="信息来源：${e(label)}">${e(label)}</small>`;
}
export function refreshFieldSources(root,record) {
  for(const badge of root.querySelectorAll('[data-field-source]')){
    const key=badge.dataset.fieldSource;if(key.startsWith('bcbp:'))continue;
    const defaultYear = key.endsWith('DateYear') && badge.closest('label')?.querySelector(`[${FLIGHT_DATE_DEFAULT_ATTR}]`)?.value;
    const label=defaultYear ? FIELD_SOURCES.default : fieldSourceLabel(record,key);
    badge.textContent=label;badge.title='信息来源：'+label;badge.dataset.sourceKind=defaultYear ? 'default' : fieldSourceKind(record,key);
  }
}
