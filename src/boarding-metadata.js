const baggageLabels = {
  baggageTagNumbers: '行李牌号', checkedBaggageCount: '托运行李件数',
  checkedBaggageWeight: '托运行李总重（kg）'
};
export const BOARDING_METADATA_LABELS = {
  ...baggageLabels, frequentFlyerCarrier: '常旅客计划航司', frequentFlyerNumber: '常旅客会员号', marketingCarrier: '营销航司'
};
export const BOARDING_METADATA_FIELDS=Object.keys(BOARDING_METADATA_LABELS);
export const BOARDING_BAGGAGE_FIELDS = Object.keys(baggageLabels);
export const flightTicketNumber = value => String(value || '').normalize('NFKC').replace(/[\s-]/g, '')
  .match(/^(\d{13})(?:\/\d{1,2})?$/)?.[1] || '';
export function boardingMetadataValues(read) {
  const values={};
  for(const key of ['frequentFlyerCarrier','frequentFlyerNumber','marketingCarrier'])if(read[key])values[key]=read[key];
  if(read.legIndex === 0 && read.baggageSeries?.length){
    values.checkedBaggageCount=String(read.baggageSeries.reduce((total,series)=>total+series.count,0));
    values.baggageTagNumbers=read.baggageSeries.map(({number,count})=>count===1 ? number : number+'–'+String(Number(number)+count-1).padStart(10,'0')).join(' / ');
  }
  return values;
}
