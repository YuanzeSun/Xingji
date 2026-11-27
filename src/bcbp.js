import { codeBytes, normalizeCodeData, symbolFromCodeData } from './barcode-data.js';
import { resolvePlace } from './places.js';
import {readBCBP} from './bcbp-reader.js';
import {hasChineseName} from './flight-passenger.js';
import {airlineNameForCode} from './airline-codes.js';
import {journeyDate} from './journey-date.js';
import {maskBoardingIdentity} from './identity.js';

export const BCBP_FORMATS = ['PDF417','Aztec','QRCode','DataMatrix'];
const identifiers={PDF417:']L2',Aztec:']z0',QRCode:']Q1',DataMatrix:']d1'};
const upper=value=>String(value ?? '').normalize('NFKC').trim().toUpperCase();
function field(value,pattern,label,key) {
  const text=upper(value);
  if(!pattern.test(text)){const error=new Error(label);if(key)error.fields=[key];throw error;}
  return text;
}
function flightDay(value) {
  const date=journeyDate(value);
  if(!date?.dayOfYear)throw new Error('请填写航班月日');
  return String(date.dayOfYear).padStart(3,'0');
}

// Single-leg Format M, with the NI extension found on domestic boarding passes.
// IATA Resolution 792 / BCBP Implementation Guide, plus independent decoder fixtures.
export function encodeBCBP(input) {
  const passenger=field(input.passenger,/^[A-Z][A-Z .'-]*\/[A-Z .'-]+$/,'请按“姓/名”填写英文姓名，最多 20 个字符','passenger');
  if(passenger.length>20){const error=new Error('条码英文姓名最多 20 个字符，请按原登机牌缩写填写');error.fields=['passenger'];throw error;}
  const pnr=field(input.pnr,/^[A-Z0-9]{1,7}$/,'请填写 1 至 7 位订座编号 PNR','pnr');
  const origin=field(input.origin,/^[A-Z]{3}$/,'请填写三位出发机场代码','origin'),destination=field(input.destination,/^[A-Z]{3}$/,'请填写三位到达机场代码','destination');
  if(origin===destination)throw new Error('出发与到达机场不能相同');
  const carrier=field(input.carrier,/^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])$/,'请填写实际承运航司的二位或三位代码','service');
  const number=field(input.flightNumber,/^\d{1,4}[A-Z]?$/,'航班数字须为 1 至 4 位，可带一位英文后缀','service'),flight=number.match(/^(\d+)([A-Z]?)$/);
  // Preserve the recorded one-letter code, including issuer-specific values.
  const cabin=field(input.cabin,/^[A-Z]$/,'生成条码时，舱位代码须为单个英文字母','seatClass');
  const seat=field(input.seat,/^[A-Z0-9]{1,4}$/,'请填写最多四位座位代码，如 12A 或 INF','seat');
  const sequence=field(input.sequence,/^[A-Z0-9]{1,5}$/,'请填写最多五位值机序号');
  const status=field(input.status,/^[0-9]$/,'请填写一位旅客状态代码，如 1 表示已值机');
  const electronic=upper(input.electronic);
  if(!['','E'].includes(electronic))throw new Error('电子客票标记须为 E 或空白');
  const identity=maskBoardingIdentity(input.identity);
  const route={type:'flight',origin,destination};
  const domestic=identity && ['origin','destination'].every(side=>resolvePlace(route,side).country==='CN');
  const variable=domestic ? '>80000NI'+identity : '';
  const length=variable.length.toString(16).toUpperCase().padStart(2,'0');
  return 'M1'+passenger.padEnd(20,' ')+(electronic || ' ')+pnr.padEnd(7,' ')+origin+destination+carrier.padEnd(3,' ')+flight[1].padStart(4,'0')+(flight[2] || ' ')+flightDay(input.date || '')+cabin+(/^\d+[A-Z]?$/.test(seat) ? seat.padStart(4,'0') : seat.padEnd(4,' '))+(/^\d+$/.test(sequence) ? sequence.padStart(5,'0') : sequence.padEnd(5,' '))+status+length+variable;
}

export function createBoardingCode(input,format='PDF417') {
  if(!BCBP_FORMATS.includes(format))throw new Error('请选择支持的登机牌二维条码格式');
  const payload=encodeBCBP(input);
  const code=normalizeCodeData({version:1,format,rawBytes:btoa(payload),symbologyIdentifier:identifiers[format],gs1:false,eci:[],parameters:{symbolVersion:'',errorCorrectionLevel:'',mask:null}});
  symbolFromCodeData(code);
  return code;
}

export function readBoardingCode(code,legIndex=0) {
  try {
    if(!code)return null;
    const text=String.fromCharCode(...codeBytes(code.rawBytes));
    const read=readBCBP(text);
    if(!read||!read.legs[Number(legIndex)])return null;
    const legs=read.legs.map(leg=>({...leg,origin:leg.originCode,destination:leg.destinationCode,airline:airlineNameForCode(leg.carrier),format:code.format,legCount:read.legCount}));
    return {...legs[Number(legIndex)],legs};
  }catch{return null;}
}
export function boardingCodeDefaults(record,{useSaved=true,profile}={}) {
  const original=readBoardingCode(record.boardingCode,record.boardingLegIndex) || {},saved=useSaved ? original : {},flight=upper(record.service).match(/^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\s*(\d{1,4}[A-Z]?)$/);
  const airport=side=>{const place=resolvePlace(record,side);return place.status==='matched' ? place.code : /^[A-Z]{3}$/.test(upper(record[side+'Code'])) ? upper(record[side+'Code']) : '';};
  const profileName=record.passenger && record.passenger===profile?.chineseName ? [profile.lastName,profile.firstName].filter(Boolean).join('/') : '';
  const name=upper(hasChineseName(record.passenger) ? original.passenger || profileName : record.passenger),cabins={'经济舱':'Y','超级经济舱':'W','公务舱':'C','头等舱':'F'};
  const recordedCabin=upper(record.seatClass),cabin=recordedCabin ? cabins[recordedCabin] || recordedCabin : 'Y';
  return {format:saved.format || 'PDF417',electronic:saved.electronic ?? '',passenger:/^[A-Z][A-Z .'-]*\/[A-Z .'-]+$/.test(name) ? name : saved.passenger || '',pnr:record.pnr || saved.pnr || '',origin:airport('origin') || saved.origin || '',destination:airport('destination') || saved.destination || '',carrier:saved.carrier || flight?.[1] || '',flightNumber:saved.flightNumber || flight?.[2] || '',date:journeyDate(record.departureDate),cabin:saved.cabin || cabin,seat:record.seat || saved.seat || '',sequence:saved.sequence || '',status:saved.status || '1',identity:record.identity};
}
