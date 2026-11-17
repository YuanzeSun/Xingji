import {encodeBCBP} from '../../src/bcbp.js';
import {normalizeCodeData} from '../../src/barcode-data.js';
const hex=number=>number.toString(16).toUpperCase().padStart(2,'0');
export function multilegPayload({count=2}={}) {
  const routes=[['CA','1234','PEK','PVG','2024-12-31','12A'],['UA','857','PVG','SFO','2025-01-01','20C'],['UA','100','SFO','LAX','2025-01-02','30D'],['CA','988','LAX','PEK','2025-01-03','42A']];
  let shared='';
  const legs=routes.slice(0,count).map(([carrier,flightNumber,origin,destination,date,seat],index)=>{
    const fixed=encodeBCBP({passenger:'ZHANG/SAN',pnr:'ABC123',origin,destination,carrier,flightNumber,date,seat,cabin:'Y',sequence:String(20+index),status:'1',electronic:''});
    shared=fixed.slice(2,23);
    const unique='0WM'+'6366'+'B'+'CA '+'0123456789002';
    const repeated='123'+String(index+1).padStart(10,'0')+'0'+'0'+'LH '+'CA '+'00000123456789'.padEnd(16,' ')+' '+'20K'+'N';
    const tagged=index===0 ? String.fromCharCode(...new TextEncoder().encode('#90张三#91北京#92上海#93A101#9418:21')) : '';
    const variable=(index===0?'>8'+hex(unique.length)+unique:'')+hex(repeated.length)+repeated+tagged;
    return fixed.slice(23,58)+hex(variable.length)+variable;
  });
  return 'M'+count+shared+legs.join('');
}
export function multilegCode(options) {
  return normalizeCodeData({version:1,format:'PDF417',rawBytes:btoa(multilegPayload(options)),symbologyIdentifier:']L2',gs1:false,eci:[],parameters:{symbolVersion:'',errorCorrectionLevel:'',mask:null}});
}
