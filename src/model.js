import {BOARDING_METADATA_FIELDS,boardingMetadataValues} from './boarding-metadata.js';
import {fieldState,takeField,takeBoardingCode,mergeBoardingCode} from './record-merge-metadata.js';
import {JOURNEY_DATE_FIELDS,journeyDate,storedJourneyDate,calendarDate,fullDate,dateLabel} from './journey-date.js';
import {readBoardingCode} from './bcbp.js';
export {resolveRecordConflict} from './record-merge-metadata.js';
import {LOOKUP_FIELDS,normalizeLookupValues,isLookupValue as isAutomatic} from './lookup-values.js';
import {normalizeFieldSources,markFieldSources,importFieldSource,hasFieldValue,sourceFieldValue} from './field-sources.js';
import {ACTUAL_FLIGHT_FIELDS} from './flight-times.js';
import {BOARDING_FIELDS,refreshGeneratedCode,operatingFlight} from './boarding-code-state.js';
import { normalizeRailRoute, railRouteMatches } from './rail-route-snapshot.js';
import { normalizeMarks } from './ticket-marks.js';
import { normalizeTicketCode } from './ticket-code.js';
import { normalizeBoardingCode } from './boarding-code.js';
import { normalizeSeatClass } from './seat-classes.js';
import { normalizeAircraft } from './aircraft.js';
import { normalizePlaces, placeIdentity } from './places.js';
import { isRefundReceipt } from './record-kind.js';
import { normalizeRailBureau, splitRailModel, normalizeRailPowerSupply } from './rail-details.js';
import { cityLabel } from './locations.js';
import { isStoredTimeZone } from './data/time-zone-ids.js';
import { normalizeFlightStatus } from './flight-status.js';
import { normalizeRailJourney, railJourneyMatches, normalizeRailTrainsets } from './rail-journey.js';
export const SCHEMA_VERSION = 2;
export const DEFAULT_RAIL_TEMPLATE = 'rail-receipt';
export const TEMPLATES = {
  'rail-red-classic': '红色软纸票 · 2015年前',
  'rail-red': '红色软纸票 · 2015版',
  'rail-blue': '蓝色磁介质票 · 2015版',
  'rail-receipt': '蓝色报销凭证 · 热敏版',
  'rail-refund-receipt': '退票费凭证',
  'air-boarding-pass': '登机牌'
};
export const FIELDS = ['type', 'template', 'origin', 'destination', 'originCity', 'destinationCity', 'originCode', 'destinationCode', 'service', 'departureDate', 'departureTime', 'arrivalDate', 'arrivalTime', ...ACTUAL_FLIGHT_FIELDS, 'flightDistance', 'departureZone', 'arrivalZone', 'passenger', 'identity', 'carriage', 'seat', 'seatClass', 'price', 'orderNumber', 'ticketNumber', 'saleCode', 'issuer', 'gate', 'terminal', 'boardingTime', 'airline', 'flightStatus', 'aircraft', 'aircraftRegistration', 'railBureau', 'railModel', 'railTrainsets', 'railPowerSupply', 'railMileage', 'railRunner', 'railCarOwner', 'railPlatform', 'railRoute', 'railJourney', 'pnr', 'ticketMarks', 'ticketCode', 'boardingCode', 'boardingCodeSource', 'boardingCodeOperatingFlight', 'boardingLegIndex', ...BOARDING_METADATA_FIELDS, 'lookupValues', 'fieldSources', 'provenance', 'offsetX', 'offsetY', 'deleted'];
export const now = () => new Date().toISOString();
export const clone = value => structuredClone(value);
export const sameRecords = (a, b) => JSON.stringify([...a].sort((x, y) => x.id.localeCompare(y.id))) === JSON.stringify([...b].sort((x, y) => x.id.localeCompare(y.id)));
export function createRecord(values = {}) {
  const record = Object.fromEntries(FIELDS.map(k => [k, '']));
  Object.assign(record, { id: crypto.randomUUID(), type: 'rail', template: DEFAULT_RAIL_TEMPLATE, departureZone: 'Asia/Shanghai', arrivalZone: 'Asia/Shanghai', provenance: 'commemorative', offsetX: '0', offsetY: '0', deleted: false, sources: [], mergedIds: [], lockedFields: [], createdAt: now(), updatedAt: now() });
  for (const k of [...FIELDS, 'id', 'createdAt', 'updatedAt', 'sources', 'mergedIds', 'lockedFields']) if (Object.hasOwn(values, k)) record[k] = JOURNEY_DATE_FIELDS.includes(k) ? journeyDate(values[k]) : clone(values[k]);
  record.fieldSources=normalizeFieldSources(record.fieldSources,FIELDS);
  const source=importFieldSource(values.sources?.[0]?.kind);
  if(source && !Object.hasOwn(values,'fieldSources'))markFieldSources(record,Object.keys(values).filter(key=>FIELDS.includes(key)),source);
  for(const key of ['type','template','departureZone','arrivalZone','provenance','offsetX','offsetY'])if(!record.fieldSources[key] && !Object.hasOwn(values,key))record.fieldSources[key]='default';
  if(record.type==='flight' && !values.flightStatus)record.fieldSources.flightStatus='default';
  return validateRecord(record);
}
export function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1800 || year > 2200 || (month !== undefined && (month < 1 || month > 12))) return false;
  return day === undefined || (day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate());
}
export function validateRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('票据不是有效对象');
  if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.id)) throw new Error('票据ID无效');
  if (!['rail', 'flight'].includes(input.type)) throw new Error('未知交通方式');
  if (!Object.hasOwn(TEMPLATES, input.template)) throw new Error('不支持的票面样式');
  if ((input.type === 'flight') !== input.template.startsWith('air-')) throw new Error('票面与交通方式不匹配');
  const out = { id: input.id };
  for (const field of FIELDS) {
    if (JOURNEY_DATE_FIELDS.includes(field)) {out[field]=storedJourneyDate(input[field]);continue;}
    if (field === 'fieldSources') { out.fieldSources = normalizeFieldSources(input.fieldSources,FIELDS); continue; }
    if (field === 'lookupValues') { out.lookupValues = normalizeLookupValues(input.lookupValues); continue; }
    if (field === 'deleted') { out.deleted = input.deleted === true; continue; }
    if (field === 'ticketMarks') { out.ticketMarks = normalizeMarks(input.ticketMarks); continue; }
    if (field === 'ticketCode') { out.ticketCode = normalizeTicketCode(input.ticketCode); continue; }
    if (field === 'boardingCode') { out.boardingCode = normalizeBoardingCode(input.boardingCode); continue; }
    if (field === 'railRoute') { out.railRoute = normalizeRailRoute(input.railRoute); continue; }
    if (field === 'railJourney') { out.railJourney = normalizeRailJourney(input.railJourney); continue; }
    if (input[field] !== undefined && typeof input[field] !== 'string') throw new Error(`字段 ${field} 必须为文字`);
    out[field] = (input[field] || '').slice(0, 1000);
  }
  out.seatClass = normalizeSeatClass(out.seatClass, out.type);
  out.aircraft = normalizeAircraft(out.aircraft);
  out.flightStatus = out.type === 'flight' ? normalizeFlightStatus(out.flightStatus) : '';
  out.railBureau = normalizeRailBureau(out.railBureau);
  out.railTrainsets = normalizeRailTrainsets(out.railTrainsets);
  const railModel=splitRailModel(out.railModel);out.railModel=railModel.model;
  out.railPowerSupply=normalizeRailPowerSupply(out.railPowerSupply || railModel.powerSupply);
  for (const [field,label] of [['railMileage','铁路里程'],['flightDistance','航程距离']]) if(out[field] && (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(out[field]) || Number(out[field])>100000))throw new Error(label+'须为 0 至 100000 km，可保留三位小数');
  if(out.checkedBaggageCount&&(!/^(?:0|[1-9]\d{0,3})$/.test(out.checkedBaggageCount)||Number(out.checkedBaggageCount)>2997))throw new Error('托运行李件数须为 0 至 2997 的整数');
  for (const field of ['departureTime', 'arrivalTime', 'boardingTime', 'actualDepartureTime', 'actualArrivalTime', 'actualBoardingTime']) if (out[field] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(out[field])) throw new Error('时间请填写 HH:mm');
  for (const field of ['departureZone', 'arrivalZone']) if (out[field] && !isStoredTimeZone(out[field])) throw new Error('请填写有效时区，例如 Asia/Shanghai');
  for (const field of ['offsetX', 'offsetY']) if (!Number.isFinite(Number(out[field])) || Math.abs(Number(out[field])) > 30) throw new Error('排版偏移范围为 -30 至 30');
  if (out.price && !/^\d{1,9}(\.\d{1,2})?$/.test(out.price)) throw new Error('票价请填写正数，最多两位小数');
  out.createdAt = typeof input.createdAt === 'string' ? input.createdAt : now();
  out.updatedAt = typeof input.updatedAt === 'string' ? input.updatedAt : now();
  out.sources = (Array.isArray(input.sources) ? input.sources : []).slice(0, 200).filter(s => s && typeof s === 'object').map(s => ({ kind: String(s.kind || 'manual').slice(0, 80), label: String(s.label || '').slice(0, 300), at: String(s.at || now()).slice(0, 40) }));
  out.sources.sort((a, b) => wireOrder(JSON.stringify(a), JSON.stringify(b)));
  out.lockedFields = [...new Set((Array.isArray(input.lockedFields) ? input.lockedFields : []).filter(f => FIELDS.includes(f) && !['originCity','destinationCity','lookupValues','fieldSources','boardingCodeSource','boardingCodeOperatingFlight'].includes(f)))].sort();
  out.mergedIds = [...new Set((Array.isArray(input.mergedIds) ? input.mergedIds : []).filter(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id) && id !== out.id))].sort();
  if (out.deleted) {
    // Keep only an ID marker for synchronization; there is no recoverable ticket.
    for (const field of FIELDS) if (!['type', 'template', 'deleted'].includes(field)) out[field] = ['lookupValues','fieldSources'].includes(field) ? {} : field === 'ticketMarks' ? [] : '';
    out.sources = []; out.lockedFields = [];
    return out;
  }
  if(out.boardingCodeSource && !['original','generated'].includes(out.boardingCodeSource))throw new Error('条码来源无效');
  if(out.type!=='flight' || !out.boardingCode){out.boardingCode='';out.boardingCodeSource='';out.boardingCodeOperatingFlight='';out.boardingLegIndex='';}
  else {
    out.boardingCodeSource ||= 'original';
    if(out.boardingCodeSource==='original'){
      const boarding=readBoardingCode(out.boardingCode);
      if(boarding){
        if(!/^[0-3]?$/.test(out.boardingLegIndex)||Number(out.boardingLegIndex)>=boarding.legCount)throw new Error('条码航段无效');
        out.boardingLegIndex=String(Number(out.boardingLegIndex));
        const leg=boarding.legs[Number(out.boardingLegIndex)];
        for(const [key,value] of Object.entries(boardingMetadataValues(leg))){out[key]=value;out.fieldSources[key]='barcode';}
        out.departureDate=journeyDate({year:out.departureDate?.year??null,dayOfYear:leg.dayOfYear});out.fieldSources.departureDate='barcode';
      }
    }
    out.boardingCodeOperatingFlight=out.boardingCodeSource==='generated' ? out.boardingCodeOperatingFlight.trim().toUpperCase().replace(/\s/g,'') : '';
    if(out.boardingCodeOperatingFlight)operatingFlight(out.boardingCodeOperatingFlight);
  }
  normalizePlaces(out);
  for (const side of ['origin','destination']) out[side+'City']=cityLabel(out,side);
  if (out.railRoute && !railRouteMatches(out)) out.railRoute = '';
  if (out.railJourney && !railJourneyMatches(out)) {
    if(out.railJourney.distanceQueriedAt && !out.lockedFields.includes('railMileage'))out.railMileage='';
    out.railJourney = '';
  }
  out.lookupValues=Object.fromEntries(Object.entries(out.lookupValues).filter(([key,value])=>JSON.stringify(out[key])===JSON.stringify(value) && !out.lockedFields.includes(key) && out[key]).map(([key])=>[key,out[key]]));
  refreshGeneratedCode(out);
  for(const key of JOURNEY_DATE_FIELDS)if(out[key]?.year&&!out.fieldSources[key+'Year']){
    const source=out.fieldSources[key];if(source&&source!=='barcode')out.fieldSources[key+'Year']=source;
  }
  out.fieldSources=Object.fromEntries(Object.entries(out.fieldSources).filter(([key,kind])=>kind==='manual' || hasFieldValue(sourceFieldValue(out,key))));
  return out;
}
export function archive(records) { return { format: 'xingji-archive', schemaVersion: SCHEMA_VERSION, exportedAt: now(), records: records.map(validateRecord) }; }
export function readArchive(input) {
  if (!input || input.format !== 'xingji-archive' || input.schemaVersion !== SCHEMA_VERSION || !Array.isArray(input.records)) throw new Error('档案格式无效');
  const records = input.records.map(validateRecord);
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('备份包含重复ID');
  return records;
}
const normalized = value => String(value || '').normalize('NFKC').replace(/[\s·]/g, '').toUpperCase();
const recordIds = record => [record.id, ...(record.mergedIds || [])];
const bucketKey = r => fullDate(r.departureDate) && r.service ? `${r.type}:${r.type === 'flight' ? (r.flightStatus || 'normal') + ':' : isRefundReceipt(r) ? 'refund:' : ''}${calendarDate(r.departureDate)}:${normalized(r.service)}` : '';
function sameJourney(a, b) {
  if (a.deleted || b.deleted || !bucketKey(a) || bucketKey(a) !== bucketKey(b)) return false;
  if (a.passenger && b.passenger && normalized(a.passenger) !== normalized(b.passenger)) return false;
  if (a.departureTime && b.departureTime && a.departureTime !== b.departureTime) return false;
  let endpoints = 0;
  for (const side of ['origin', 'destination']) {
    const x = placeIdentity(a, side), y = placeIdentity(b, side);
    if (a[side] && b[side] && (!x || !y)) return false;
    if (x && y) { if (x !== y) return false; endpoints++; }
  }
  if (endpoints < 2 && !(endpoints && a.ticketNumber && normalized(a.ticketNumber) === normalized(b.ticketNumber))) return false;
  if (!a.passenger || !b.passenger) {
    if (a.seat && b.seat && normalized(a.seat) !== normalized(b.seat) && a.lockedFields.includes('seat') === b.lockedFields.includes('seat')) return false;
    if (a.carriage && b.carriage && normalized(a.carriage) !== normalized(b.carriage) && a.lockedFields.includes('carriage') === b.lockedFields.includes('carriage')) return false;
    if (a.ticketNumber && b.ticketNumber && normalized(a.ticketNumber) !== normalized(b.ticketNumber)) return false;
  }
  return true;
}
export function duplicateOf(records, candidate) {
  const ids = new Set(recordIds(candidate));
  const exact = records.find(r => recordIds(r).some(id => ids.has(id)));
  if (exact) return exact;
  let matches = records.filter(r => sameJourney(r, candidate));
  if (candidate.passenger) {
    const named = matches.filter(r => normalized(r.passenger) === normalized(candidate.passenger));
    if (named.length) matches = named;
  }
  return matches.length === 1 ? matches[0] : undefined;
}
function joinRecords(existing, incoming) {
  const empty = value => !value || (Array.isArray(value) && !value.length);
  for (const field of FIELDS) {
    if (['lookupValues','fieldSources'].includes(field) || BOARDING_FIELDS.includes(field) || field === 'deleted' || existing.lockedFields.includes(field)) continue;
    if (incoming.lockedFields.includes(field) || (empty(existing[field]) && !empty(incoming[field]))) takeField(existing,incoming,field);
  }
  if(!existing.lockedFields.includes('boardingCode') && (incoming.lockedFields.includes('boardingCode') || !existing.boardingCode))takeBoardingCode(existing,incoming);
  const ids = [...new Set([...recordIds(existing), ...recordIds(incoming)])].sort();
  existing.id = ids[0]; existing.mergedIds = ids.slice(1);
  existing.deleted ||= incoming.deleted;
  existing.sources = union(existing.sources, incoming.sources);
  existing.lockedFields = union(existing.lockedFields, incoming.lockedFields);
  existing.createdAt = [existing.createdAt, incoming.createdAt].sort()[0];
  existing.updatedAt = [existing.updatedAt, incoming.updatedAt].sort().at(-1);
  return existing;
}
export function deduplicateRecords(records) {
  const result = [], buckets = new Map(), ids = new Map(), positions = new Map();
  // Known passengers are grouped first so an unnamed scan cannot join two different people.
  const ordered = records.map((record, index) => ({ record: validateRecord(record), index })).sort((a, b) => Number(!!b.record.passenger) - Number(!!a.record.passenger) || a.index - b.index);
  for (const { record, index } of ordered) {
    const bucket = bucketKey(record);
    const exact = recordIds(record).map(id => ids.get(id)).find(Boolean);
    const existing = exact || (bucket ? duplicateOf(buckets.get(bucket) || [], record) : undefined);
    const target = existing ? joinRecords(existing, record) : record;
    if (!existing) { result.push(target); positions.set(target, index); }
    else positions.set(target, Math.min(positions.get(target), index));
    for (const id of recordIds(target)) ids.set(id, target);
    const targetBucket = bucketKey(target);
    if (targetBucket) {
      if (!buckets.has(targetBucket)) buckets.set(targetBucket, []);
      if (!buckets.get(targetBucket).includes(target)) buckets.get(targetBucket).push(target);
    }
  }
  return result.sort((a, b) => positions.get(a) - positions.get(b)).map(validateRecord);
}
export function applyImport(records, candidates) {
  const before = new Map(records.flatMap(r => recordIds(r).map(id => [id, r])));
  const result = deduplicateRecords([...records, ...candidates]);
  let added = 0, enriched = 0;
  for (const record of result) {
    const previous = recordIds(record).map(id => before.get(id)).find(Boolean);
    if (!previous) added++;
    else if (JSON.stringify(record) !== JSON.stringify(previous)) { record.updatedAt = now(); enriched++; }
  }
  return { records: result, added, enriched };
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function union(a = [], b = []) { return [...new Map([...a, ...b].map(x => [JSON.stringify(x), x])).values()].sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y))); }
function alignMergedIds(...collections) {
  const parents = new Map();
  const find = id => { if (!parents.has(id)) parents.set(id, id); if (parents.get(id) !== id) parents.set(id, find(parents.get(id))); return parents.get(id); };
  for (const record of collections.flat()) for (const id of recordIds(record)) {
    const a = find(record.id), b = find(id); if (a !== b) parents.set(a < b ? b : a, a < b ? a : b);
  }
  const groups = new Map();
  for (const id of parents.keys()) { const root = find(id); if (!groups.has(root)) groups.set(root, []); groups.get(root).push(id); }
  return collections.map(records => records.map(record => { const id = find(record.id); return { ...record, id, mergedIds: groups.get(id).filter(other => other !== id).sort() }; }));
}
export function mergeThreeWay(baseRecords, localRecords, remoteRecords) {
  [baseRecords, localRecords, remoteRecords] = alignMergedIds(baseRecords, localRecords, remoteRecords);
  const base = new Map(baseRecords.map(r => [r.id, r]));
  const local = new Map(localRecords.map(r => [r.id, r]));
  const remote = new Map(remoteRecords.map(r => [r.id, r]));
  const records = []; const conflicts = [];
  for (const id of new Set([...base.keys(), ...local.keys(), ...remote.keys()])) {
    const b = base.get(id), l = local.get(id), r = remote.get(id);
    if (!l) { if (r) records.push(clone(r)); continue; }
    if (!r) { records.push(clone(l)); continue; }
    if (l.deleted || r.deleted) {
      const kept = l.deleted ? r : l;
      const changed = !kept.deleted && b && FIELDS.some(field => field !== 'deleted' && !equal(kept[field], b[field]));
      const merged = { ...clone(kept), deleted: true, mergedIds: union(l.mergedIds, r.mergedIds).filter(other => other !== id).sort(), updatedAt: [l.updatedAt, r.updatedAt].sort().at(-1) };
      if (changed) conflicts.push({ id, field: 'deleted', base: b.deleted, local: l.deleted, remote: r.deleted, context: { local: clone(l), remote: clone(r) } });
      records.push(changed ? merged : validateRecord(merged));
      continue;
    }
    const merged = clone(l);
    merged.lockedFields = union(l.lockedFields, r.lockedFields);
    for (const field of FIELDS.filter(key=>!['lookupValues','fieldSources'].includes(key) && !BOARDING_FIELDS.includes(key))) {
      const lv = l[field], rv = r[field], bv = b?.[field];
      const ls=fieldState(l,field),rs=fieldState(r,field),bs=fieldState(b,field);
      if(equal(lv,rv)){
        const owner=r.lockedFields.includes(field) || (isAutomatic(l,field) && !isAutomatic(r,field)) ? r : l;
        takeField(merged,owner,field);continue;
      }
      if(equal(rs,bs)){takeField(merged,l,field);continue;}
      if (!b) {
        const empty = value => !value || (Array.isArray(value) && !value.length);
        const ll = l.lockedFields.includes(field), rl = r.lockedFields.includes(field);
        if (empty(lv) && !ll) { takeField(merged,r,field); continue; }
        if (empty(rv) && !rl) { takeField(merged,l,field); continue; }
        if (ll !== rl) { takeField(merged,rl ? r : l,field); continue; }
        if (['template', 'provenance', 'offsetX', 'offsetY', 'departureZone', 'arrivalZone'].includes(field) && !ll && !rl) continue;
      }
      if (equal(ls,bs))takeField(merged,r,field);
      else {
        takeField(merged,l,field);
        conflicts.push({id,field,base:bv,local:lv,remote:rv,fieldSources:{local:l.fieldSources[field],remote:r.fieldSources[field]},...(LOOKUP_FIELDS.includes(field) ? {context:{local:clone(l),remote:clone(r)}} : {})});
      }
    }
    merged.sources = union(l.sources, r.sources);
    mergeBoardingCode(b,l,r,merged,conflicts);
    if(!conflicts.some(conflict=>conflict.id===id))refreshGeneratedCode(merged);
    merged.mergedIds = union(l.mergedIds, r.mergedIds).filter(id => id !== merged.id).sort();
    merged.updatedAt = [l.updatedAt, r.updatedAt].sort().at(-1);
    records.push(merged);
  }
  return { records, conflicts };
}
const wireOrder = (a, b) => a < b ? -1 : a > b ? 1 : 0;
export const yearOf = r => String(journeyDate(r.departureDate)?.year || 'unknown');
export function partition(records) {
  const years = {};
  for (const record of records) (years[yearOf(record)] ||= []).push(record);
  for (const rs of Object.values(years)) rs.sort((a, b) => wireOrder(a.id, b.id));
  return years;
}
export function formatDate(value) { return value ? dateLabel(value) : '日期待补充'; }
