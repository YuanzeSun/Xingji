import {escape as e} from './html.js';
import {JOURNEY_DATE_FIELDS,journeyDate} from './journey-date.js';
import {hasRailQRCode} from './ticket-code.js';
export const sourceFieldValue=(record,key)=>key.endsWith('DateYear') ? journeyDate(record[key.slice(0,-4)])?.year : record[key];
export const railBarcodeFieldLocked=(record,key)=>hasRailQRCode(record) &&
  key!=='ticketCode' && record.fieldSources?.[key]==='barcode' && !!record.lockedFields?.includes(key);
export const railInvoiceFieldLocked = (record, key) => record.type === 'rail' &&
  !!record.railInvoice?.electronicTicketNumber && record.fieldSources?.[key] === 'pdf';

export const RAIL_POINTS_SOURCE = 'rail-points';
export const RAILGO_REFERENCE_SOURCE = 'railgo-reference';
export const isRailPointsRecord = record => record.type === 'rail' && !!record.sources?.some(source => source.kind === RAIL_POINTS_SOURCE);
export const railPointsFieldLocked = (record, key) => record.type === 'rail' &&
  record.fieldSources?.[key] === RAIL_POINTS_SOURCE && !!record.lockedFields?.includes(key);
export const railImportFieldLocked = (record, key) => railInvoiceFieldLocked(record, key) || railPointsFieldLocked(record, key);
export const railCodeEntryLocked = record => record.type === 'rail' &&
  (!!record.railInvoice?.electronicTicketNumber || isRailPointsRecord(record));
const FIELD_SOURCES=Object.freeze({manual:'手动输入',barcode:'条码',variflight:'飞常准',railgo:'RailGo',profile:'个人资料',ocr:'图片识别',pdf:'PDF 导入',default:'默认值',generated:'自动生成',database:'地点数据库',lookup:'查询补全',[RAIL_POINTS_SOURCE]:'12306 积分',[RAILGO_REFERENCE_SOURCE]:'RailGo 参考'});
const metadata=new Set(['fieldSources','lookupValues','boardingCodeSource','boardingCodeOperatingFlight','deleted']);
const editorSettings=new Set(['type','template','flightStatus','provenance','offsetX','offsetY']);
export const hasFieldValue=value=>value!==undefined && value!==null && value!==false && value!=='' && (!Array.isArray(value) || value.length>0);
const imports={manual:'manual',scan:'ocr',pdf:'pdf','rail-lookup':'railgo','flight-lookup':'variflight',[RAIL_POINTS_SOURCE]:RAIL_POINTS_SOURCE,[RAILGO_REFERENCE_SOURCE]:RAILGO_REFERENCE_SOURCE};
export const importFieldSource=kind=>Object.hasOwn(imports,kind) ? imports[kind] : '';

export function normalizeFieldSources(input,fields) {
  if(!input)return {};
  if(typeof input!=='object' || Array.isArray(input))throw new Error('字段来源格式不正确');
  const out={};
  for(const key of Object.keys(input).sort()){
    if(!(fields.includes(key)||(key.endsWith('DateYear')&&JOURNEY_DATE_FIELDS.includes(key.slice(0,-4)))) || metadata.has(key) || typeof input[key]!=='string' || !Object.hasOwn(FIELD_SOURCES,input[key]))throw new Error('字段来源包含无效内容');
    out[key]=input[key];
  }
  return out;
}
export function markFieldSources(record,fields,kind) {
  if(!Object.hasOwn(FIELD_SOURCES,kind))throw new Error('未知字段来源');
  record.fieldSources={...record.fieldSources};
  for(const key of fields)if(!metadata.has(key)){
    if(hasFieldValue(sourceFieldValue(record,key)) || kind==='manual')record.fieldSources[key]=kind;
    else delete record.fieldSources[key];
  }
}
export function copyFieldSource(target,source,key) {
  target.fieldSources={...target.fieldSources};
  if(source.fieldSources?.[key])target.fieldSources[key]=source.fieldSources[key];
  else delete target.fieldSources[key];
  if(JOURNEY_DATE_FIELDS.includes(key)){
    if(source.fieldSources?.[key+'Year'])target.fieldSources[key+'Year']=source.fieldSources[key+'Year'];
    else delete target.fieldSources[key+'Year'];
  }
}
export function fieldSourceLabel(record,key) {
  if(!hasFieldValue(sourceFieldValue(record,key)))return '未填写';
  return FIELD_SOURCES[record.fieldSources?.[key]] || '未记录';
}
export function fieldSourceBadge(key,record) {
  if(editorSettings.has(key))return '';
  const label=fieldSourceLabel(record,key);
  return `<small class="field-source" data-field-source="${e(key)}" data-source-kind="${e(record.fieldSources?.[key] || '')}" title="信息来源：${e(label)}">${e(label)}</small>`;
}
export function refreshFieldSources(root,record) {
  for(const badge of root.querySelectorAll('[data-field-source]')){
    const key=badge.dataset.fieldSource;if(key.startsWith('bcbp:'))continue;
    const label=fieldSourceLabel(record,key);
    badge.textContent=label;badge.title='信息来源：'+label;badge.dataset.sourceKind=record.fieldSources?.[key] || '';
  }
}
