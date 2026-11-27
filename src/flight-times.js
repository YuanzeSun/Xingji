const actualFlightTimes = { actualDepartureDate: 'actualDepartureTime', actualArrivalDate: 'actualArrivalTime' };
export const ACTUAL_FLIGHT_FIELDS = Object.entries(actualFlightTimes).flat();
export const OPTIONAL_FLIGHT_TIMES = { arrivalDate: 'arrivalTime', ...actualFlightTimes };
export const FLIGHT_LOCAL_TIMES = '起飞、登机按出发地当地时间，落地按到达地当地时间。';
export function flightTimeZoneLabel(field) {
  if (['arrivalTime', 'actualArrivalTime'].includes(field)) return '到达地当地时间';
  if (['departureTime', 'actualDepartureTime', 'boardingTime'].includes(field)) return '出发地当地时间';
  return '';
}
export const FLIGHT_TIME_LABELS = {
  departureDate: '计划起飞日期', departureTime: '计划起飞时间', arrivalDate: '计划到达日期', arrivalTime: '计划到达时间', boardingTime: '登机时间',
  actualDepartureDate: '实际起飞日期', actualDepartureTime: '实际起飞时间', actualArrivalDate: '实际到达日期', actualArrivalTime: '实际到达时间'
};
