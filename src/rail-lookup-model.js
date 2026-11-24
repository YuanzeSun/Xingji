import {calendarDate,journeyDate} from './journey-date.js';
import {isLookupValue} from './lookup-values.js';
import { railRouteMatches, railRouteNeedsSave } from './rail-route-snapshot.js';
import { validDate } from './model.js';
import { resolvePlace } from './places.js';
import { bureauFromCode, normalizeRailBureau, parseRailGoModel } from './rail-details.js';
import { railText as clean, railStation as stationName, railService as service, railTime, normalizeRailJourney, sameRailTimetable } from './rail-journey.js';

export const shiftRailDate = (date, days) => { const result = new Date(calendarDate(date) + 'T00:00:00Z'); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); };
function endpoint(record, side) {
  const place = resolvePlace(record, side);
  if (['ambiguous', 'conflict'].includes(place.status)) throw new Error('请先确认出发站和到达站');
  return stationName(place.status === 'matched' ? place.name : record[side]);
}
export function railQuery(record, startDate = record.departureDate) {
  startDate=calendarDate(startDate);
  if (record.type !== 'rail' || record.template === 'rail-refund-receipt') throw new Error('此查询用于火车行程');
  const number = service(record.service), trainNum = number.split('/')[0];
  if (!/^(?:[GDCZTKYLS]\d{1,5}|\d{3,5})(?:\/(?:[GDCZTKYLS]?\d{1,5}))*$/.test(number)) throw new Error('车次无效');
  if (calendarDate(record.departureDate).length !== 10 || !validDate(calendarDate(record.departureDate))) throw new Error('请先选择完整的乘车日期');
  if (startDate?.length !== 10 || !validDate(startDate)) throw new Error('请选择完整的列车始发日期');
  const origin = endpoint(record, 'origin'), destination = endpoint(record, 'destination');
  if (!origin || !destination || origin === destination) throw new Error('请先填写不同的出发站和到达站');
  return { trainNum, date:startDate.replaceAll('-', ''), boardingDate:calendarDate(record.departureDate), origin, destination };
}

export function railDetails(payload, query, queriedAt = new Date().toISOString()) {
  const row = payload?.data;
  if (payload?.success !== true || !row || Array.isArray(row)) throw new Error('未查到该始发日期的列车资料，可手动填写');
  if (!Array.isArray(row.numberFull) || !row.numberFull.some(number => service(number) === query.trainNum)
    || !Array.isArray(row.rundays) || !row.rundays.includes(query.date)) throw new Error('返回资料未确认该车次与始发日期，未填入');
  if (!Array.isArray(row.timetable) || row.timetable.length > 300) throw new Error('返回时刻表格式异常，未填入');
  const from = row.timetable.findIndex(stop => stationName(stop?.station) === query.origin), to = row.timetable.findIndex(stop => stationName(stop?.station) === query.destination);
  if (from < 0 || to <= from) throw new Error('返回列车不符合已填写的乘车区间，未填入');
  if (row.timetable.filter(stop => stationName(stop?.station) === query.origin).length !== 1 || row.timetable.filter(stop => stationName(stop?.station) === query.destination).length !== 1) throw new Error('乘车站点存在多个匹配，未填入');
  const stop = row.timetable[from];
  if (!Number.isInteger(stop.day) || stop.day < 0 || stop.day > 7 || !railTime(stop.depart)) throw new Error('无法确认该站的发车日期，未填入');
  const offset = stop.day + (railTime(stop.arrive) && stop.depart < stop.arrive ? 1 : 0);
  const startDate = `${query.date.slice(0, 4)}-${query.date.slice(4, 6)}-${query.date.slice(6)}`;
  if (shiftRailDate(startDate, offset) !== query.boardingDate) {
    const suggested = shiftRailDate(query.boardingDate, -offset), error = new Error(`该站为始发后第 ${offset + 1} 天发车，请将列车始发日期改为 ${suggested} 后重查`);
    error.startDate = suggested; throw error;
  }
  const codeBureau = bureauFromCode(clean(row.bureau)), shortBureau = normalizeRailBureau(clean(row.bureauShortName));
  if (codeBureau && shortBureau && codeBureau !== shortBureau) throw new Error('返回路局信息不一致，未填入');
  const stops = row.timetable.map(item => {
    if (!Number.isInteger(item.day) || item.day < 0 || item.day > 7) throw new Error('经停站跨日资料异常，未填入');
    const arrivalTime = railTime(item.arrive), departureTime = railTime(item.depart);
    return { station:stationName(item.station), trainCode:service(item.trainCode), arrivalDate:arrivalTime ? shiftRailDate(startDate, item.day) : '', arrivalTime, departureDate:departureTime ? shiftRailDate(startDate, item.day + (arrivalTime && departureTime < arrivalTime ? 1 : 0)) : '', departureTime, stopMinutes:Number.isInteger(item.stopTime) ? item.stopTime : null };
  });
  let previous = calendarDate(stops[0].departureDate) + 'T' + stops[0].departureTime;
  for (const [i, item] of stops.entries()) {
    for (const side of (i === 0 ? [] : i === stops.length - 1 ? ['arrival'] : ['arrival','departure'])) if (item[side + 'Date'] && item[side + 'Time']) {
      const instant = calendarDate(item[side + 'Date']) + 'T' + item[side + 'Time'];
      if (instant < previous) throw new Error('经停站时间顺序异常，未填入');
      previous = instant;
    }
  }
  const railJourney = normalizeRailJourney({
    query: { trainNum: query.trainNum, startDate: journeyDate(startDate), boardingDate: journeyDate(query.boardingDate), origin: query.origin, destination: query.destination },
    queriedAt,
    stops: stops.map(stop => ({ ...stop, arrivalDate: journeyDate(stop.arrivalDate), departureDate: journeyDate(stop.departureDate) })),
  });
  const model=parseRailGoModel(clean(row.car));
  return { query, railBureau:codeBureau || shortBureau, railModel:model.model, railPowerSupply:model.powerSupply, railRunner:clean(row.runner), railCarOwner:clean(row.carOwner), departureTime:stops[from].departureTime, arrivalDate:stops[to].arrivalDate, arrivalTime:stops[to].arrivalTime, railJourney };
}

export function railCompletion(record, result, startDate) {
  const query = railQuery(record, startDate || result.railJourney?.query.startDate || record.departureDate);
  if (JSON.stringify(query) !== JSON.stringify(result.query)) return {};
  const values={...result,railTrainsets:(result.railJourney?.trainsets || []).map(stock=>stock.id).join(' / ')};
  const fields = ['railBureau','railModel','railTrainsets','railPowerSupply','railMileage','railRunner','railCarOwner','gate','railPlatform','departureTime','arrivalDate','arrivalTime'];
  const changes = Object.fromEntries(fields.filter(field => (!record[field] || isLookupValue(record,field)) && !record.lockedFields?.includes(field) && values[field]).map(field => [field, values[field]]));
  const differentTimetable = record.railJourney && result.railJourney
    && !sameRailTimetable(record.railJourney, result.railJourney);
  if (differentTimetable) {
    for (const field of ['railMileage', 'railTrainsets', 'gate', 'railPlatform']) {
      if (!values[field] && isLookupValue(record, field)) changes[field] = '';
    }
  }
  const route = result.railRoute || '';
  if (railRouteNeedsSave(record, route) ||
      (record.railJourney && railRouteMatches(record, route)
        && JSON.stringify(record.railRoute) !== JSON.stringify(route))) changes.railRoute = route;
  else if (differentTimetable && record.railRoute && !route) changes.railRoute = '';
  if (result.railJourney && JSON.stringify(record.railJourney) !== JSON.stringify(result.railJourney)) changes.railJourney = result.railJourney;
  return changes;
}
