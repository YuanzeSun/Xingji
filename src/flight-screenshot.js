import { createRecord, now, validDate } from './model.js';
import { resolvePlace } from './places.js';
import { AIRPORTS } from './data/location-reference.js';
import { AIRPORT_LABELS } from './data/airport-labels.js';
import { ocrWords } from './ocr-layout.js';
import { flightStatusFromText } from './flight-status.js';
import { aircraftMentions, extractAircraft } from './aircraft.js';
import {ACTUAL_FLIGHT_FIELDS,labelledFlightTimes} from './flight-times.js';

const normal = value => String(value || '').normalize('NFKC').replace(/\r/g,'').replace(/[：﹕]/g,':').replace(/(?<=[\u3400-\u9fff])[ \t](?=[\u3400-\u9fff])/g,'').replace(/([0-2]?\d)\s*:\s*(\d{2})/g,'$1:$2').replace(/((?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{2})(?=\d{1,2}:)/g,'$1 ');
const flightPattern = /(?<![A-Z0-9])([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*([0-9OIl]{2,5})(?![A-Z0-9:.]|-[A-Z0-9])/gi;
const timePattern = /(?<!\d)([0-2]?\d:[0-5]\d)(?!\d)/g;
const datePattern = /((?:19|20)\d{2})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})日?/g;
const previousFlight = /前序|前段|后续|上一航班|下一航班/;
const ignoredDate = /下单|订单时间|购票|出票|支付|实际|预计|更新/;
const only = values => [...new Set(values.filter(Boolean))].length === 1 ? values.find(Boolean) : '';
const times = text => [...text.matchAll(timePattern)].map(match=>+match[1].split(':')[0]<24 ? match[1].padStart(5,'0') : '').filter(Boolean);
const dates = text => [...text.matchAll(datePattern)].map(match=>`${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`).filter(validDate);
const flights = text => {
  const planes = aircraftMentions(text);
  return [...text.matchAll(flightPattern)].filter(match =>
    (match[2].match(/\d/g)||[]).length >= 2 && (match[1] === match[1].toUpperCase() || /航空|航班|FLIGHT/i.test(text)) &&
    (!planes.some(plane => match.index < plane.end && match.index + match[0].length > plane.index) || /(?:航班(?:号|编号)?|FLIGHT(?:\s*NO\.?)?|航空)\s*[:：#]?\s*$/i.test(text.slice(0, match.index)))
  ).map(match => (match[1]+match[2].replace(/O/gi,'0').replace(/[Il]/g,'1')).toUpperCase());
};
export const isFlightScreenshotText = text => /航旅[纵织]横|UMETRIP|行程全记录|历史行程|行程详情|行程服务|航班详情|客票已使用/i.test(normal(text));

export function flightScreenshotLines(text, layout) {
  const words = ocrWords(layout), rows = [];
  for (const word of words.sort((a,b)=>a.top-b.top)) {
    const row = rows.find(row=>Math.abs(row.top+row.height/2-word.top-word.height/2)<Math.max(row.height,word.height)*.6);
    if (row) row.words.push(word); else rows.push({top:word.top,height:word.height,words:[word]});
  }
  if (!rows.length) return normal(text).split('\n').filter(line=>line.trim()).map(text=>({text,words:[],segments:text.split(/\s{2,}/).filter(Boolean)}));
  return rows.sort((a,b)=>a.top-b.top).map(row=>{
    const sorted=row.words.sort((a,b)=>a.left-b.left), segments=[];let previous;
    for(const word of sorted){
      if(!previous || word.left-previous.left-previous.width>Math.max(row.height*1.3,24))segments.push([]);
      segments.at(-1).push(word.text);previous=word;
    }
    return {...row,segments:segments.map(words=>normal(words.join(' '))),text:segments.map(words=>normal(words.join(' '))).join('   ')};
  });
}
const airportAliases = new Map();
for (const [code,,,,aliases] of AIRPORTS) for(const alias of aliases.split('|')) for(const name of [alias,alias.replace(/(?:国际)?机场$/,'')]) if(/^[\u3400-\u9fff]{4,}$/.test(name)) {
  if(!airportAliases.has(name))airportAliases.set(name,new Set());airportAliases.get(name).add(code);
}
for(const [code,name,aliases] of AIRPORT_LABELS) for(const alias of [name,...aliases]) {
  for(const name of [alias,alias.replace(/(?:国际)?机场$/,'')])if(/^[\u3400-\u9fff]{4,}$/.test(name)){
    if(!airportAliases.has(name))airportAliases.set(name,new Set());airportAliases.get(name).add(code);
  }
}
function airportValue(raw, allowUnknown=false) {
  const value=normal(raw).replace(/^(?:出发机场|到达机场|起飞机场|抵达机场|出发|到达|FROM|TO)\s*:?\s*/i,'').replace(/(?:航站楼\s*)?T\s*\d+[A-Z]?|\d+号航站楼/gi,'').replace(/(机场)\s*\d{1,2}$/,'$1').trim();
  if(!value)return null;
  let place=resolvePlace({type:'flight',origin:value},'origin');
  if(place.status!=='matched'&&/机场$/.test(value)){
    const stem=value.replace(/(?:国际)?机场$/,'').replace(/^[和与](?=.{2,}$)/,''),codes=new Set();
    for(const [name,ids] of airportAliases)if(stem.length>=2&&name.replace(/(?:国际)?机场$/,'').endsWith(stem))for(const id of ids)codes.add(id);
    if(codes.size===1)place=resolvePlace({type:'flight',origin:[...codes][0]},'origin');
  }
  if(place.status!=='matched' && /^[\u3400-\u9fff]{4,}$/.test(value)){
    const codes=new Set();
    for(const [name,ids] of airportAliases)if(name.length===value.length && [...name].filter((char,i)=>char!==value[i]).length===1)for(const id of ids)codes.add(id);
    if(codes.size===1)place=resolvePlace({type:'flight',origin:[...codes][0]},'origin');
  }
  if(place.status==='matched')return {name:place.name,code:place.code,country:place.country,terminal:raw.match(/\bT\s*\d+[A-Z]?\b/i)?.[0].replace(/\s/g,'').toUpperCase()||''};
  return allowUnknown && /^(?:[\u3400-\u9fff]{2,20}|[A-Z]{3})$/.test(value) ? {name:value,code:'',country:'',terminal:''} : null;
}
function routeFields(lines) {
  for(const line of lines){
    for(const segment of line.segments){
      const pair=segment.split(/\s*(?:→|->|—|至|-)\s*/);
      if(pair.length===2){const origin=airportValue(pair[0],true),destination=airportValue(pair[1],true);if(origin&&destination)return {origin,destination};}
    }
    const airports=line.segments.map(value=>airportValue(value)).filter(Boolean);
    if(airports.length===2 && airports[0].code!==airports[1].code)return {origin:airports[0],destination:airports[1]};
  }
  const airports=lines.flatMap(line=>line.segments.map(value=>airportValue(value))).filter(Boolean),unique=[...new Map(airports.map(place=>[place.code,place])).values()];
  return unique.length===2 ? {origin:unique[0],destination:unique[1]} : {};
}
function labelled(text, labels, pattern) {
  const match=new RegExp(`(?:${labels})\\s*:?\\s*(${pattern})`,'i').exec(text);return match?.[1]?.trim()||'';
}
function columnValue(lines, label, pattern) {
  for(let index=0;index<lines.length;index++){
    const anchor=lines[index].words.find(word=>label.test(normal(word.text)));if(!anchor)continue;
    for(const line of lines.slice(index+1,index+3)){
      const values=line.words.filter(word=>Math.abs(word.left+word.width/2-anchor.left-anchor.width/2)<Math.max(anchor.height*2.5,60)).map(word=>normal(word.text)).filter(text=>pattern.test(text));
      const value=only(values);if(value)return value;
    }
  }
  return '';
}
function ticketFields(lines, supplementalText) {
  const text=lines.map(line=>line.text).join('\n'),supplement=normal(supplementalText),seatPattern=/^[0-9OQIlISBGZ]{1,3}[A-K]$/i;
  const confirmedSeat=only(supplement.split('\n').filter(line=>!/波音|空客|AIRBUS|BOEING|\b7\d{2}-|(?:19|20)\d{2}[-/.]|登机口|GATE/i.test(line)).flatMap(line=>[...line.matchAll(/(?<![A-Z0-9])\d{1,3}[A-K](?![A-Z0-9])/g)].map(match=>match[0])));
  const seat=confirmedSeat || columnValue(lines,/座位|座号|SEAT/i,seatPattern) || labelled(text,'座位号?|座号|SEAT','[0-9]{1,3}[A-K](?![A-Z0-9])') || labelled(text,'座位号?|座号|SEAT','[0-9OQIlISBGZ]{2,3}[A-K](?![A-Z0-9])');
  const normalSeat=seat ? seat.slice(0,-1).toUpperCase().replace(/[OQILSBGZ]/g,char=>({O:'0',Q:'0',I:'1',L:'1',S:'5',B:'8',G:'6',Z:'2'})[char])+seat.at(-1).toUpperCase() : '';
  const numberPattern=/(?<![A-Z0-9*])\d[\d*]{11}\d(?![A-Z0-9*])/g;
  const ticketNumber=only([...supplement.matchAll(numberPattern)].map(match=>match[0])) || only([...text.matchAll(numberPattern)].map(match=>match[0]));
  let pnr=labelled(text,'订座编号|订座记录(?:编号)?|PNR','[A-Z0-9]{5,8}').toUpperCase();
  if(pnr.length!==6){const confirmed=only([...supplement.matchAll(/\b[A-Z0-9]{6}\b/g)].map(match=>match[0]).filter(value=>pnr.startsWith(value)));pnr=confirmed||'';}
  const price=labelled(text,'含税票价|票价|价格','(?:[¥￥]\\s*)?\\d+(?:\\.\\d{1,2})?(?:CNY|元)?').replace(/[^0-9.]/g,'') || text.match(/(?:^|\s)(\d+(?:\.\d{1,2})?)\s*(?:CNY|RMB|元)(?![A-Z])/i)?.[1] || columnValue(lines,/含税票价|票价/,/^\d+(?:\.\d{1,2})?(?:CNY|元)?$/i).replace(/[^0-9.]/g,'');
  const allText=text+'\n'+supplement;
  const identities=[...allText.matchAll(/(?:身份证|护照|证件号(?:码)?)\s*[:（(]?\s*([A-Z0-9*]{3,20})/gi)].map(match=>match[1]);
  const identity=only(identities.filter(value=>value.includes('*'))) || only(identities);
  const aircraft=extractAircraft(allText);
  const planeLines=allText.split('\n'),aircraftLine=planeLines.findIndex(line=>extractAircraft(line));
  const planeArea=aircraftLine<0?'':planeLines.slice(aircraftLine,aircraftLine+3).join(' ');
  const planeTypes=aircraftMentions(planeArea);
  const unlabelledRegistration=[...planeArea.matchAll(/\b(B-?\d{4}|B-[A-Z0-9]{4}|[A-Z]{1,2}-[A-Z0-9]{3,5}|N\d{1,5}[A-Z]{0,2})\b/g)].find(match=>!planeTypes.some(plane=>match.index<plane.end&&match.index+match[0].length>plane.index))?.[1]||'';
  const aircraftRegistration=labelled(allText,'飞机编号|机身编号|注册编号|注册号|机号|(?<!订座)(?<!订单)(?<!客票)编号','[A-Z][A-Z0-9-]{2,11}') || unlabelledRegistration;
  return {flightStatus:flightStatusFromText(allText),seat:normalSeat,ticketNumber,pnr,price,aircraft,aircraftRegistration,
    passenger:labelled(text,'旅客姓名|乘机人|旅客|姓名|PASSENGER','[\\u3400-\\u9fffA-Za-z·*/ -]{2,50}').split(/证件|座位|舱位|\n/)[0].trim(),
    identity,
    seatClass:labelled(text,'舱位(?:代码)?|CLASS','[A-Z]\\d{0,2}(?![A-Z0-9])') || text.match(/(?:经济|商务|公务|头等|超级经济)舱\s*[（(]?\s*([A-Z]\d{0,2})(?![A-Z0-9])/i)?.[1] || '',
    gate:labelled(text,'登机口|GATE','[A-Z0-9][A-Z0-9/-]{0,12}(?![A-Z0-9])')};
}
export function parseFlightScreenshot(raw, sourceKind='scan', label='航旅纵横截图', {layout='',supplementalText=''}={}) {
  if(!isFlightScreenshotText(raw))return null;
  const allLines=flightScreenshotLines(raw,layout),anchors=[];
  allLines.forEach((line,index)=>{if(!previousFlight.test(line.text)&&!/%/.test(line.text)&&!/编号|机龄|波音|空客|机型|飞机型号|AIRCRAFT|EQUIPMENT|机号|注册号|客票号|订座|PNR|身份证|证件|订单号/i.test(line.text)){const codes=flights(line.text),planeContext=allLines.slice(Math.max(0,index-2),index+1).some(row=>extractAircraft(row.text)||/7\d{2}-/.test(row.text));if(codes.length===1&&!(planeContext&&/^B\d{4}$/.test(codes[0])))anchors.push({index,service:codes[0]});}});
  if(!anchors.length)return null;
  return anchors.map(({index,service},position)=>{
    let lines=allLines.slice(index,anchors[position+1]?.index).filter(line=>!previousFlight.test(line.text));
    const footer=lines.findIndex(line=>/航班点评|行程推荐|本次飞行数据报告|行程已结束/.test(line.text));if(footer>=0)lines=lines.slice(0,footer);
    const route=routeFields(lines),text=lines.map(line=>line.text).join('\n'),labelledTimes=labelledFlightTimes(text);
    const planned=lines.find(line=>!ignoredDate.test(line.text)&&dates(line.text).length===1&&times(line.text).length===2);
    const dateHeader=allLines.slice(0,index).filter(line=>/^[^\d\u3400-\u9fff]*\d{4}[-/.年]/.test(line.text.trim())&&!flights(line.text).length&&!times(line.text).length&&!ignoredDate.test(line.text)).at(-1);
    const departureDate=labelledTimes.departureDate || only(dates(planned?.text||'')) || only(dates(lines[0]?.text||'')) || only(dates(labelled(text,'出发日期|起飞日期|乘机日期','[^\\n]+'))) || only(dates(dateHeader?.text||''));
    const planPair=times(planned?.text||''),mainPair=lines.slice(1,9).map(line=>/实际|预计|登机|前序/.test(line.text)?[]:times(line.text)).find(values=>values.length===2)||[];
    const departureTime=labelledTimes.departureTime || planPair[0] || labelled(text,'(?<!实际)(?<!预计)(?:起飞时间|出发时间)','[0-2]?\\d:[0-5]\\d') || mainPair[0] || '';
    const arrivalTime=labelledTimes.arrivalTime || planPair[1] || mainPair[1] || '';
    let arrivalDate=labelledTimes.arrivalDate || only(dates(labelled(text,'(?<!实际)(?<!预计)到达日期','[^\\n]+')));
    const nextDay=lines.filter(line=>!/实际|预计|ACTUAL|ESTIMATED/i.test(line.text)).map(line=>line.text).join('\n').match(/\+\s*([12])\s*(?:天|日)|次日|翌日/);
    if(!arrivalDate&&departureDate&&nextDay){const date=new Date(departureDate+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+ +(nextDay[1]||1));arrivalDate=date.toISOString().slice(0,10);}
    const fields={...ticketFields(lines,anchors.length===1?supplementalText:''),...Object.fromEntries(ACTUAL_FLIGHT_FIELDS.map(key=>[key,labelledTimes[key] || '']))};
    return createRecord({type:'flight',template:'air-boarding-pass',service,origin:route.origin?.name||'',destination:route.destination?.name||'',originCode:route.origin?.code||'',destinationCode:route.destination?.code||'',terminal:route.origin?.terminal||'',departureDate,departureTime:departureTime?departureTime.padStart(5,'0'):'',arrivalTime:arrivalTime?arrivalTime.padStart(5,'0'):'',arrivalDate,...fields,airline:lines[0].text.match(/[\u3400-\u9fff]{2,16}航空/)?.[0]||'',sources:[{kind:sourceKind,label,at:now()}],provenance:'commemorative'});
  });
}
