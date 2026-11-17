import {resolvePlace} from './places.js';

export const hasChineseName=value=>/\p{Script=Han}/u.test(value || '');
const nameKey=value=>String(value || '').normalize('NFKC').toUpperCase().replace(/[^A-Z\p{Script=Han}]/gu,'');

export function flightNameLanguage(record) {
  const origin=resolvePlace(record,'origin'),destination=resolvePlace(record,'destination');
  if(origin.status!=='matched' || destination.status!=='matched')return '';
  return origin.country==='CN' && destination.country==='CN' ? 'zh' : 'en';
}

export function flightPassengerName(record,code={}) {
  const current=record.passenger || '',language=flightNameLanguage(record);
  // A manual correction must not be replaced by a different passenger from a scan.
  if(current && record.boardingCodeSource!=='generated' && ![code.passenger,code.passengerChinese].some(name=>name && nameKey(name)===nameKey(current)))return current;
  if(code.passengerChinese)return code.passengerChinese;
  const chinese=hasChineseName(current) ? current : code.passengerChinese || '';
  const english=current && !hasChineseName(current) ? current : code.passenger || '';
  return language==='zh' ? chinese || english : language==='en' ? english || chinese : current || english || chinese;
}
