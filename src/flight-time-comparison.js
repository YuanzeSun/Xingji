import { escape as e } from './html.js';
import { calendarDate } from './journey-date.js';
import { flightTiming, localInstant } from './journey-duration.js';

const dayMilliseconds = 86_400_000;

function boardingOnTimeline(record) {
  if (!record.boardingTime) return null;
  const departureDay = calendarDate(record.departureDate);
  // A boarding clock time can fall on either side of midnight near the scheduled takeoff.
  const localBoarding = Date.parse(`${departureDay}T${record.boardingTime}Z`);
  const localDeparture = Date.parse(`${departureDay}T${record.departureTime}Z`);
  const offset = Math.round((localDeparture - localBoarding) / dayMilliseconds);
  const date = offset ? new Date(Date.parse(departureDay) + offset * dayMilliseconds).toISOString().slice(0, 10) : departureDay;
  const instant = localInstant(date, record.boardingTime, record.departureZone);
  return Number.isFinite(instant) ? { date, instant } : null;
}

function clock(time, date, label) {
  const day = calendarDate(date);
  return `<time class="flight-timing-clock" datetime="${e(day)}T${e(time)}"><span class="visually-hidden">${label}</span><strong>${e(time)}</strong><small>${e(day)}</small></time>`;
}

function difference(minutes, earlier, later, equal) {
  if (!minutes) return equal;
  return `${minutes < 0 ? earlier : later} ${Math.abs(minutes)} 分钟`;
}

export function flightTimeComparison(record) {
  const { plannedDeparture, plannedArrival, actualDeparture, actualArrival, plannedMinutes,
    actualMinutes, departureDifference, arrivalDifference } = flightTiming(record);
  if (!plannedMinutes || !actualMinutes) return '';

  const boarding = boardingOnTimeline(record);
  const first = Math.min(plannedDeparture, actualDeparture, boarding?.instant ?? Infinity);
  const span = Math.max(plannedArrival, actualArrival, boarding?.instant ?? -Infinity) - first;
  const position = instant => ((instant - first) / span * 100).toFixed(3) + '%';
  const row = (kind, label, departure, arrival, departureClock, arrivalClock, boardingPoint) => `
    <div class="flight-timing-row ${kind}">
      <span class="flight-timing-label">${label}</span>${departureClock}
      <span class="flight-timing-axis" style="--from:${position(departure)};--to:${position(arrival)}${boardingPoint ? ';--boarding:' + position(boardingPoint.instant) : ''}">
        <span class="flight-timing-range" aria-hidden="true"></span>
        ${boardingPoint ? `<time class="flight-timing-boarding" datetime="${e(boardingPoint.date)}T${e(record.boardingTime)}">登机 ${e(record.boardingTime)}</time>` : ''}
      </span>
      ${arrivalClock}
    </div>`;

  return `<div class="flight-time-comparison" data-flight-time-comparison>
    <div class="flight-timing-row flight-timing-head" aria-hidden="true"><span></span><span>起飞</span><span>当地时间</span><span>落地</span></div>
    ${row('planned', '计划', plannedDeparture, plannedArrival, clock(record.departureTime, record.departureDate, '起飞'), clock(record.arrivalTime, record.arrivalDate, '落地'))}
    ${row('actual', '实际', actualDeparture, actualArrival, clock(record.actualDepartureTime, record.actualDepartureDate, '起飞'), clock(record.actualArrivalTime, record.actualArrivalDate, '落地'), boarding)}
    <dl class="flight-timing-differences">
      <div><dt>起飞较计划</dt><dd>${difference(departureDifference, '提前', '晚', '准点')}</dd></div>
      <div><dt>落地较计划</dt><dd>${difference(arrivalDifference, '提前', '晚', '准点')}</dd></div>
      <div><dt>在途较计划</dt><dd>${difference(actualMinutes - plannedMinutes, '少用', '多用', '与计划相同')}</dd></div>
    </dl>
  </div>`;
}
