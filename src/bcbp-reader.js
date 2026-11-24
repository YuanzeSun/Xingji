const hexadecimal=value=>/^[\dA-F]{2}$/.test(value);
const carrier=value=>/^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])$/.test(value);

// Byte offsets apply to the raw one-byte string, including airline extensions.
export function readBCBP(value) {
  if(typeof value!=='string'||value.length<60||value.length>8192||!/^M[1-4][\x20-\x7e]{21}/.test(value))return null;
  const passenger=value.slice(2,22).trim(),electronic=value[22].trim(),count=Number(value[1]);
  if(!/^[A-Z][A-Z /.'-]*$/.test(passenger)||!['E',' '].includes(value[22]))return null;
  const shared={passenger,electronic},legs=[];let offset=23;
  for(let index=0;index<count;index++){
    const fixed=value.slice(offset,offset+35),length=value.slice(offset+35,offset+37);
    if(!/^[\x20-\x7e]{35}$/.test(fixed)||!hexadecimal(length))return null;
    const end=offset+37+parseInt(length,16);if(end>value.length)return null;
    const leg=readLeg(fixed);if(!leg)return null;
    const variable=value.slice(offset+37,end),optional=readConditional(variable,index===0,shared);
    legs.push({...leg,...optional,...readAirlineExtras(variable),legIndex:index});offset=end;
  }
  // Some domestic issuers append their tagged section after the standard block.
  if(count===1)Object.assign(legs[0],readAirlineExtras(value.slice(offset)));
  const complete=legs.map(leg=>({...shared,...leg}));
  return {...complete[0],legs:complete,legCount:count};
}
function readLeg(value) {
  const pnr=value.slice(0,7).trim(),originCode=value.slice(7,10),destinationCode=value.slice(10,13),airline=value.slice(13,16).trim(),flight=value.slice(16,21).trim();
  const day=value.slice(21,24),cabin=value[24],seat=value.slice(25,29).trim(),sequence=value.slice(29,34).trim(),status=value[34];
  if(!/^[A-Z0-9 ]{0,7}$/.test(pnr)||!/^[A-Z]{3}$/.test(originCode)||!/^[A-Z]{3}$/.test(destinationCode)||originCode===destinationCode||!carrier(airline)||!/^\d{1,4}[A-Z]?$/.test(flight)||!/^\d{3}$/.test(day)||+day<1||+day>366||!/^[A-Z]$/.test(cabin)||!/^[A-Z0-9]{0,4}$/.test(seat)||!/^[A-Z0-9 ]{0,5}$/.test(sequence)||!/^\d$/.test(status))return null;
  const flightNumber=flight.replace(/^0+(?=\d)/,'');
  return {pnr,originCode,destinationCode,carrier:airline,flightNumber,service:airline+flightNumber,dayOfYear:+day,cabin,seat:seat.replace(/^0+/,'')||seat,sequence,status};
}
function readConditional(value,first,shared) {
  let offset=0;
  if(first&&value[0]==='>'&&/^\d[\dA-F]{2}$/.test(value.slice(1,4))){
    const end=4+parseInt(value.slice(2,4),16);if(end>value.length)return {};
    const version=Number(value[1]),unique=value.slice(4,end),series=[];
    for(const start of [11,24,37]){
      const raw=unique.slice(start,start+13);if(!/^\d{13}$/.test(raw)||/^0+$/.test(raw))continue;
      const number=raw.slice(0,10);let count=Number(raw.slice(10));
      // Resolution 792 v6 used 000 for a single bag. Since v7 it is 001.
      if(version===6 && count===0)count=1;
      if(count===0)continue;
      if(Number(number)+count-1<=9999999999)series.push({number,count});
    }
    if(series.length)shared.baggageSeries=series;
    offset=end;
  }
  const length=value.slice(offset,offset+2);if(!hexadecimal(length))return {};
  const end=offset+2+parseInt(length,16);if(end>value.length)return {};
  const repeated=value.slice(offset+2,end),extra={},ticket=repeated.slice(0,13);
  if(/^\d{13}$/.test(ticket)&&!/^0+$/.test(ticket))extra.ticketNumber=ticket;
  const marketing=repeated.slice(15,18).trim(),program=repeated.slice(18,21).trim();
  if(repeated.length>=18&&carrier(marketing))extra.marketingCarrier=marketing;
  if(repeated.length>=21&&carrier(program))extra.frequentFlyerCarrier=program;
  if(repeated.length>=37){const number=repeated.slice(21,37).trim();if(/^[A-Z0-9]{1,16}$/.test(number))extra.frequentFlyerNumber=number;}
  if(repeated.length>=41){const allowance=repeated.slice(38,41).trim().toUpperCase();if(/^(?:\d{1,2}[KLP]|\dPC|\d{1,3})$/.test(allowance))extra.freeBaggageAllowance=allowance;}
  return extra;
}
function readAirlineExtras(value) {
  let text=value;
  if(!/[^\x00-\xff]/.test(text)){
    const bytes=Uint8Array.from(text,char=>char.charCodeAt(0));
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{
      try{text=new TextDecoder('gb18030',{fatal:true}).decode(bytes);}catch{return {};}
    }
  }
  const tagged=text.match(/#90([\p{Script=Han}·•]{1,40})#91([^#\x00-\x1f]{1,80})#92([^#\x00-\x1f]{1,80})(?=#93|$)/u);
  if(!tagged)return {};
  const extra={passengerChinese:tagged[1],originChinese:tagged[2],destinationChinese:tagged[3]};
  const gate=text.match(/#93([A-Z0-9][A-Z0-9/\-]{0,15})(?=#|$)/),boarding=text.match(/#94((?:[01]\d|2[0-3]):[0-5]\d)(?=#|$)/);
  if(gate)extra.gate=gate[1];
  // This provider updates #94 after boarding; it is not the scheduled time.
  if(boarding)extra.recordedBoardingTime=boarding[1];
  return extra;
}
