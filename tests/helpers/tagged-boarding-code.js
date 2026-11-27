import {encodeBCBP} from '../../src/bcbp.js';

// Fictional data with the same tagged extension structure as the audited sample.
export function taggedBoardingPayload(overrides={}) {
  const header=encodeBCBP({passenger:'ZHANG/SAN',pnr:'ABC123',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1',...overrides});
  const hex=value=>value.toString(16).toUpperCase().padStart(2,'0');
  const unique='000',repeated='123'+'0000000001'+'0';
  const conditional='>1'+hex(unique.length)+unique+hex(repeated.length)+repeated+'****************';
  return header.slice(0,22)+'E'+header.slice(23,47)+'Z'+header.slice(48,58)+hex(conditional.length)+conditional+'#90张三#91北京#92上海#93A101#9418:21';
}
