import {journeyDate} from './journey-date.js';
import {boardingCodeDefaults,readBoardingCode,createBoardingCode,encodeBCBP} from './bcbp.js';
import {hasChineseName} from './flight-passenger.js';
import {markFieldSources} from './field-sources.js';

export const BOARDING_FIELDS=['boardingCode','boardingCodeSource','boardingCodeOperatingFlight','boardingLegIndex'];
export const BOARDING_SHARED_FIELDS=['passenger','pnr','origin','destination','originCode','destinationCode','service','departureDate','seat','seatClass'];
export function operatingFlight(value) {
  const text=String(value || '').trim().toUpperCase();
  if(!text)return null;
  const match=text.match(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\s*(\d{1,4}[A-Z]?)$/);
  if(!match)throw new Error('请填写完整的实际承运航班，如 CA1234');
  return {carrier:match[1],flightNumber:match[2]};
}
export function generatedCodeSettings(record) {
  if(record.boardingCodeSource!=='generated' || !record.boardingCode)return null;
  const saved=readBoardingCode(record.boardingCode,record.boardingLegIndex);
  if(!saved)throw new Error('生成条码的基础数据无效，请重新生成或移除条码');
  return {sequence:saved.sequence,status:saved.status,electronic:saved.electronic,format:saved.format,operatingFlight:record.boardingCodeOperatingFlight || ''};
}
export function clearGeneratedCode(record) {
  if(record.boardingCodeSource!=='generated')return false;
  for(const key of BOARDING_FIELDS)record[key]='';
  markFieldSources(record,['boardingCode'],'generated');
  return true;
}
export function refreshGeneratedCode(record) {
  if(record.type!=='flight')return false;
  const settings=generatedCodeSettings(record);
  if(!settings)return false;
  try {
    const values={...boardingCodeDefaults(record,{useSaved:false}),...settings,...operatingFlight(settings.operatingFlight)};
    if(btoa(encodeBCBP(values))===record.boardingCode.rawBytes)return false;
    record.boardingCode=createBoardingCode(values,settings.format);
    markFieldSources(record,['boardingCode'],'generated');
    return true;
  } catch {
    return clearGeneratedCode(record);
  }
}
const upper=value=>String(value || '').normalize('NFKC').replace(/\s/g,'').toUpperCase();
const seat=value=>upper(value).replace(/^0+/,'') || upper(value);
export function boardingCodeDifferences(record) {
  if(record.boardingCodeSource==='generated')return [];
  const saved=readBoardingCode(record.boardingCode,record.boardingLegIndex);if(!saved)return [];
  const current=boardingCodeDefaults(record,{useSaved:false}),differences=[];
  for(const [key,label] of [['origin','出发机场'],['destination','到达机场'],['pnr','PNR']])if(current[key] && saved[key] && upper(current[key])!==upper(saved[key]))differences.push(label);
  if(current.seat && saved.seat && seat(current.seat)!==seat(saved.seat))differences.push('座位');
  if(current.carrier && current.flightNumber && upper(current.carrier)+upper(current.flightNumber).replace(/^0+(?=\d)/,'')!==upper(saved.service))differences.push('航班（请核对是否代码共享）');
  if(current.date && journeyDate(current.date).dayOfYear!==saved.dayOfYear)differences.push('出发日期');
  const name=value=>upper(value).replace(/[^A-Z]/g,'');
  if(current.passenger && saved.passenger && !name(current.passenger).startsWith(name(saved.passenger)) && !name(saved.passenger).startsWith(name(current.passenger)))differences.push('英文姓名');
  if(hasChineseName(record.passenger) && saved.passengerChinese && upper(record.passenger)!==upper(saved.passengerChinese))differences.push('中文姓名');
  return differences;
}
