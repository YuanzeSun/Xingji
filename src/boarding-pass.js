import {boardingMetadataValues} from './boarding-metadata.js';
import {calendarDate,daysInYear} from './journey-date.js';
import { createRecord, now, validDate } from './model.js';
import { ocrWords } from './ocr-layout.js';
import { AIRPORTS } from './data/location-reference.js';
import { AIRLINES } from './data/airline-reference.js';
import { resolvePlace } from './places.js';
import { readBCBP } from './bcbp-reader.js';
import {flightNameLanguage,hasChineseName} from './flight-passenger.js';
import {airlineNameForCode} from './airline-codes.js';
import {markFieldSources} from './field-sources.js';
import { aircraftMentions,extractAircraft } from './aircraft.js';
import {labelledFlightTimes} from './flight-times.js';
import {readBoardingCode} from './bcbp.js';
import {normalizeBoardingCode} from './boarding-code.js';
import {codeBytes} from './barcode-data.js';

const airportCodes = new Set(AIRPORTS.map(row => row[0]));
const carrierCodes = new Set(AIRLINES.flatMap(row => row[3]));
const only = values => { const unique = [...new Set(values.filter(Boolean))]; return unique.length === 1 ? unique[0] : ''; };
const normal = text => String(text || '').normalize('NFKC').replace(/\r/g, '').replace(/[：﹕]/g, ':');
const nameKey = text => text.toUpperCase().replace(/[^A-Z\p{Script=Han}]/gu, '');
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const ignoredCodes = new Set('THE FOR AIR ALL NOT NEW OLD AND AOU INT BOD BDT FLT MAY JUN JUL AUG SEP OCT NOV DEC PNR SEQ SSR FFP ETK XXX'.split(' '));

export const isBoardingPassText = text => !/行程详情|历史行程|航旅[纵织]横/i.test(text) && (/BOARDING\s*(?:PASS|CARD)|CARTE\s+D.ACC[EÉ]S|登\s*[机機]\s*[牌証证]|搭乘[券証证]/i.test(text) || /\b(?:FLIGHT|FLT|FLUGNUMMER|BOARDING|BOARD)\b/i.test(text)&&/\b(?:SEAT|SITZPLATZ|GATE)\b/i.test(text) || /\b(?:SEAT|GATE|ECONOMY|FROM|FLIGHT)\b/i.test(text)&&printedAirlines(text).length>0 || /\bGATES?\b/i.test(text)&&/\b[A-Z]{2}\s*\d{2,4}\b/.test(text));

function rowsFrom(text, layout) {
  const words = ocrWords(layout), rows = [];
  for (const word of words.sort((a,b) => a.top - b.top || a.left - b.left)) {
    const row = rows.find(row => Math.abs(row.top + row.height / 2 - word.top - word.height / 2) < Math.min(row.height, word.height) * .65);
    if (row) row.words.push(word); else rows.push({ top:word.top, height:word.height, words:[word] });
  }
  if (!words.length) return normal(text).split('\n').filter(line => line.trim()).map((line, index) => ({ top:index * 30, height:20, words:[{text:line.trim(), left:0, top:index * 30, width:line.trim().length * 10, height:20}], plain:true }));
  return rows.sort((a,b) => a.top - b.top).map(row => ({...row, words:row.words.sort((a,b) => a.left - b.left)}));
}

// Character ranges preserve columns even when the OCR reading order interleaves a stub.
function rowText(row) {
  let text = ''; const spans = [];
  for (const source of row.words) {
    const word={...source,text:source.text.replace(/(?<=[\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu,'')};
    if (text && !(/[\p{Script=Han}]$/u.test(text)&&/^[\p{Script=Han}]/u.test(word.text))) {
      const previous=spans.at(-1).word, gap=word.left-previous.left-previous.width;
      text += gap>Math.max(word.height,previous.height)*1.5?'\t':' ';
    }
    spans.push({start:text.length,end:text.length + word.text.length,word}); text += word.text;
  }
  const box = (start, end) => {
    const found = spans.filter(span => span.end > start && span.start < end);
    const first = found[0], last = found.at(-1);
    if (!first) return null;
    const left = first.word.left + Math.max(0, start-first.start) / first.word.text.length * first.word.width;
    const right = last.word.left + Math.min(last.word.text.length, end-last.start) / last.word.text.length * last.word.width;
    const top=Math.min(...found.map(span=>span.word.top)),bottom=Math.max(...found.map(span=>span.word.top+span.word.height));
    return {left,top,width:right-left,height:bottom-top};
  };
  return {text:normal(text),box,plain:row.plain};
}

const labels = {
  flight:/\b(?:FLIGHT(?:\s*(?:NO\.?|NUMBER))?|FLT(?:\s*NO\.?)?|FLUGNUMMER)\b|航班(?:号)?/gi,
  seat:/\b(?:SEAT(?:\s*(?:NO\.?|NUMBER))?|SITZPLATZ|ASIENTO)\b|座位(?:号)?|座席/gi,
  gate:/\bGATE(?:\s*NO\.?)?\b(?!\s*(?:CLOSE|CLOSED|CLOSES|CLOSURE|WILL|SUBJECT|MAY|CHANGES?))|登机[口门]/gi,
  boarding:/\b(?:BOARDING(?:[ ]*(?:TIME|BEGINS|BEG|AT))?|BOARD[ ]*(?:TIME|AT)|BDT|B[DO][D.]?[ ]*TIME)\b(?![ ]*(?:PASS|CARD|GATE|GROUP|ENDS?|CLOSE|CLOSED|CLOSES))|登机时间/gi,
  departure:/\b(?:DEPARTURE(?:\s*TIME)?|DEPARTS?|DEPA[RY]TS|FLIGHT\s*DEPARTS|ABFLUGZEIT|SALIDA)\b|起飞时间|出发时间|出発時刻/gi,
  date:/\b(?:DATE|DATUM)\b|日期|搭乘日/gi,
  from:/\b(?:FROM|ORIGIN|ABFLUGORT)\b|出发(?:站|地|机场)|始发地/gi,
  to:/\b(?:TO|DESTINATION|DESTN\.?|DEST\.?|REISEZIEL)\b|目的[地站]|到达站/gi,
  passenger:/\b(?:PASSENGER\s*NAME|NAME(?:\s*OF\s*PASSENGER)?)\b|姓名/gi,
  seatClass:/\b(?:CLASS|CABIN)\b|舱位|舱等/gi,
  pnr:/\b(?:PNR|CONFIRMATION|RECORD\s*LOCATOR|BUCHUNGSCODE)\b|订座编号/gi,
  ignore:/\b(?:GROUP|ZONE|SEQUENCE|SEQ|SERIAL|TERMINAL|TICKET|ETKT|BOARDING\s*(?:SEQ|GROUP|ENDS?)|GATE\s*CLOSES)\b|序号|区域/gi
};

function anchorsFor(rows) {
  const anchors = [];
  for (const row of rows) for (const [kind, pattern] of Object.entries(labels)) {
    const {text,box} = rowText(row);
    // Conditions and passenger instructions are not field headings.
    if (/PLEASE|MINUTES|MINS|SUBJECT TO|GATE MAY|DEAR CUSTOMER|NOTICE:|重要提示/i.test(text)) continue;
    for (const match of text.matchAll(pattern)) anchors.push({...box(match.index,match.index+match[0].length),kind});
  }
  return anchors;
}

function proximity(box, anchor, anchors) {
  const unit = Math.max(12,Math.min(anchor.height,box.height*2),Math.min(box.height,anchor.height*2)), dy = box.top + box.height/2 - anchor.top - anchor.height/2;
  if (Math.abs(dy) < unit * .7 && box.left >= anchor.left + anchor.width - unit*.25) {
    if (anchors.some(other => other !== anchor && Math.abs(other.top-anchor.top)<unit*.6 && other.left > anchor.left+anchor.width && other.left < box.left)) return 0;
    const gap = box.left - anchor.left - anchor.width;
    return gap < unit*15 ? 16 - gap/unit*.6 : 0;
  }
  if (dy < -unit*1.8 || dy > unit*4.5) return 0;
  const center=anchor.left+anchor.width/2, valueCenter=box.left+box.width/2;
  const peers=anchors.filter(other=>other.kind!==anchor.kind&&Math.abs(other.top-anchor.top)<unit*.7);
  const next=peers.filter(other=>other.left+other.width/2>center).sort((a,b)=>a.left-b.left)[0];
  const previous=peers.filter(other=>other.left+other.width/2<center).sort((a,b)=>b.left-a.left)[0];
  const right=next?(center+next.left+next.width/2)/2+unit*.3:center+Math.max(anchor.width/2,unit*4);
  const left=previous?(center+previous.left+previous.width/2)/2-unit*.3:center-Math.max(anchor.width/2,unit*4);
  if (valueCenter < left || valueCenter >= right) return 0;
  if (anchors.some(other => other !== anchor && other.top > anchor.top+unit*.7 && other.top < box.top-unit*.5 && Math.abs(other.left-box.left)<unit*2)) return 0;
  return (dy<0?11:14) - Math.abs(dy)/unit - Math.abs(valueCenter-center)/unit*.35;
}

function rankedValues(rows, pattern, parse, kind, anchors) {
  const candidates = [];
  for (const row of rows) {
    const {text,box} = rowText(row);
    for (const match of text.matchAll(pattern)) {
      const value = parse(match); if (!value) continue;
      const bounds = box(match.index, match.index+match[0].length);
      if(anchors.some(anchor=>Math.abs(anchor.top-bounds.top)<Math.min(anchor.height,bounds.height)*.5&&bounds.left>=anchor.left&&bounds.left+bounds.width<=anchor.left+anchor.width+.5))continue;
      const score = Math.max(0,...anchors.filter(anchor => anchor.kind === kind).map(anchor => proximity(bounds,anchor,anchors)));
      const competing=Math.max(0,...anchors.filter(anchor=>anchor.kind!==kind&&anchor.kind!=='from'&&anchor.kind!=='to').map(anchor=>proximity(bounds,anchor,anchors)));
      if (score > 0 && score>=competing-.2) candidates.push({value,score,box:bounds});
    }
  }
  return candidates.sort((a,b) => b.score-a.score);
}

function bestValue(candidates) {
  if (!candidates.length || candidates[0].score < 7) return '';
  const top = candidates[0];
  return candidates.some(other => other.value !== top.value && other.score > top.score-.6) ? '' : top.value;
}

export function boardingTime(value) {
  const match = normal(value).trim().match(/^(\d{1,2})\s*[:.]\s*(\d{2})\s*([AP])(?:M)?$|^(\d{1,2})(\d{2})\s*([AP])(?:M)?$|^(\d{1,2})\s*[:.]\s*(\d{2})$|^(\d{2})(\d{2})$/i);
  if (!match) return '';
  let hour = +(match[1] ?? match[4] ?? match[7] ?? match[9]);
  const minute = +(match[2] ?? match[5] ?? match[8] ?? match[10]), period = (match[3] || match[6] || '').toUpperCase();
  if (minute > 59 || hour > (period ? 12 : 23) || (period && hour === 0)) return '';
  if (period) hour = hour % 12 + (period === 'P' ? 12 : 0);
  return String(hour).padStart(2,'0') + ':' + String(minute).padStart(2,'0');
}
const timeValues = /(?<![\w/])(\d{1,2}\s*[:.]\s*\.?\s*\d{2}\s*(?:[AP](?:M)?)?|\d{3,4}\s*[AP](?:M)?|\d(?:\s*\d){3})(?![\w/])/gi;

export function boardingDate(value) {
  const text = normal(value).toUpperCase().replace(/(?<=\d)[O0](?=CT)/g,'O').replace(/\bO(?=\d\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC))/g,'0').replace(/(?<=\d)3AN(?=\d)/g,'JAN');
  let match = text.match(/\b((?:19|20)\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?\b/);
  let result = match ? `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}` : '';
  if (!result) {
    match = text.match(/(?<![A-Z0-9])(\d{1,2})\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP(?:TEMBER)?|OCT|NOV|DEC)\s*((?:19|20)\d{2}|\d{2})(?![\d:])/);
    if (match) result = `${match[3].length===2 ? (+match[3]>=70?'19':'20')+match[3] : match[3]}-${String(months.indexOf(match[2].slice(0,3))+1).padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  }
  if (!result) {
    match = text.match(/(?<!\d)(\d{1,2})\/(\d{1,2})\/((?:19|20)\d{2})(?!\d)/);
    if (match && +match[1]>12 && +match[2]<=12) result = `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`;
  }
  return validDate(result) ? result : '';
}

function printedAirlines(text) {
  const key = nameKey(text);
  return AIRLINES.filter(([,zh,en,codes,aliases]) => [zh,en,...(codes.includes('MF')?['XiamenAir']:[]),...aliases].some(name => name && nameKey(name).length>=5 && key.includes(nameKey(name))));
}

function flightValue(prefix, number, airlines) {
  let code = prefix.toUpperCase(), digits = number.replace(/[O]/gi,'0').replace(/[Il]/g,'1');
  const printed = new Set(airlines.flatMap(row => row[3]));
  if (!printed.has(code)) {
    const confusions=new Set(['EF','FE','1I','I1','0O','O0','IL','LI','IJ','JI','7X','X7']);
    const similar = [...printed].filter(candidate => candidate.length===code.length && [...candidate].filter((char,i)=>char!==code[i]).length===1 && [...candidate].every((char,i)=>char===code[i]||confusions.has(code[i]+char)));
    if (similar.length===1) code = similar[0];
  }
  if (!carrierCodes.has(code) || !/[1-9]/.test(digits)) return '';
  return code + digits;
}

function flightField(rows, anchors, airlines) {
  const candidates = [];
  for (const row of rows) {
    const {text,box} = rowText(row);
    const planes=aircraftMentions(text);
    if (/ETKT|TICKET\s*(?:NO|NUMBER)|FREQUENT|FFP|SSR|REGISTRATION|身份证|客票号/i.test(text) && !/FLIGHT|航班/i.test(text)) continue;
    for (const match of text.matchAll(/(?<![A-Z0-9])([A-Z]{2}|[A-Z]\d|\d[A-Z]|[A-Z]{3})\s*([0-9OIl]{1,4})(?=[A-Z]?(?:[^A-Z0-9]|$))/g)) {
      if(planes.some(plane=>match.index<plane.end&&match.index+match[0].length>plane.index))continue;
      if (!(match[2].match(/\d/g)||[]).length || /^(?:FLT|ETK|SEQ|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.test(match[1])) continue;
      const value = flightValue(match[1],match[2],airlines); if (!value) continue;
      const bounds = box(match.index,match.index+match[0].length);
      const label = Math.max(0,...anchors.filter(a=>a.kind==='flight').map(a=>proximity(bounds,a,anchors)));
      const printed = airlines.some(row=>row[3].some(code=>value.startsWith(code)));
      if(airlines.length&&!printed&&label<10)continue;
      if((match[2].match(/\d/g)||[]).length===1&&label<10)continue;
      if(match[1].length===3&&!printed&&label<10)continue;
      candidates.push({value,score:5+label+(printed?9:0)});
    }
  }
  const grouped = new Map();
  for (const candidate of candidates) { const group=grouped.get(candidate.value)||{...candidate,count:0}; group.score=Math.max(group.score,candidate.score); group.count++; grouped.set(candidate.value,group); }
  const sorted=[...grouped.values()].map(row=>({...row,score:row.score+Math.min(5,(row.count-1)*2)})).sort((a,b)=>b.score-a.score);
  return sorted[0] && sorted[0].score>=5 && (!sorted[1] || sorted[0].score-sorted[1].score>1) ? sorted[0].value : '';
}

function airportIn(value) {
  if(/^[A-Za-z]{3}$/.test(value.trim()))return /^[A-Z]{3}$/.test(value.trim())&&!ignoredCodes.has(value.trim())?value.trim():'';
  const explicit=[...value.matchAll(/[A-Z][A-Z -]{2,}\/\s*([A-Z]{3})\b/g)].map(match=>match[1]).filter(code=>!ignoredCodes.has(code));
  const codes=explicit.length?explicit:[...value.matchAll(/\b[A-Z]{3}\b/g)].map(match=>match[0]).filter(code=>airportCodes.has(code)&&!ignoredCodes.has(code)&&(value.trim()===code||/\bFROM\b|\bTO\b|\bDEST(?:N)?\b/.test(value)));
  if (codes.length) return only(codes);
  const place=resolvePlace({type:'flight',origin:value.trim()},'origin');
  return place.status==='matched' ? place.code : '';
}

function routeFields(rows, anchors) {
  const result={origin:'',destination:'',originCode:'',destinationCode:''};
  for (const [kind,side] of [['from','origin'],['to','destination']]) {
    const candidates=[];
    for (const row of rows) {
      const {text,box}=rowText(row);
      if (/PLEASE|MINUTES|CLOSE|MEMBER|FLYER|TICKET|ETKT|PNR|CONFIRMATION|SSR|\b(?:MR|MRS|MS)\b/i.test(text)) continue;
      let offset=0;
      for(const part of text.split('\t')){
        const code=airportIn(part);
        if(code){
          const bounds=box(offset,offset+part.length);bounds.width=Math.min(bounds.width,bounds.height*3);
          const score=Math.max(0,...anchors.filter(a=>a.kind===kind&&bounds.top+bounds.height/2>=a.top+a.height/2).map(a=>proximity(bounds,a,anchors)));
          const opposite=Math.max(0,...anchors.filter(a=>a.kind===(kind==='from'?'to':'from')).map(a=>proximity(bounds,a,anchors)));
          if(score>opposite)candidates.push({value:code,score});
        }
        offset+=part.length+1;
      }
      // Preserve a printed city when it cannot identify one specific airport.
      for(const match of text.matchAll(new RegExp('\\b(?:'+(kind==='from'?'FROM|ORIGIN':'TO|DESTINATION')+')\\s*[:/]?\\s*([A-Z][A-Z /-]{2,45})','g'))) {
        const value=match[1].replace(/\s+(?:FLIGHT|DATE|SEAT|CLASS|GATE).*$/,'').trim();
        if(value && !/^(?:BE |CHANGE|DEPARTURE)/.test(value))result[side]=value;
      }
    }
    result[side+'Code']=bestValue(candidates);
  }
  const pairs=[];
  for(const row of rows){
    const {text}=rowText(row);
    const direct=text.match(/(?<![A-Z])([A-Z]{3})\s*(?:→|->|>|—|-)\s*([A-Z]{3})\b/);
    if(direct&&!ignoredCodes.has(direct[1])&&!ignoredCodes.has(direct[2])&&direct[1]!==direct[2])pairs.push(direct[1]+'|'+direct[2]);
    const annotated=[...text.matchAll(/\b([A-Z]{3})\/[A-Z]{3,}/g)].map(match=>match[1]);
    if(annotated.length===2&&annotated[0]!==annotated[1])pairs.push(annotated.join('|'));
    if(/PLEASE|MINUTES|CLOSE|MEMBER|FLYER|TICKET|ETKT|PNR|CONFIRMATION|SSR|SUBJECT|SEQUENCE|\b(?:MR|MRS|MS)\b/i.test(text)||text.length>120)continue;
    const pair=text.match(/(?<![A-Z])([A-Z]{3})\s*(?:→|->|>|—|-)\s*([A-Z]{3})\b/)||text.match(/\b([A-Z]{3})\/[A-Z ]+\s-\s([A-Z]{3})\//);
    if(pair&&!ignoredCodes.has(pair[1])&&!ignoredCodes.has(pair[2])&&pair[1]!==pair[2])pairs.push(pair[1]+'|'+pair[2]);
  }
  const pair=only(pairs);
  if(pair){[result.originCode,result.destinationCode]=pair.split('|');}
  if(result.originCode===result.destinationCode)result.originCode=result.destinationCode='';
  for(const side of ['origin','destination'])if(result[side+'Code'])result[side]=resolvePlace({type:'flight',[side]:result[side+'Code']},side).name||result[side+'Code'];
  return result;
}

function parseRead(text, layout) {
  const rows=rowsFrom(text,layout), anchors=anchorsFor(rows), airlines=printedAirlines(text);
  const service=flightField(rows,anchors,airlines), route=routeFields(rows,anchors);
  const timeRows=rows.filter(row=>!/实际|预计|ACTUAL|ESTIMATED|\bATD\b|\bATA\b|\bETD\b|\bETA\b/i.test(rowText(row).text)),timeAnchors=anchorsFor(timeRows);
  const read=(kind,pattern,parse)=>bestValue(rankedValues(['boarding','departure'].includes(kind)?timeRows:rows,pattern,parse,kind,['boarding','departure'].includes(kind)?timeAnchors:anchors));
  const seat=read('seat',/(?<![A-Za-z0-9])\d{1,2}(?:[ ]+\d)?[ ]*[A-K](?![A-Za-z0-9])/gi,m=>m[0].replace(/\s/g,'').toUpperCase());
  const gate=read('gate',/(?<![A-Za-z0-9:/])(?:[A-Z]{0,2}\d(?:[ ]*\d){0,2}[ ]?[A-Z]?)(?![A-Za-z0-9:/]|\s*[:.]\s*\d)/g,m=>m[0].replace(/\s/g,''));
  const readTime=m=>boardingTime(m[0].replace(/:\s*\./,':').replace(/(?<=\d)\s+(?=\d)/g,''));
  const boarding=read('boarding',timeValues,readTime);
  let departure=read('departure',timeValues,readTime);
  if(!departure){
    const inline=[];
    for(const row of timeRows){const value=rowText(row).text;if(!/(?:BOARDING|BOARD TIME|GATE CLOSES)/i.test(value)){
      for(const match of value.matchAll(/\b(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])[ ]*\d{1,4}[ ]*[A-Z]?[ ]*\d{1,2}[ ]*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[ ]*(\d{1,2}[ ]*:[ ]*\d{2}[ ]*(?:[AP](?:M)?)?|\d{3,4}[AP](?:M)?)(?![A-Z0-9])/gi))inline.push(boardingTime(match[1]));
    }}departure=only(inline);
  }
  const fullDates=timeRows.map(row=>rowText(row).text).filter(value=>!/ISSUE|PRINTED|出票|购票|打印|支付/i.test(value)).map(boardingDate);
  const departureDate=only(fullDates);
  const passenger=read('passenger',/[A-Z][A-Z '\-]{1,25}\s*[/,]\s*[A-Z][A-Z '\-]{1,30}(?:\s+(?:MR|MS|MRS))?|[\p{Script=Han}]{2,8}/gu,m=>/^[A-Z]/.test(m[0])?m[0].replace(/\s+/g,' ').trim():m[0]);
  const seatClass=read('seatClass',/(?<![A-Za-z0-9])[A-Z](?![A-Za-z0-9])/g,m=>m[0]);
  const pnr=read('pnr',/(?<![A-Z0-9])[A-Z0-9]{5,7}(?![A-Z0-9])/g,m=>/\d/.test(m[0])?m[0]:'');
  const airline=only(airlines.filter(row=>row[3].some(code=>service.startsWith(code))).map(row=>row[1]||row[2]));
  const labelled=(labels,pattern)=>only([...text.matchAll(new RegExp('(?:'+labels+')\\s*:?\\s*('+pattern+')','gi'))].map(match=>match[1]));
  const identity=labelled('证件号(?:码)?|身份证(?:号(?:码)?)?|护照(?:号(?:码)?)?|(?:PASSPORT|DOCUMENT|ID)\\s*(?:NO\\.?|NUMBER)','[A-Z0-9*]{3,32}').toUpperCase();
  const ticketNumber=labelled('电子客票号|客票号|票号|(?:E[- ]?TICKET|ETKT|TICKET)(?:\\s*(?:NO\\.?|NUMBER))?','\\d{3}[- ]?\\d{10}').replace(/\D/g,'');
  const terminal=labelled('航站楼|TERMINAL','T?\\s*[A-Z0-9]{1,2}(?![A-Z0-9])').replace(/\s/g,'').toUpperCase();
  const price=labelled('票价|价格|金额|CNY|RMB|[￥¥]','\\d{1,9}(?:\\.\\d{1,2})?(?![\\d.])');
  const aircraftRegistration=labelled('飞机编号|机身编号|注册号|机号|REGISTRATION','[A-Z][A-Z0-9-]{2,11}').toUpperCase();
  const fields={type:'flight',template:'air-boarding-pass',service,...route,seat,gate,boardingTime:boarding,departureTime:departure,departureDate,passenger,seatClass,pnr,airline,identity,ticketNumber,terminal,price,aircraft:extractAircraft(text),aircraftRegistration,...labelledFlightTimes(text)};
  if(!layout){
    const lines=text.split('\n').filter(line=>line.trim());
    for(let i=1;i<lines.length;i++){
      const header=lines[i-1],boardingIndex=header.search(/BOARDING|登机时间/i),departureIndex=header.search(/DEPARTURE|起飞时间/i);
      if(/实际|预计|ACTUAL|ESTIMATED/i.test(header))continue;
      const times=[...lines[i].matchAll(/\b\d{1,2}:\d{2}\b/g)].map(match=>boardingTime(match[0]));
      if(boardingIndex>=0&&departureIndex>=0&&times.length===2){fields.boardingTime=times[boardingIndex<departureIndex?0:1];fields.departureTime=times[boardingIndex<departureIndex?1:0];}
      if(/NAME|姓名/i.test(header)&&/FLIGHT|航班/i.test(header))fields.passenger=lines[i].match(/^\s*([\p{Script=Han}]{2,20})\s+/u)?.[1]||'';
    }
  }
  return fields;
}

export function parsePrintedBoardingPass(raw, label='扫描导入', {layout='', boardingReadings=[], boardingPayloads=[], boardingCodes=[]}={}) {
  const codes=[...boardingCodes.map(data=>{
    try { data=normalizeBoardingCode(data);return {read:readBoardingCode(data),data,payload:String.fromCharCode(...codeBytes(data.rawBytes))}; }
    catch {return null;}
  }),...boardingPayloads.map(payload=>({read:readBCBP(payload),payload}))].filter(code=>code?.read);
  if(!codes.length&&!isBoardingPassText(raw)&&!boardingReadings.some(read=>isBoardingPassText(read.text)))return null;
  const readings=[{text:raw,layout},...boardingReadings].map(read=>parseRead(normal(read.text),read.layout));
  // A second segmentation fills gaps; a clear primary read keeps its value.
  const fields={...readings[0]};
  for(const key of Object.keys(fields))fields[key]=fields[key]||only(readings.map(read=>read[key]));
  markFieldSources(fields,Object.keys(fields),'ocr');
  if(codes.length){
    const key=code=>code.payload.slice(0,22)+' '+code.payload.slice(23);
    const matching=codes.filter(code=>!fields.service||code.read.legs.some(leg=>leg.service===fields.service));
    const selected=matching.length?matching:codes;
    if(new Set(selected.map(key)).size!==1)return [];
    const selectedCode=selected.find(code=>code.data)||selected[0];
    return selectedCode.read.legs.map((code,index)=>{
      const matchingOCR=selectedCode.read.legCount===1||fields.service===code.service||fields.originCode===code.originCode&&fields.destinationCode===code.destinationCode;
      const values=matchingOCR ? {...fields,fieldSources:{...fields.fieldSources}} : {type:'flight',template:'air-boarding-pass',passenger:fields.passenger,identity:fields.identity,fieldSources:{}};
      if(!matchingOCR&&fields.identity)markFieldSources(values,['identity'],'ocr');
      if(selectedCode.data){values.boardingCode=selectedCode.data;values.boardingCodeSource='original';values.boardingLegIndex=String(index);markFieldSources(values,['boardingCode'],'barcode');}
      const decoded={service:code.service,pnr:code.pnr,seat:code.seat,originCode:code.originCode,destinationCode:code.destinationCode,seatClass:code.cabin,airline:airlineNameForCode(code.carrier),ticketNumber:code.ticketNumber,gate:code.gate,...boardingMetadataValues(code)};
      for(const [field,value] of Object.entries(decoded))if(value){values[field]=value;markFieldSources(values,[field],'barcode');}
      for(const side of ['origin','destination'])values[side]=resolvePlace({type:'flight',[side]:code[side+'Code']},side).name||code[side+'Code'];
      markFieldSources(values,['origin','destination'],'barcode');
      values.passenger=code.passengerChinese||(flightNameLanguage(values)==='zh'&&hasChineseName(values.passenger)?values.passenger:code.passenger);
      if(values.passenger===code.passengerChinese||values.passenger===code.passenger)markFieldSources(values,['passenger'],'barcode');
      const year=matchingOCR ? calendarDate(fields.departureDate).slice(0,4)||only(readings.map(read=>calendarDate(read.departureDate).slice(0,4))) : '';
      values.departureDate={year:year&&code.dayOfYear<=daysInYear(Number(year))?Number(year):null,dayOfYear:code.dayOfYear};
      markFieldSources(values,['departureDate'],'barcode');if(values.departureDate.year)markFieldSources(values,['departureDateYear'],'ocr');
      return createRecord({...values,sources:[{kind:'scan',label,at:now()}],provenance:'reconstruction'});
    });
  }
  if(!fields.service&&!fields.originCode&&!fields.destinationCode&&!fields.seat&&!fields.boardingTime&&!fields.departureTime&&!fields.departureDate)return [];
  return [createRecord({...fields,sources:[{kind:'scan',label,at:now()}],provenance:'reconstruction'})];
}
