import {LOOKUP_FIELDS,isLookupValue} from './lookup-values.js';
import {BOARDING_FIELDS,generatedCodeSettings} from './boarding-code-state.js';
import {copyFieldSource} from './field-sources.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

function copyFieldLock(target,source,field) {
  target.lockedFields=(target.lockedFields || []).filter(key=>key!==field);
  if(source.lockedFields?.includes(field))target.lockedFields.push(field);
  target.lockedFields.sort();
}

export function fieldState(record,field,trackFieldLock=false) {
  if(!record)return undefined;
  if(!LOOKUP_FIELDS.includes(field)) {
    if(!trackFieldLock)return record[field];
    return {value:record[field],locked:record.lockedFields?.includes(field) || false,source:record.fieldSources?.[field]};
  }
  return {value:record[field],manual:record.lockedFields?.includes(field) || false,lookup:isLookupValue(record,field),
    ...(trackFieldLock && {source:record.fieldSources?.[field]})};
}
export function takeField(target,source,field,trackFieldLock=false) {
  if (source[field] === undefined) delete target[field];
  else target[field]=structuredClone(source[field]);
  copyFieldSource(target,source,field);
  if(LOOKUP_FIELDS.includes(field)){
    target.lookupValues={...target.lookupValues};
    if(isLookupValue(source,field))target.lookupValues[field]=source[field];
    else delete target.lookupValues[field];
  }else if(!trackFieldLock)return;
  copyFieldLock(target,source,field);
}
export function takeBoardingCode(target,source) {
  for(const field of BOARDING_FIELDS)target[field]=structuredClone(source[field] || '');
  copyFieldSource(target,source,'boardingCode');
  copyFieldLock(target,source,'boardingCode');
}
function boardingState(record) {
  if(!record)return undefined;
  const settings=generatedCodeSettings(record);
  return settings ? {generated:settings} : {original:record.boardingCode || '',legIndex:record.boardingLegIndex || ''};
}
export function mergeBoardingCode(base,local,remote,merged,conflicts) {
  const l=boardingState(local),r=boardingState(remote),b=boardingState(base);
  if(same(l,r) || same(r,b)){takeBoardingCode(merged,local);return;}
  if(same(l,b) || (!base && !local.boardingCode && !local.lockedFields?.includes('boardingCode'))){takeBoardingCode(merged,remote);return;}
  if(!base && !remote.boardingCode && !remote.lockedFields?.includes('boardingCode')){takeBoardingCode(merged,local);return;}
  conflicts.push({id:merged.id,field:'boardingCode',base:base?.boardingCode,local:local.boardingCode,remote:remote.boardingCode,context:{local:structuredClone(local),remote:structuredClone(remote)}});
}
export function resolveRecordConflict(record,conflict,choice) {
  choice=choice==='remote' ? 'remote' : 'local';
  const source=conflict.context?.[choice];
  if(conflict.field==='boardingCode' && source)takeBoardingCode(record,source);
  else if(source && (conflict.trackFieldLock || LOOKUP_FIELDS.includes(conflict.field)))takeField(record,source,conflict.field,conflict.trackFieldLock);
  else {
    record[conflict.field]=structuredClone(conflict[choice]);
    record.fieldSources={...record.fieldSources};
    const kind=conflict.fieldSources?.[choice];
    if(kind)record.fieldSources[conflict.field]=kind;else delete record.fieldSources[conflict.field];
  }
}
