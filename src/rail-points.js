import { createRecord, validDate } from './model.js';
import { calendarDate } from './journey-date.js';
import { resolvePlace } from './places.js';
import { RAIL_POINTS_SOURCE } from './field-sources.js';

export const RAIL_POINTS_PAGE = 'https://cx.12306.cn/tlcx/jfinformation.html';
export const RAIL_POINTS_EXTENSION = 'cdfbjakbkjobffeijnoghaaccohghome';

const seatNames = {
  '1': '硬座', '2': '软座', '3': '硬卧', '4': '软卧', '5': '包厢硬卧', '6': '高级软卧',
  '7': '一等软座', '8': '二等软座', '9': '商务座', A: '高级动卧', B: '混编硬座', C: '混编硬卧',
  D: '包厢软座', E: '特等软座', F: '动卧', G: '二人软包', H: '一人软包', I: '一等双软', J: '二等双软',
  K: '混编软座', L: '混编软卧', M: '一等座', O: '二等座', P: '特等座', Q: '观光座', S: '一等包座'
};
const text = value => typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, 100) : '';
const complete = value => /[*•●…]/u.test(value) ? '' : value;

function stationName(name, code) {
  name = text(name);
  const byCode = resolvePlace({ type: 'rail', originCode: text(code) }, 'origin');
  const station = name ? resolvePlace({ type: 'rail', origin: name, originCode: byCode.code }, 'origin') : byCode;
  if (station.status === 'matched') return station.name;
  if (station.status === 'unknown' && /\p{Script=Han}/u.test(name)) return name.replace(/站$/, '');
  return '';
}

export function railPointsRange(today = new Date()) {
  const end = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' }).format(today);
  const start = new Date(Date.parse(end) - 365 * 86400000).toISOString().slice(0, 10);
  return { start, end };
}

export function readRailPoints({ start, end }, runtime = globalThis.chrome?.runtime) {
  return new Promise((resolve, reject) => {
    const missing = () => reject(new Error('请安装「行迹 · 12306 连接」扩展，然后刷新行迹。'));
    if (typeof runtime?.sendMessage !== 'function') { missing(); return; }
    runtime.sendMessage(RAIL_POINTS_EXTENSION, { action: 'readRailPoints', start, end }, result => {
      if (runtime.lastError || !result) { missing(); return; }
      if (result.error) { reject(new Error(result.error)); return; }
      if (!Array.isArray(result.rides)) { reject(new Error('未能识别返回的乘车明细。')); return; }
      resolve(result.rides);
    });
  });
}

export function railPointsRecords(rides, at = new Date().toISOString()) {
  const found = new Map();
  for (const ride of rides) {
    if (!ride || ['fc', 'fr'].includes(ride.event)) continue;
    const service = text(ride.service).toUpperCase();
    const departureDate = text(ride.date).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
    if (!/^(?:[GDCZTKYLS]\d{1,5}|\d{3,5})(?:\/[GDCZTKYLS]?\d{1,5})*$/.test(service)
      || departureDate.length !== 10 || !validDate(departureDate)) continue;
    const origin = stationName(ride.origin, ride.originCode), destination = stationName(ride.destination, ride.destinationCode);
    if (!origin || !destination || origin === destination) continue;
    const seatCode = text(ride.seatClassCode);
    const seatText = text(ride.seatClass) || (Object.hasOwn(seatNames, seatCode) ? seatNames[seatCode] : '');
    const railStanding = ['无座', '站票'].includes(seatText);
    const values = {
      type: 'rail', origin, destination, service, departureDate, railStanding,
      seatClass: railStanding ? '' : seatText, carriage: text(ride.carriage),
      passenger: complete(text(ride.passenger)), orderNumber: complete(text(ride.orderNumber))
    };
    const event = ride.event === 'tg' ? '改签' : ride.event === 'ts' ? '升席' : '';
    found.set(JSON.stringify([values, event]), {
      event, record: createRecord({ ...values, sources: [{ kind: RAIL_POINTS_SOURCE, label: '12306 积分乘车明细', at }] })
    });
  }
  return [...found.values()].sort((a, b) => calendarDate(b.record.departureDate).localeCompare(calendarDate(a.record.departureDate)));
}
