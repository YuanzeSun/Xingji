import {AIRLINES} from './data/airline-reference.js';
import {airlineLogo} from './airline-logo.js';

const codes=new Map();
for(const row of AIRLINES)for(const code of row[3]){
  if(!codes.has(code))codes.set(code,[]);
  codes.get(code).push(row);
}
const nameKey=value=>String(value || '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'').replace(/(?:AIR(?:LINES?)?|AIRWAYS)$/,'');

export function airlineNameForCode(value) {
  const code=String(value || '').trim().toUpperCase();
  if(!/^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])$/.test(code))return '';
  const matches=codes.get(code) || [];
  if(matches.length===1)return matches[0][1] || matches[0][2];
  // The reference catalogue includes historical and subsidiary code reuse.
  // Use the existing passenger-airline library to identify the brand, rather
  // than taking whichever catalogue row happens to come first.
  const brand=airlineLogo(code);if(!brand)return '';
  const names=new Set([brand.name,...brand.names.filter(name=>!/^[A-Z0-9]{2,3}$/i.test(name))].map(nameKey));
  const identified=matches.filter(([,zh,en,,aliases])=>[zh,en,...aliases].some(name=>name && names.has(nameKey(name))));
  return identified.length===1 ? identified[0][1] || identified[0][2] : brand.name;
}
