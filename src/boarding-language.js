import { resolvePlace, normalizePlaceKey } from './places.js';
import { AIRLINES as AIRLINE_DATABASE } from './data/airline-reference.js';
import {readBoardingCode} from './bcbp.js';
import {flightPassengerEnglishName,flightPassengerName} from './flight-passenger.js';

const CHINESE_REGIONS = new Set(['CN', 'HK', 'MO', 'TW']);
const hasChinese = value => /\p{Script=Han}/u.test(value || '');
const WORDS = {
  zh: { title:'登机牌', name:'姓名', flight:'航班', date:'日期', from:'始发地', to:'目的地', gate:'登机口', seat:'座位', boarding:'登机时间', cabin:'舱位', terminal:'航站楼', departure:'起飞时间', route:'航程', ticket:'票号', pnr:'订座编号', airport:'出发机场', airline:'航空旅程', aircraft:'机型', registration:'飞机编号' },
  en: { title:'BOARDING PASS', name:'NAME', flight:'FLIGHT', date:'DATE', from:'FROM', to:'TO', gate:'GATE', seat:'SEAT', boarding:'BOARDING', cabin:'CLASS', terminal:'TERMINAL', departure:'DEPARTURE', route:'ROUTE', ticket:'ETKT', pnr:'PNR', airport:'DEPARTURE AIRPORT', airline:'AIR TRAVEL', aircraft:'AIRCRAFT', registration:'REG' }
};

// Public airline names checked against airport directories, 2026-11-16:
// https://www.shanghaiairport.com/airlines/index.html
// https://www.shanghaiairport.com/ensh/airlines/index.html
// https://www.hongkongairport.com/en/transport/mainland-connection/participating-airlines-list.page
const AIRLINES = [
  ['中国国际航空', 'Air China', '国航'],
  ['中国东方航空', 'China Eastern Airlines', '东航'],
  ['中国南方航空', 'China Southern Airlines', '南航'],
  ['海南航空', 'Hainan Airlines', '海航'],
  ['深圳航空', 'Shenzhen Airlines', '深航'],
  ['四川航空', 'Sichuan Airlines', '川航'],
  ['厦门航空', 'Xiamen Airlines', '厦航', 'XiamenAir'],
  ['山东航空', 'Shandong Airlines', '山航'],
  ['春秋航空', 'Spring Airlines', '中国春秋航空'],
  ['吉祥航空', 'Juneyao Airlines'],
  ['新加坡航空', 'Singapore Airlines', '新航'],
  ['国泰航空', 'Cathay Pacific', '國泰航空', 'Cathay Pacific Airways']
];
const airlineKey = value => normalizePlaceKey(value).replace(/(?:股份)?有限公司$|公司$/, '');
const airlineNames = new Map();
const referenceNames = new Map();
for (const [id, zh, en, codes, aliases] of AIRLINE_DATABASE) {
  if (!zh || !en) continue;
  for (const name of [zh, en, ...codes, ...aliases]) {
    const normalized = airlineKey(name);
    if (!referenceNames.has(normalized)) referenceNames.set(normalized, new Map());
    referenceNames.get(normalized).set(id, { zh, en });
  }
}
for (const [name, entries] of referenceNames) if (entries.size === 1) airlineNames.set(name, [...entries.values()][0]);
for (const [zh, en, ...aliases] of AIRLINES) {
  for (const alias of [zh, en, ...aliases, zh + en, en + zh]) airlineNames.set(airlineKey(alias), { zh, en });
}

export function boardingPresentation(record) {
  const origin = resolvePlace(record, 'origin');
  const language = origin.status === 'matched'
    ? CHINESE_REGIONS.has(origin.country) ? 'zh' : 'en'
    : hasChinese(record.origin) || !(record.origin || record.originCode) ? 'zh' : 'en';
  const words = WORDS[language];
  const routeName = side => {
    const place = side === 'origin' ? origin : resolvePlace(record, side);
    const supplied = record[side] || '';
    if (place.status !== 'matched') return supplied;
    return language === 'zh'
      ? place.chineseName || supplied || place.name
      : place.municipality || place.englishName;
  };
  const airport = origin.status !== 'matched' ? record.origin || words.airport
    : language === 'zh' ? origin.chineseFullName || origin.englishName : origin.englishName;
  const carrierNames = airlineNames.get(airlineKey(record.airline));
  const airline = carrierNames?.[language] || record.airline || words.airline;
  const code = readBoardingCode(record.boardingCode, record.boardingLegIndex) || {};
  return { language, words, airport, airline, carrierNames, origin: routeName('origin'), destination: routeName('destination'),
    passenger: flightPassengerName(record, code), passengerEnglish: flightPassengerEnglishName(record, code) };
}
