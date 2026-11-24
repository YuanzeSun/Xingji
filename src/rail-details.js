// RailGo's bureau codes identify the train's operator, not its departure station.
// https://api.railgo.dev/9408882m0
export const RAIL_BUREAUS = [
  ['B','哈尔滨局','哈局'], ['C','呼和浩特局','呼局'], ['F','郑州局','郑局'], ['G','南昌局','南局'],
  ['H','上海局','上局'], ['J','兰州局','兰局'], ['K','济南局','济局'], ['M','昆明局','昆局'],
  ['N','武汉局','武局'], ['O','青藏铁路公司','青藏','青藏集团'], ['P','北京局','京局'], ['Q','广铁集团','广铁','广州局'],
  ['R','乌鲁木齐局','乌局'], ['T','沈阳局','沈局'], ['U','广东城际铁路公司','广东城际'],
  ['V','太原局','太局'], ['W','成都局','成局'], ['X','香港铁路公司','港铁'], ['Y','西安局','西局'], ['Z','南宁局','宁局']
];
const names = new Map();
for (const [code, name, ...aliases] of RAIL_BUREAUS) {
  for (const alias of [name, ...aliases, ...(name.endsWith('局') ? [name.replace(/局$/, '铁路局'), '中国铁路' + name + '集团有限公司', name + '集团'] : [])]) names.set(alias, name);
}
export const bureauFromCode = code => RAIL_BUREAUS.find(row => row[0] === code)?.[1] || '';
export function normalizeRailBureau(value = '') {
  const text = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  return names.get(text) || text;
}
function railModelText(value = '') {
  const text = value.normalize('NFKC').trim().toUpperCase().replace(/[–—]/g, '-').replace(/\s+/g, ' '), compact = text.replace(/\s/g, '');
  return /^[A-Z]{1,6}\d[A-Z\d-]*$/.test(compact) ? compact : text;
}
export function normalizeRailPowerSupply(value = '') {
  return value.normalize('NFKC').trim().toUpperCase().replace(/\s+/g,'');
}
export function splitRailModel(value = '') {
  const text=railModelText(value);
  const powers=[];
  const model=text.split(/\s*\/\s*/).map(part=>{
    if(/^(?:AC|DC)\s*\d+(?:\.\d+)?\s*V$/.test(part)){powers.push(normalizeRailPowerSupply(part));return '';}
    if(!/^25[A-Z]/.test(part))return part;
    const cleaned=part.replace(/((?:AC|DC)\s*\d+(?:\.\d+)?\s*V)(?:\s*供电)?/g,(_,power)=>{powers.push(normalizeRailPowerSupply(power));return '';}).replace(/\(\s*\)/g,'').trim();
    return cleaned;
  }).filter(Boolean).join(' / ');
  return {model,powerSupply:[...new Set(powers)].join(' / ')};
}
export const normalizeRailModel = value => splitRailModel(value).model;

export function parseRailGoModel(value='') {
  // RailGo's own provider dictionary distinguishes these model labels.
  // https://github.com/RailGoApps/RailGo-Parser/blob/main/railgo/config.py
  const text=railModelText(value),key=text.replace(/\s/g,'');
  const aliases={BST:'25T (BSP)',BSTAC380V:'25T (BSP) AC380V','25TAC380V':'25T (BSP) AC380V','25TDC600V':'25T (国产) DC600V'};
  return splitRailModel(aliases[key] || text);
}
