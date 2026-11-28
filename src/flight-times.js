import { flightTiming, localInstant } from './journey-duration.js';

const actualFlightTimes = { actualDepartureDate: 'actualDepartureTime', actualArrivalDate: 'actualArrivalTime' };
export const ACTUAL_FLIGHT_FIELDS = Object.entries(actualFlightTimes).flat();
export const OPTIONAL_FLIGHT_TIMES = { arrivalDate: 'arrivalTime', ...actualFlightTimes };
export const FLIGHT_DATE_DEFAULT_ATTR = 'data-flight-date-default';
export function flightTimeZoneLabel(field) {
  if (['arrivalTime', 'actualArrivalTime'].includes(field)) return '到达地当地时间';
  if (['departureTime', 'actualDepartureTime', 'boardingTime'].includes(field)) return '出发地当地时间';
  return '';
}
export const FLIGHT_TIME_LABELS = {
  departureDate: '计划起飞日期', departureTime: '计划起飞时间', arrivalDate: '计划到达日期', arrivalTime: '计划到达时间', boardingTime: '登机时间',
  actualDepartureDate: '实际起飞日期', actualDepartureTime: '实际起飞时间', actualArrivalDate: '实际到达日期', actualArrivalTime: '实际到达时间'
};

const oneDay = 24 * 60 * 60 * 1000;

export function validateFlightTimes(record) {
  if (record.type !== 'flight') return;
  const { plannedDeparture, plannedArrival, actualDeparture, actualArrival } = flightTiming(record);
  for (const [label, departure, arrival, fields] of [
    ['计划', plannedDeparture, plannedArrival, ['arrivalDate', 'arrivalTime']],
    ['实际', actualDeparture, actualArrival, ['actualArrivalDate', 'actualArrivalTime']],
  ]) {
    if (arrival < departure) {
      throw Object.assign(new Error(`${label}到达时间不能早于${label}起飞时间。`), { fields });
    }
  }
  for (const [label, elapsed, plannedDate, plannedTime, actualDate, actualTime] of [
    ['起飞', actualDeparture - plannedDeparture, 'departureDate', 'departureTime', 'actualDepartureDate', 'actualDepartureTime'],
    ['到达', actualArrival - plannedArrival, 'arrivalDate', 'arrivalTime', 'actualArrivalDate', 'actualArrivalTime'],
  ]) {
    // Both times use the same airport clock. Compare its readings if an instant cannot be resolved.
    const difference = Number.isFinite(elapsed) ? elapsed :
      localInstant(record[actualDate], record[actualTime], 'UTC') - localInstant(record[plannedDate], record[plannedTime], 'UTC');
    if (Math.abs(difference) > oneDay) {
      throw Object.assign(new Error(`计划${label}与实际${label}时间相差超过 24 小时，请核对日期和时间。`), {
        fields: [actualDate, actualTime]
      });
    }
  }
}

export function flightTimeWarnings(record) {
  if (record.type !== 'flight') return [];
  const warnings = [];
  const { departureTime, actualDepartureTime, arrivalTime, actualArrivalTime } = record;
  if (departureTime && departureTime === actualDepartureTime) warnings.push(`计划和实际起飞时间相同（${departureTime}）。`);
  if (arrivalTime && arrivalTime === actualArrivalTime) warnings.push(`计划和实际到达时间相同（${arrivalTime}）。`);

  const { plannedDeparture, plannedArrival, actualDeparture, actualArrival, plannedMinutes, actualMinutes } = flightTiming(record);
  const planned = plannedArrival - plannedDeparture;
  const actual = actualArrival - actualDeparture;
  if (planned > 0 && actual >= 0) {
    const difference = actual >= planned * 2 ? '达到计划的 2 倍或以上' : actual * 2 <= planned ? '只有计划的一半或更短' : '';
    if (difference) warnings.push(`实际在途时间${difference}（实际 ${actualMinutes} 分钟，计划 ${plannedMinutes} 分钟）。`);
  }
  return warnings;
}
