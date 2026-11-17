export const BOARDING_METADATA_LABELS={baggageTagNumbers:'行李牌号',checkedBaggageCount:'托运行李件数',freeBaggageAllowance:'免费行李额',frequentFlyerCarrier:'常旅客计划航司',frequentFlyerNumber:'常旅客会员号',marketingCarrier:'营销航司'};
export const BOARDING_METADATA_FIELDS=Object.keys(BOARDING_METADATA_LABELS);
export function boardingMetadataValues(read) {
  const values={};
  for(const key of ['freeBaggageAllowance','frequentFlyerCarrier','frequentFlyerNumber','marketingCarrier'])if(read[key])values[key]=read[key];
  if(read.recordedBoardingTime)values.actualBoardingTime=read.recordedBoardingTime;
  if(read.baggageSeries?.length){
    values.checkedBaggageCount=String(read.baggageSeries.reduce((total,series)=>total+series.count,0));
    values.baggageTagNumbers=read.baggageSeries.map(({number,count})=>count===1 ? number : number+'–'+String(Number(number)+count-1).padStart(10,'0')).join(' / ');
  }
  return values;
}
