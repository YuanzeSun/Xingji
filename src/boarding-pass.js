import { boardingMetadataValues } from './boarding-metadata.js';
import { createRecord } from './model.js';
import { ocrWords } from './ocr-layout.js';
import { resolvePlace } from './places.js';
import { readBCBP } from './bcbp-reader.js';
import { airlineNameForCode } from './airline-codes.js';
import { markFieldSources } from './field-sources.js';
import { normalizeBoardingCode } from './boarding-code.js';
import { codeBytes } from './barcode-data.js';

const only = values => { const unique = [...new Set(values.filter(Boolean))]; return unique.length === 1 ? unique[0] : ''; };
const normal = text => String(text || '').normalize('NFKC').replace(/\r/g, '').replace(/[：﹕]/g, ':');

export function isBoardingPassText(text) {
  return /BOARDING\s*(?:PASS|CARD|TIME)|CARTE\s+D.ACC[EÉ]S|登\s*[机機]\s*[牌証证]|搭乘[券証证]|登\s*[机機]\s*[时時]\s*[间間]/i.test(text) ||
    /\b(?:FLIGHT|FLT|FLUGNUMMER)\b|航班/.test(text.toUpperCase()) && /\b(?:SEAT|SITZPLATZ|GATE)\b|座位|登机口/.test(text.toUpperCase());
}

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
  seat:/\b(?:SEAT(?:\s*(?:NO\.?|NUMBER))?|SITZPLATZ|ASIENTO)\b|座位(?:号)?|座席/gi,
  gate:/\bGATE(?:\s*NO\.?)?\b(?!\s*(?:CLOSE|CLOSED|CLOSES|CLOSURE|WILL|SUBJECT|MAY|CHANGES?))|登机[口门]/gi,
  boarding:/\b(?:BOARDING(?:[ ]*(?:TIME|BEGINS|BEG|AT))?|BOARD[ ]*(?:TIME|AT)|BDT|B[DO][D.]?[ ]*TIME)\b(?![ ]*(?:PASS|CARD|GATE|GROUP|ENDS?|CLOSE|CLOSED|CLOSES))|登\s*[机機]\s*[时時]\s*[间間]/gi,
  departure:/\b(?:DEPARTURE(?:\s*TIME)?|DEPARTS?|DEPA[RY]TS|FLIGHT\s*DEPARTS|ABFLUGZEIT|SALIDA)\b|起飞时间|出发时间|出発時刻/gi,
  date:/\b(?:DATE|DATUM)\b|日期|搭乘日/gi,
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
      const competing=Math.max(0,...anchors.filter(anchor=>anchor.kind !== kind).map(anchor=>proximity(bounds,anchor,anchors)));
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
const nonScheduledTime = /实际|预计|ACTUAL|ESTIMATED|\bATD\b|\bATA\b|\bETD\b|\bETA\b/i;
const timeFromMatch = match => boardingTime(match[0].replace(/:\s*\./, ':').replace(/(?<=\d)\s+(?=\d)/g, ''));

export function plannedBoardingTime(text, layout) {
  const rows = rowsFrom(text, layout);
  const scheduled = rows.filter(row => !nonScheduledTime.test(rowText(row).text));
  const anchors = rows.flatMap(row => anchorsFor([row]).map(anchor =>
    nonScheduledTime.test(rowText(row).text) && anchor.kind === 'boarding' ? { ...anchor, kind: 'ignore' } : anchor));
  if (!layout) {
    // Plain OCR sometimes returns the column labels and their values on two lines.
    const values = [];
    let foundColumns = false;
    for (let i = 0; i < rows.length - 1; i++) {
      const heading = rowText(rows[i]).text;
      if (nonScheduledTime.test(heading) || /\d[:.]\s*\d/.test(heading)) continue;
      const labels = anchorsFor([rows[i]]).sort((a, b) => a.left - b.left);
      const boarding = labels.findIndex(anchor => anchor.kind === 'boarding');
      if (boarding < 0 || !labels.some(anchor => anchor.kind === 'departure') ||
          new Set(labels.map(anchor => anchor.kind)).size !== labels.length) continue;
      const next = rowText(rows[i + 1]).text.trim();
      const times = next.match(/\S+(?:\s+(?:AM|PM)\b)?/gi) ?? [];
      if (times.length === labels.length && /^[A-Z0-9\s:.]+$/i.test(next) &&
          times.some(value => /[\d][: .][\d]/.test(value))) {
        foundColumns = true;
        values.push(boardingTime(times[boarding]));
      }
    }
    if (foundColumns) return only(values);
  }
  return bestValue(rankedValues(scheduled, timeValues, timeFromMatch, 'boarding', anchors));
}


export function boardingScanRecords(label, { boardingCodes = [], boardingPayloads = [], boardingTime = '' } = {}) {
  const codes = new Map();
  for (const source of [...boardingPayloads, ...boardingCodes]) {
    try {
      const data = typeof source === 'string' ? null : normalizeBoardingCode(source);
      const payload = data ? String.fromCharCode(...codeBytes(data.rawBytes)) : source;
      const read = readBCBP(payload);
      if (!read) continue;
      // Paper and electronic copies can differ in the electronic-ticket flag.
      const key = payload.slice(0, 22) + ' ' + payload.slice(23);
      if (data || !codes.has(key)) codes.set(key, { data, read });
    } catch { /* A damaged symbol does not define a flight. */ }
  }
  if (codes.size > 1) return [];
  const sources = [{ kind: 'scan', label }];
  if (!codes.size) {
    return boardingTime ? [createRecord({ type: 'flight', template: 'air-boarding-pass', boardingTime, sources })] : [];
  }
  const { data, read } = codes.values().next().value;
  return read.legs.map((leg, index) => {
    const values = {
      type: 'flight', template: 'air-boarding-pass',
      service: leg.service, pnr: leg.pnr, passenger: leg.passengerChinese || leg.passenger,
      originCode: leg.originCode, destinationCode: leg.destinationCode,
      airline: airlineNameForCode(leg.carrier), seat: leg.seat, seatClass: leg.cabin,
      departureDate: { year: null, dayOfYear: leg.dayOfYear },
      ticketNumber: leg.ticketNumber, gate: leg.gate, ...boardingMetadataValues(leg),
      ...(data ? { boardingCode: data, boardingCodeSource: 'original', boardingLegIndex: String(index) } : {})
    };
    for (const side of ['origin', 'destination']) {
      values[side] = resolvePlace({ type: 'flight', [side]: values[side + 'Code'] }, side).name || values[side + 'Code'];
    }
    markFieldSources(values, Object.keys(values).filter(key => values[key] && !['type', 'template'].includes(key)), 'barcode');
    if (read.legCount === 1 && boardingTime) {
      values.boardingTime = boardingTime;
      markFieldSources(values, ['boardingTime'], 'ocr');
    }
    return createRecord({ ...values, sources, provenance: 'reconstruction' });
  });
}
