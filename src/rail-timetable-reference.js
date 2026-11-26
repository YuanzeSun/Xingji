import { calendarDate, journeyDate } from './journey-date.js';
import { railDepartureDay } from './rail-lookup-model.js';
import { bureauFromCode, normalizeRailBureau } from './rail-details.js';
import { normalizeRailJourney, railService, railStation, railText, railTime, RAIL_TIMETABLE_REFERENCES, sameRailTimetable, validRailDistances } from './rail-journey.js';

const SECONDS_PER_DAY = 86400;
const SHANGHAI_OFFSET = 8 * 3600;
const RAILLOG_API = 'https://api.raillog.top/api/train-timetables';
const TRACKER_API = 'https://crh.lihugang.top/api/v2';
const dayNumber = date => Date.parse(date + 'T00:00:00Z') / (SECONDS_PER_DAY * 1000);
const dayDate = day => new Date(day * SECONDS_PER_DAY * 1000).toISOString().slice(0, 10);
const offset = (day, time) => time ? day * SECONDS_PER_DAY + Number(time.slice(0, 2)) * 3600 + Number(time.slice(3)) * 60 : null;
const isOffset = value => Number.isInteger(value) && value >= 0 && value < 8 * SECONDS_PER_DAY;
const offsetTime = value => isOffset(value) ? new Date(value * 1000).toISOString().slice(11, 16) : '';
const offsetDate = (start, value) => isOffset(value) ? journeyDate(dayDate(start + Math.floor(value / SECONDS_PER_DAY))) : '';
const trackerCode = code => railService(typeof code?.prefix === 'string' && Number.isInteger(code.number) ? code.prefix + code.number : '');

async function fetchJSON(url, { fetcher, signal, name }) {
  let response;
  try { response = await fetcher(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(name + ' 暂时无法查询，请稍后重试');
  }
  if (!response.ok) throw new Error(name + (response.status === 429 ? ' 查询频繁，请稍后重试' : ' 暂时无法查询，请稍后重试'));
  const text = await response.text();
  if (text.length > 1000000) throw new Error(name + ' 返回的时刻表过大');
  try { return JSON.parse(text); }
  catch { throw new Error(name + ' 返回的时刻表格式异常'); }
}

async function railLogTimetable(query, options) {
  const versions = await fetchJSON(RAILLOG_API + '/versions', options);
  const boarding = query.boardingDate.replaceAll('-', '.');
  const version = Array.isArray(versions) && versions
    .filter(item => typeof item === 'string' && /^\d{4}\.\d{2}\.\d{2}$/.test(item) && item <= boarding)
    .sort().at(-1);
  if (!version) throw new Error('RailLog 未查到不晚于乘车日的快照');
  const url = new URL(RAILLOG_API);
  url.search = new URLSearchParams({ trainNumber: query.trainNum, version });
  const data = await fetchJSON(url, options);
  const snapshotDate = journeyDate(version.replaceAll('.', '-'));
  if (data?.version !== version || !railService(data.train_codes).split('/').includes(query.trainNum) ||
      !Array.isArray(data.stops) || data.stops.length < 2 || data.stops.length > 300) return { snapshotDate, timetables: [] };
  const stops = data.stops;
  if (stops.some(stop => !Number.isInteger(stop?.arrive_day_diff) || stop.arrive_day_diff < 0 || stop.arrive_day_diff > 7 ||
      /^(anomaly|train_unreliable)$/.test(stop.anomaly))) return { snapshotDate, timetables: [] };
  const withMileage = !stops.some(stop => stop.anomaly === 'too_fast') && validRailDistances(stops.map(stop => stop.mileage));
  return { snapshotDate, timetables: [{ stops: stops.map(stop => {
    const arrival = railTime(stop.arrive_time), departure = railTime(stop.start_time), day = stop.arrive_day_diff;
    return { station: railStation(stop.station_name), arrival: offset(day, arrival),
      departure: offset(railDepartureDay(day, arrival, departure), departure), distanceKm: withMileage ? stop.mileage : null };
  }) }] };
}

async function trackerTimetables(query, options) {
  const url = new URL(TRACKER_API + '/timetable/train/' + encodeURIComponent(query.trainNum) + '/history');
  url.searchParams.set('limit', '200');
  const payload = await fetchJSON(url, options), data = payload?.data;
  if (payload?.ok !== true || trackerCode(data?.trainCode) !== query.trainNum || !Array.isArray(data.items) || data.nextCursor) {
    throw new Error('Open CRH Tracker 未返回完整的车次历史时刻表');
  }
  return { timetables: data.items.flatMap(entry => {
    const stops = data.timetableMappings?.[entry?.timetableId]?.stops;
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > 300 ||
        !Number.isInteger(entry.serviceDayStart) || !Number.isInteger(entry.serviceDayEndExclusive)) return [];
    return [{ id: entry.timetableId, start: entry.serviceDayStart, end: entry.serviceDayEndExclusive,
      stops: stops.map(stop => ({ station: railStation(stop?.stationName), trainCode: trackerCode(stop?.stationTrainCode),
        arrival: stop?.arriveOffset, departure: stop?.departOffset })) }];
  }) };
}

async function trackerCurrentTimetable(query, options) {
  const url = new URL(TRACKER_API + '/timetable/train/' + encodeURIComponent(query.trainNum) + '/current');
  const timeout = AbortSignal.timeout(5000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const payload = await fetchJSON(url, { ...options, signal }), row = payload?.data;
  if (payload?.ok !== true || !Number.isInteger(row?.serviceDay) || !Array.isArray(row.stops) ||
      row.stops.length < 2 || row.stops.length > 300) return null;
  const numbers = [row.trainCode, ...(Array.isArray(row.allCodes) ? row.allCodes : [])].map(trackerCode);
  if (!numbers.includes(query.trainNum)) return null;

  const start = row.serviceDay, midnight = start * SECONDS_PER_DAY - SHANGHAI_OFFSET;
  const stops = row.stops.map(stop => ({
    station: railStation(stop?.stationName), trainCode: trackerCode(stop?.stationTrainCode),
    arrival: Number.isInteger(stop?.arriveAt) ? stop.arriveAt - midnight : null,
    departure: Number.isInteger(stop?.departAt) ? stop.departAt - midnight : null
  }));
  const code = bureauFromCode(railText(row.bureauCode)), name = normalizeRailBureau(railText(row.bureauName));
  const railBureau = code && name && code !== name ? '' : code || name;
  return { start, end: start + 1, stops, units: {
    railBureau, railRunner: railText(row.passengerDepartment), railCarOwner: railText(row.trainDepartment)
  } };
}

async function trackerTrainset(query, journey, timetableId, options) {
  // The history API uses timestamps at Shanghai midnight and reports the first-station service day.
  const day = dayNumber(calendarDate(journey.query.startDate));
  const start = day * SECONDS_PER_DAY - SHANGHAI_OFFSET;
  const url = new URL(TRACKER_API + '/history/train/' + encodeURIComponent(query.trainNum));
  url.search = new URLSearchParams({ start, end: start + SECONDS_PER_DAY - 1 });
  const { signal } = options;
  const timeout = AbortSignal.timeout(5000);
  const payload = await fetchJSON(url, { ...options, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  const data = payload?.data;
  if (payload?.ok !== true || trackerCode(data?.trainCode) !== query.trainNum || data.nextCursor || !Array.isArray(data.items)) return null;
  const dayRecords = data.items.filter(item => item?.serviceDay === day);
  if (dayRecords.length !== 1 || dayRecords[0].timetableId !== timetableId || dayRecords[0].status !== 1) return null;
  const id = railService(data.emuCodeMappings?.[dayRecords[0].emuId]);
  const model = /^(CR[A-Z\d-]{2,29})-\d{3,5}$/.exec(id)?.[1];
  return model ? { id, model } : null;
}

function referenceJourney(timetable, query, departureTime, timetableReference, queriedAt) {
  const { stops, start, end } = timetable;
  const from = stops.findIndex(stop => stop.station === query.origin), to = stops.findIndex(stop => stop.station === query.destination);
  if (from < 0 || to <= from || offsetTime(stops[from].departure) !== departureTime || !isOffset(stops[to].arrival)) return null;
  const startDay = dayNumber(query.boardingDate) - Math.floor(stops[from].departure / SECONDS_PER_DAY);
  if (startDay < start || startDay >= end) return null;
  const journey = normalizeRailJourney({
    query: { ...query, boardingDate: journeyDate(query.boardingDate), startDate: journeyDate(dayDate(startDay)) },
    timetableReference, queriedAt, distanceQueriedAt: Number.isFinite(stops[to].distanceKm) ? queriedAt : '',
    stops: stops.map(stop => ({
      station: stop.station, trainCode: stop.trainCode, distanceKm: stop.distanceKm,
      arrivalTime: offsetTime(stop.arrival), arrivalDate: offsetDate(startDay, stop.arrival),
      departureTime: offsetTime(stop.departure), departureDate: offsetDate(startDay, stop.departure),
      stopMinutes: isOffset(stop.arrival) && isOffset(stop.departure) ? Math.floor((stop.departure - stop.arrival) / 60) : null
    }))
  });
  const arrivalDate = dayDate(startDay + Math.floor(stops[to].arrival / SECONDS_PER_DAY));
  const arrivalTime = journey.stops[to].arrivalTime;
  const railMileage = journey.distanceQueriedAt ? String(Math.round((stops[to].distanceKm - stops[from].distanceKm) * 1000) / 1000) : '';
  return { result: { query, arrivalDate, arrivalTime, railMileage, railJourney: journey },
    signature: JSON.stringify([arrivalDate, arrivalTime, stops.slice(from + 1, to).map(stop => stop.station)]) };
}

export async function lookupRailTimetableReference(provider, query, departureTime, { fetcher = globalThis.fetch, signal } = {}) {
  const name = RAIL_TIMETABLE_REFERENCES[provider].name;
  if (!railTime(departureTime)) throw new Error('请先填写票面的出发时间，再查询历史时刻表');
  const tracker = provider === 'open-crh-tracker', options = { fetcher, signal, name };
  const today = Math.floor((Date.now() / 1000 + SHANGHAI_OFFSET) / SECONDS_PER_DAY);
  const boardingDay = dayNumber(query.boardingDate);
  // Current metadata is dated by the first station; boarding can be after midnight.
  const currentRequest = tracker && boardingDay >= today && boardingDay < today + 8
    ? trackerCurrentTimetable(query, options).catch(() => null) : null;
  const load = tracker ? trackerTimetables : railLogTimetable;
  const { snapshotDate, timetables, historyError } = await load(query, options).catch(error => {
    if (!currentRequest) throw error;
    return { timetables: [], historyError: error };
  });
  const queriedAt = new Date().toISOString();
  const matches = new Map();
  const timetableReference = { provider, ...(snapshotDate && { snapshotDate }) };
  const match = timetable => {
    try { return referenceJourney(timetable, query, departureTime, timetableReference, queriedAt); }
    catch { return null; }
  };
  for (const timetable of timetables) {
    const candidate = match(timetable);
    if (candidate) matches.set(candidate.signature, { result: candidate.result, timetableId: timetable.id });
  }
  if (matches.size > 1) throw new Error(name + ' 返回的历史时刻表有冲突，请核对后手动填写');
  const historical = matches.values().next().value;
  const stockRequest = tracker && historical
    ? trackerTrainset(query, historical.result.railJourney, historical.timetableId, options).catch(() => null) : null;
  const current = await currentRequest;
  const currentMatch = current && match(current);
  if (signal?.aborted) throw signal.reason;
  const result = historical?.result || currentMatch?.result;
  if (!result) throw historyError || new Error(name + ' 未查到与票面日期、区间和出发时间相符的时刻表');
  if (currentMatch && (!historical || sameRailTimetable(result.railJourney, currentMatch.result.railJourney))) {
    Object.assign(result, current.units);
  }
  if (stockRequest) {
    const trainset = await stockRequest;
    if (signal?.aborted) throw signal.reason;
    if (trainset) {
      result.railModel = trainset.model;
      result.railJourney = normalizeRailJourney({ ...result.railJourney, trainsets: [trainset] });
    }
  }
  return result;
}
