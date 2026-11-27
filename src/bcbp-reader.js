import { decodeCodeText } from './barcode-data.js';

const carrier=value=>/^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])$/.test(value);

function lengthPrefixedBlock(value, offset) {
  const length = value.slice(offset, offset + 2);
  if (!/^[\dA-F]{2}$/.test(length)) return null;
  const start = offset + 2, end = start + parseInt(length, 16);
  return end <= value.length ? { text: value.slice(start, end), end } : null;
}

// Byte offsets apply to the raw one-byte string, including airline extensions.
export function readBCBP(value) {
  if(typeof value!=='string'||value.length<60||value.length>8192||!/^M[1-4][\x20-\x7e]{21}/.test(value))return null;
  const passenger=value.slice(2,22).trim(),count=Number(value[1]);
  if(!/^[A-Z][A-Z /.'-]*$/.test(passenger)||!['E',' '].includes(value[22]))return null;
  const shared={passenger},legs=[];let offset=23;
  for(let index=0;index<count;index++){
    const fixed = value.slice(offset, offset + 35), variable = lengthPrefixedBlock(value, offset + 35);
    if (!/^[\x20-\x7e]{35}$/.test(fixed) || !variable) return null;
    const leg=readLeg(fixed);if(!leg)return null;
    const optional = readConditional(variable.text, index === 0, shared);
    legs.push({...leg,...optional,...readAirlineExtras(variable.text),legIndex:index});offset=variable.end;
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
  if (first && /^>\d/.test(value)) {
    const unique = lengthPrefixedBlock(value, 2); if (!unique) return {};
    const version=Number(value[1]),series=[];
    for(const start of [11,24,37]){
      const raw=unique.text.slice(start,start+13);if(!/^\d{13}$/.test(raw)||/^0+$/.test(raw))continue;
      const number=raw.slice(0,10);let count=Number(raw.slice(10));
      // Resolution 792 v6 used 000 for a single bag. Since v7 it is 001.
      if(version===6 && count===0)count=1;
      if(count===0)continue;
      if(Number(number)+count-1<=9999999999)series.push({number,count});
    }
    if(series.length)shared.baggageSeries=series;
    offset=unique.end;
  }
  const block = lengthPrefixedBlock(value, offset); if (!block) return {};
  const repeated=block.text,extra={},ticket=repeated.slice(0,13);
  const identity=value.slice(block.end).match(/^NI(\d(?:\*{16}|\d{16})[\dX])(?=$|[ #])/i)?.[1];
  if(identity)extra.identityHint=identity;
  if(/^\d{13}$/.test(ticket)&&!/^0+$/.test(ticket))extra.ticketNumber=ticket;
  const marketing=repeated.slice(15,18).trim(),program=repeated.slice(18,21).trim();
  if(repeated.length>=18&&carrier(marketing))extra.marketingCarrier=marketing;
  if(repeated.length>=21&&carrier(program))extra.frequentFlyerCarrier=program;
  if(repeated.length>=37){const number=repeated.slice(21,37).trim();if(/^[A-Z0-9]{1,16}$/.test(number))extra.frequentFlyerNumber=number;}
  return extra;
}
function readAirlineExtras(value) {
  if (!value.includes('#')) return {};
  const text = /[^\x00-\xff]/.test(value) ? value : decodeCodeText(Uint8Array.from(value, char => char.charCodeAt(0)), 'gb18030');
  if (text === null) return {};
  const extra={};
  const name=text.match(/#90([\p{Script=Han}·•]{1,40})(?=#|$)/u);
  const gate=text.match(/#93([A-Z0-9][A-Z0-9/\-]{0,15})(?=#|$)/),boarding=text.match(/#94((?:[01]\d|2[0-3]):[0-5]\d)(?=#|$)/);
  if(name)extra.passengerChinese=name[1];
  if(gate)extra.gate=gate[1];
  if(boarding)extra.boardingTime=boarding[1];
  return extra;
}
