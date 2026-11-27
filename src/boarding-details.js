import {escape as e} from './html.js';
import {readBoardingCode} from './bcbp.js';
import {airlineNameForCode} from './airline-codes.js';
import {BOARDING_METADATA_FIELDS} from './boarding-metadata.js';
import {resolvePlace} from './places.js';

export function boardingMetadataDetails(record) {
  return BOARDING_METADATA_FIELDS.filter(key=>record[key]).map(key=>{
    const value=record[key];
    if (key.endsWith('Carrier')) return [key, airlineNameForCode(value) || value];
    if (key === 'checkedBaggageCount') return [key, `${value} 件`];
    if (key === 'checkedBaggageWeight') return [key, `${value} kg`];
    return [key, value];
  });
}
export function boardingJourneyMarkup(record,records=[]) {
  const code=record.type==='flight'&&readBoardingCode(record.boardingCode,record.boardingLegIndex);
  if(!code||code.legCount<2)return '';
  const name=value=>resolvePlace({type:'flight',origin:value},'origin').name||value;
  return `<section class="boarding-journey"><h3>联程航段</h3><ol>${code.legs.map((leg,index)=>{
    const match=records.find(other=>!other.deleted&&other.boardingCode?.rawBytes===record.boardingCode.rawBytes&&Number(other.boardingLegIndex)===index);
    const label=`<strong>${e(leg.service)}</strong><span>${e(name(leg.origin))} → ${e(name(leg.destination))}</span>`;
    return `<li${index===Number(record.boardingLegIndex)?' class="current"':''}>${match&&match.id!==record.id ? `<button type="button" data-action="view" data-id="${e(match.id)}">${label}</button>` : `<div>${label}${index===Number(record.boardingLegIndex)?'<small>本段</small>':''}</div>`}</li>`;
  }).join('')}</ol></section>`;
}
