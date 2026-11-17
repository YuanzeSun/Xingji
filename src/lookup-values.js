import {JOURNEY_DATE_FIELDS,journeyDate} from './journey-date.js';
import {placeIdentity} from './places.js';
import {markFieldSources,importFieldSource} from './field-sources.js';
import {ACTUAL_FLIGHT_FIELDS} from './flight-times.js';
import {barcodeFieldLocked} from './barcode-fields.js';

export const LOOKUP_FIELDS = ['railBureau','railModel','railTrainsets','railPowerSupply','railMileage','railRunner','railCarOwner','railPlatform','departureTime','arrivalDate','arrivalTime',...ACTUAL_FLIGHT_FIELDS,'flightDistance','airline','aircraft','terminal','gate','origin','destination','originCode','destinationCode'];
export const isLookupValue = (record,key) => Object.hasOwn(record.lookupValues || {},key) && JSON.stringify(record.lookupValues[key]) === JSON.stringify(record[key]) && !record.lockedFields?.includes(key);
export function normalizeLookupValues(input) {
  if(!input)return {};
  if(typeof input!=='object' || Array.isArray(input))throw new Error('自动补全来源格式不正确');
  const result={};
  for(const key of Object.keys(input).sort()){
    if(JOURNEY_DATE_FIELDS.includes(key)){result[key]=journeyDate(input[key]);continue;}
    if(!LOOKUP_FIELDS.includes(key) || typeof input[key]!=='string' || input[key].length>1000)throw new Error('自动补全来源字段不正确');
    result[key]=input[key];
  }
  return result;
}
export function markManualFields(record,fields) {
  fields=fields.filter(key=>!barcodeFieldLocked(record,key));
  markFieldSources(record,fields,'manual');
  record.lookupValues={...record.lookupValues};
  const locked=new Set(record.lockedFields || []);
  for(const key of fields){locked.add(key);delete record.lookupValues[key];}
  record.lockedFields=[...locked].sort();
}
export function applyLookupValues(record,changes,automatic=true,source) {
  changes=Object.fromEntries(Object.entries(changes).filter(([key])=>!barcodeFieldLocked(record,key)));
  record.lookupValues={...record.lookupValues};
  changes=Object.fromEntries(Object.entries(changes).map(([key,value])=>[key,JOURNEY_DATE_FIELDS.includes(key)?journeyDate(value):value]));
  Object.assign(record,changes);
  markFieldSources(record,Object.keys(changes),automatic ? importFieldSource(source?.kind) || 'lookup' : 'manual');
  markFieldSources(record,Object.keys(changes).filter(key=>JOURNEY_DATE_FIELDS.includes(key)).map(key=>key+'Year'),automatic ? importFieldSource(source?.kind) || 'lookup' : 'manual');
  if(!automatic)for(const key of Object.keys(changes))if(!changes[key] && !record.lockedFields?.includes(key))delete record.fieldSources[key];
  for(const [key,value] of Object.entries(changes))if(LOOKUP_FIELDS.includes(key)){
    if(automatic && value && !record.lockedFields?.includes(key))record.lookupValues[key]=value;
    else delete record.lookupValues[key];
  }
}
export function lookupContext(record) {
  return JSON.stringify([record.type,record.template==='rail-refund-receipt',String(record.service || '').replace(/\s/g,'').toUpperCase(),record.departureDate,...['origin','destination'].map(side=>placeIdentity(record,side) || record[side])]);
}
export function clearLookupValues(record) {
  const changes={};
  for(const key of Object.keys(record.lookupValues || {}))if(isLookupValue(record,key)){record[key]='';changes[key]='';}
  record.lookupValues={};record.railJourney='';record.railRoute='';
  record.fieldSources={...record.fieldSources};
  for(const key of [...Object.keys(changes),'railJourney','railRoute'])delete record.fieldSources[key];
  return changes;
}
