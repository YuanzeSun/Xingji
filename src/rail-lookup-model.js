import {calendarDate,journeyDate,sameDate} from './journey-date.js';
import {isLookupValue} from './lookup-values.js';
import { importFieldSource, isRailLookupSource, railTimetableSource } from './field-sources.js';
import { ticketFieldLocked } from './barcode-fields.js';
import { railRouteNeedsSave } from './rail-route-snapshot.js';
import { validDate } from './model.js';
import { resolvePlace } from './places.js';
import { bureauFromCode, normalizeRailBureau, parseRailGoModel, RAIL_UNIT_FIELDS } from './rail-details.js';
import { railText as clean, railStation as stationName, railService as service, railTime, normalizeRailJourney, normalizeRailTrainsets, railJourneyMatches, railJourneyRange, sameRailTimetable } from './rail-journey.js';
import { isRailService } from './rail-service.js';

export const shiftRailDate = (date, days) => { const result = new Date(calendarDate(date) + 'T00:00:00Z'); result.setUTCDate(result.getUTCDate() + days); return result.toISOString().slice(0, 10); };
export const railDepartureDay = (day, arrival, departure) => day + (arrival && departure < arrival ? 1 : 0);
function endpoint(record, side) {
  const place = resolvePlace(record, side);
  if (['ambiguous', 'conflict'].includes(place.status)) throw new Error('请先确认出发站和到达站');
  return stationName(place.status === 'matched' ? place.name : record[side]);
}
export function railQuery(record, startDate = record.departureDate) {
  if (record.type !== 'rail' || record.template === 'rail-refund-receipt') throw new Error('此查询用于火车行程');
  const number = service(record.service), trainNum = number.split('/')[0];
  if (!isRailService(number, { combined: true })) throw new Error('车次无效');
  const boardingDate = calendarDate(record.departureDate);
  if (boardingDate.length !== 10 || !validDate(boardingDate)) throw new Error('请先选择完整的乘车日期');
  startDate = calendarDate(startDate);
  if (startDate.length !== 10 || !validDate(startDate)) throw new Error('请选择完整的查询日期');
  const origin = endpoint(record, 'origin'), destination = endpoint(record, 'destination');
  if (!origin || !destination || origin === destination) throw new Error('请先填写不同的出发站和到达站');
  return { trainNum, date:startDate.replaceAll('-', ''), boardingDate, origin, destination };
}

const runDateLabel = value => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;

export function railDetails(payload, query, queriedAt = new Date().toISOString(), { allowReference = false } = {}) {
  const row = payload?.data;
  if (payload?.success !== true || !row || Array.isArray(row)) throw new Error('未查到该日期的列车资料');
  if (!Array.isArray(row.numberFull) || !row.numberFull.some(number => service(number) === query.trainNum)) {
    throw new Error('RailGo 未确认所查车次');
  }
  if (!Array.isArray(row.timetable) || row.timetable.length > 300) throw new Error('返回时刻表格式异常，未填入');
  const from = row.timetable.findIndex(stop => stationName(stop?.station) === query.origin), to = row.timetable.findIndex(stop => stationName(stop?.station) === query.destination);
  if (from < 0 || to < 0) {
    const missing = [from < 0 && query.origin, to < 0 && query.destination].filter(Boolean).join('、');
    throw new Error(`RailGo 已返回时刻表，但乘车区间缺少「${missing}」，未填入`);
  }
  const stop = row.timetable[from];
  if (!Number.isInteger(stop.day) || stop.day < 0 || stop.day > 7 || !railTime(stop.depart)) throw new Error('无法确认该站的发车日期，未填入');
  if (!Array.isArray(row.rundays) || !row.rundays.includes(query.date)) throw new Error('RailGo 未确认查询日期开行，未填入');
  const offset = railDepartureDay(stop.day, railTime(stop.arrive), railTime(stop.depart));
  const startDate = runDateLabel(query.date);
  const boardingDate = shiftRailDate(startDate, offset);
  const reference = boardingDate !== query.boardingDate;
  if (reference && !allowReference) throw new Error(`查询结果对应的上车日为 ${boardingDate}，未填入`);
  const codeBureau = bureauFromCode(clean(row.bureau)), shortBureau = normalizeRailBureau(clean(row.bureauShortName));
  if (codeBureau && shortBureau && codeBureau !== shortBureau) throw new Error('返回路局信息不一致，未填入');
  const stops = row.timetable.map(item => {
    if (!Number.isInteger(item?.day) || item.day < 0 || item.day > 7) throw new Error('经停站跨日资料异常，未填入');
    const arrivalTime = railTime(item.arrive), departureTime = railTime(item.depart);
    return {
      station: stationName(item.station), trainCode: service(item.trainCode),
      arrivalDate: arrivalTime ? journeyDate(shiftRailDate(startDate, item.day)) : '', arrivalTime,
      departureDate: departureTime ? journeyDate(shiftRailDate(startDate, railDepartureDay(item.day, arrivalTime, departureTime))) : '', departureTime,
      stopMinutes: item.stopTime
    };
  });
  const railJourney = normalizeRailJourney({
    query: { trainNum: query.trainNum, startDate: journeyDate(startDate), boardingDate: journeyDate(boardingDate), origin: query.origin, destination: query.destination,
      ...(reference && { referenceFor: journeyDate(query.boardingDate) }) },
    queriedAt,
    stops
  });
  const model=parseRailGoModel(clean(row.car));
  return { query, railBureau:codeBureau || shortBureau, railModel:model.model, railPowerSupply:model.powerSupply, railRunner:clean(row.runner), railCarOwner:clean(row.carOwner), departureTime:stops[from].departureTime, arrivalDate:calendarDate(stops[to].arrivalDate), arrivalTime:stops[to].arrivalTime, railJourney };
}
export const RAIL_LOOKUP_LABELS = {
  railBureau: '担当路局', railRunner: '担当客运段', railCarOwner: '车辆归属单位',
  railModel: '车型', railTrainsets: '车组编号', railPowerSupply: '供电制式', railMileage: '铁路里程',
  gate: '检票口', railPlatform: '上车站台', departureTime: '出发时间', arrivalDate: '到达日期',
  arrivalTime: '到达时间', railJourney: '列车时刻表'
};
const railFields = Object.keys(RAIL_LOOKUP_LABELS).filter(field => field !== 'railJourney');
const invalidatedDetails = new Set(['railMileage', 'railTrainsets', 'gate', 'railPlatform']);

export function railLookupDataDate(journey, field) {
  const reference = journey.timetableReference;
  if (RAIL_UNIT_FIELDS.includes(field) && reference?.unitsDate) return calendarDate(reference.unitsDate);
  return calendarDate(reference?.snapshotDate || journey.query.startDate);
}

function segmentTimetable(journey) {
  const day = Date.parse(calendarDate(journey.query.boardingDate));
  return JSON.stringify(railJourneyRange(journey).stops.map(({ station, arrivalDate, arrivalTime, departureDate, departureTime }, index, stops) => [
    station, index && arrivalTime ? [(Date.parse(calendarDate(arrivalDate)) - day) / 86400000, arrivalTime] : null,
    index < stops.length - 1 && departureTime ? [(Date.parse(calendarDate(departureDate)) - day) / 86400000, departureTime] : null
  ]));
}

function sameRailValue(field, first, second) {
  if (field === 'arrivalDate') return sameDate(first, second);
  if (field === 'railMileage') return Number(first) === Number(second);
  if (field === 'railBureau') return normalizeRailBureau(first) === normalizeRailBureau(second);
  if (field === 'railTrainsets') return normalizeRailTrainsets(first) === normalizeRailTrainsets(second);
  return first === second;
}

export function railCompletion(record, result, startDate, conflicts) {
  const journey = result.railJourney;
  if (JSON.stringify(railQuery(record, startDate)) !== JSON.stringify(result.query)) return {};
  const saved = railJourneyMatches(record) ? record.railJourney : null;
  const kind = railTimetableSource(journey);
  const fieldSource = importFieldSource(kind);
  const sameDataset = saved && railTimetableSource(saved) === kind && railLookupDataDate(saved) === railLookupDataDate(journey);
  const timetableChanged = sameDataset && !sameRailTimetable(saved, journey);
  const values = { ...result, railTrainsets: journey.trainsets.map(stock => stock.id).join(' / ') };
  if (journey.query.referenceFor) {
    const overnight = (Date.parse(result.arrivalDate) - Date.parse(calendarDate(journey.query.boardingDate))) / 86400000;
    values.arrivalDate = shiftRailDate(journey.query.referenceFor, overnight);
  }

  const changes = {};
  for (const field of railFields) {
    if (ticketFieldLocked(record, field)) continue;
    const current = record[field], next = values[field], previousSource = record.fieldSources?.[field];
    const automatic = isLookupValue(record, field);
    if (!next) {
      if (automatic && timetableChanged && previousSource === fieldSource && invalidatedDetails.has(field)) changes[field] = '';
      continue;
    }
    if (!current && !record.lockedFields?.includes(field)) {
      changes[field] = next;
      continue;
    }
    if (sameRailValue(field, current, next)) continue;
    const previousDate = record.railFieldDates?.[field];
    const differentDate = previousDate && previousDate !== railLookupDataDate(journey, field);
    if (previousSource === fieldSource && automatic && !differentDate) {
      changes[field] = next;
    } else if (current && (isRailLookupSource(previousSource) || previousSource === 'manual')) {
      conflicts?.push({ field, current, proposed: next });
    }
  }

  if (result.railRoute && railRouteNeedsSave(record, result.railRoute)) changes.railRoute = result.railRoute;
  else if (timetableChanged && fieldSource === 'railgo' && record.railRoute && !result.railRoute) changes.railRoute = '';

  if (!saved || sameDataset) {
    if (JSON.stringify(saved) !== JSON.stringify(journey)) changes.railJourney = journey;
  } else if (segmentTimetable(saved) !== segmentTimetable(journey)) {
    conflicts?.push({ field: 'railJourney', current: saved, proposed: journey });
  }
  return changes;
}
