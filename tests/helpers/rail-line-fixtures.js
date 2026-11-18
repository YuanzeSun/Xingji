import {railWgs84Point} from '../../src/rail-projection.js';
import {matchRailLineNames} from '../../src/rail-line-names.js';

const a=[116,39], b=[116.2,39], c=[116.4,39];
const geometry={segments:[[a,b,c]],stops:[{name:'甲站',coordinates:a},{name:'乙站',coordinates:b},{name:'丙站',coordinates:c}]};
const line=(name,points,stations)=>({name,segments:[points.map(railWgs84Point)],stations});
const cases=[
  ['connected lines',[line('甲客专',[a,b],['甲站','乙站']),line('乙线',[b,c],['乙站','丙站'])]],
  ['parallel line excluded',[line('平行线',[[116,39.005],[116.4,39.005]],['甲站','丙站'])]],
  ['ambiguous overlap excluded',[line('歧义甲线',[a,c],['甲站','丙站']),line('歧义乙线',[a,c],['甲站','丙站'])]],
  ['short station overlap excluded',[line('仅站前共线',[a,[116.03,39]],['甲站','丙站'])]],
];
export const railLineFixtures=cases.map(([name,lines])=>({name,geometry,lines,expected:matchRailLineNames(geometry,lines)}));
