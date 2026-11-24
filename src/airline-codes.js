import {AIRLINES} from './data/airline-reference.js';
import {airlineLogo} from './airline-logo.js';

const codes=new Map();
for(const row of AIRLINES)for(const code of row[3]){
  if(!codes.has(code))codes.set(code,[]);
  codes.get(code).push(row);
}
const nameKey=value=>String(value || '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'').replace(/(?:AIR(?:LINES?)?|AIRWAYS)$/,'');
const labelKey = value => nameKey(value).replace(/(?:股份)?有限公司$|公司$|(?:COLTD|LTD|INCORPORATED|INC|LIMITED)$/, '').replace(/(?:AIR(?:LINES?)?|AIRWAYS)$/, '');
let labels;

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

export function airlineNameForLabel(value) {
  const label = String(value || '').trim().normalize('NFKC');
  if (!label || /^(?:[-—]+|未知|未填写|未识别|n\/?a|null|undefined)$/i.test(label)) return '';
  const codeName = airlineNameForCode(label);
  if (codeName) return codeName;
  const brand = airlineLogo(label);
  if (brand) return airlineNameForCode(brand.code) || brand.name;
  if (!labels) {
    labels = new Map();
    for (const [, zh, en, , aliases] of AIRLINES) for (const name of [zh, en, ...aliases]) {
      const key = labelKey(name);
      if (!key) continue;
      if (!labels.has(key)) labels.set(key, new Set());
      labels.get(key).add(zh || en);
    }
  }
  const matches = labels.get(labelKey(label));
  return matches?.size === 1 ? matches.values().next().value : label;
}
