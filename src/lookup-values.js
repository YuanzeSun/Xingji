import {JOURNEY_DATE_FIELDS,journeyDate,storedJourneyDate} from './journey-date.js';
import {placeIdentity} from './places.js';
import {markFieldSources,importFieldSource,isRailLookupSource,railTimetableSource} from './field-sources.js';
import {ACTUAL_FLIGHT_FIELDS} from './flight-times.js';
import {ticketFieldLocked} from './barcode-fields.js';

export const LOOKUP_FIELDS = ['railBureau','railModel','railTrainsets','railPowerSupply','railMileage','railRunner','railCarOwner','railPlatform','departureTime','arrivalDate','arrivalTime','boardingTime',...ACTUAL_FLIGHT_FIELDS,'flightDistance','airline','marketingCarrier','aircraft','aircraftRegistration','departureTerminal','arrivalTerminal','gate','origin','destination','originCode','destinationCode'];
export const isLookupValue = (record,key) => Object.hasOwn(record.lookupValues || {},key) && JSON.stringify(record.lookupValues[key]) === JSON.stringify(record[key]) && !record.lockedFields?.includes(key);
export function normalizeLookupValues(input) {
  if(!input)return {};
  if(typeof input!=='object' || Array.isArray(input))throw new Error('自动补全来源格式不正确');
  const result={};
  for(const key of Object.keys(input).sort()){
    if(!LOOKUP_FIELDS.includes(key))throw new Error('自动补全来源字段不正确');
    if(JOURNEY_DATE_FIELDS.includes(key)){result[key]=storedJourneyDate(input[key]);continue;}
    if(typeof input[key]!=='string' || input[key].length>1000)throw new Error('自动补全来源字段不正确');
    result[key]=input[key];
  }
  return result;
}
export function markManualFields(record,fields) {
  fields=fields.filter(key=>!ticketFieldLocked(record,key));
  markFieldSources(record,fields,'manual');
  record.lookupValues={...record.lookupValues};
  const locked=new Set(record.lockedFields || []);
  for(const key of fields){locked.add(key);delete record.lookupValues[key];}
  record.lockedFields=[...locked].sort();
}
export function applyLookupValues(record,changes,automatic=true,source) {
  changes=Object.fromEntries(Object.entries(changes)
    .filter(([key]) => !ticketFieldLocked(record, key))
    .map(([key,value])=>[key,JOURNEY_DATE_FIELDS.includes(key) ? journeyDate(value) : value]));
  if (source?.replace?.length) record.lockedFields = record.lockedFields.filter(key =>
    !source.replace.includes(key) || !Object.hasOwn(changes, key));
  record.lookupValues={...record.lookupValues};
  Object.assign(record,changes);
  const fields=Object.keys(changes);
  const years=fields.filter(key=>JOURNEY_DATE_FIELDS.includes(key)).map(key=>key+'Year');
  const kind = automatic ? importFieldSource(source?.kind) || 'lookup' : 'manual';
  markFieldSources(record,[...fields,...years],kind);
  if (isRailLookupSource(kind) && changes.railJourney) {
    const timetableKind = importFieldSource(railTimetableSource(changes.railJourney));
    if (timetableKind !== kind) markFieldSources(record, ['railJourney'], timetableKind);
  }
  if (isRailLookupSource(kind) && source.dataDate) {
    record.railFieldDates = { ...record.railFieldDates };
    for (const key of fields) if (changes[key] && LOOKUP_FIELDS.includes(key)) {
      const date = source.fieldDates?.[key] || source.dataDate;
      record.railFieldDates[key] = date;
      if (JOURNEY_DATE_FIELDS.includes(key)) record.railFieldDates[key+'Year'] = date;
    }
  }
  if(!automatic)for(const key of fields)if(!changes[key] && !record.lockedFields?.includes(key))delete record.fieldSources[key];
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
  delete record.flightStop;
  const fields = [...Object.keys(changes),'railJourney','railRoute','flightStop'];
  const removed = [...fields, ...fields.filter(key => JOURNEY_DATE_FIELDS.includes(key)).map(key => key+'Year')];
  record.fieldSources={...record.fieldSources};
  if (record.railFieldDates) record.railFieldDates = { ...record.railFieldDates };
  for (const key of removed) {
    delete record.fieldSources[key];
    if (record.railFieldDates) delete record.railFieldDates[key];
  }
  return changes;
}
