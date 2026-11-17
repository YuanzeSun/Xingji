export const ACTUAL_FLIGHT_FIELDS = ['actualDepartureDate', 'actualDepartureTime', 'actualArrivalDate', 'actualArrivalTime','actualBoardingTime'];
export const FLIGHT_TIME_LABELS = {
  departureDate: '计划起飞日期', departureTime: '计划起飞时间', arrivalDate: '计划到达日期', arrivalTime: '计划到达时间', boardingTime: '计划登机时间',
  actualBoardingTime:'实际登机时间', actualDepartureDate: '实际起飞日期', actualDepartureTime: '实际起飞时间', actualArrivalDate: '实际到达日期', actualArrivalTime: '实际到达时间'
};

// Read explicitly labelled events only. A time without a date stays undated:
// delays, overnight flights and different airport time zones make guessing unsafe.
export function labelledFlightTimes(text) {
  const source = String(text).normalize('NFKC').split(/\r?\n/).filter(line => !/前序|前段|后续|上一航班|下一航班/.test(line)).join('\n');
  const fields = {};
  const events = [
    ['departure', '计划(?:起飞|出发)|\\bSCHEDULED\\s+(?:DEPARTURE|TAKE[ -]?OFF)\\b|\\bSTD\\b'],
    ['arrival', '计划(?:到达|降落|抵达)|\\bSCHEDULED\\s+(?:ARRIVAL|LANDING)\\b|\\bSTA\\b'],
    ['actualDeparture', '实际(?:起飞|离地)|\\bACTUAL\\s+(?:DEPARTURE|TAKE[ -]?OFF)\\b|\\bATD\\b'],
    ['actualArrival', '实际(?:到达|降落|抵达)|\\bACTUAL\\s+(?:ARRIVAL|LANDING)\\b|\\bATA\\b']
  ];
  for (const [event, labels] of events) {
    const pattern = new RegExp(`(?:${labels})(?:\\s*(?:日期|时间|时刻|DATE|TIME))?\\s*[:：]?\\s*(?:((?:19|20)\\d{2})[-/.年](\\d{1,2})[-/.月](\\d{1,2})日?[ T\\s]*)?([0-2]?\\d:[0-5]\\d)?`, 'gi');
    const dates = new Set(), times = new Set();
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        const parsed = new Date(date + 'T00:00:00Z');
        if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) dates.add(date);
      }
      if (match[4] && Number(match[4].split(':')[0]) < 24) times.add(match[4].padStart(5, '0'));
    }
    if (dates.size === 1) fields[event + 'Date'] = [...dates][0];
    if (times.size === 1) fields[event + 'Time'] = [...times][0];
  }
  return fields;
}
