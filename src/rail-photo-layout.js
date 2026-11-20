import { ocrWords } from './ocr-layout.js';
import { calendarDate } from './journey-date.js';
import { readRailDateRow } from './scan-date.js';
import { SEAT_CLASSES } from './seat-classes.js';
import { printedRailNumber, railFareFromLine, railIssuerFromLine, railSeatFromLine, railStationFromRegion, trainCode } from './rail-ticket.js';

function projection(line, anchor) {
  const x = line.centerX - anchor.centerX, y = line.centerY - anchor.centerY;
  return {
    along: x * anchor.cos + y * anchor.sin,
    below: y * anchor.cos - x * anchor.sin
  };
}

export function locateRailRoute(lines) {
  const stations = lines.filter(line => line.score >= .5).map(line => {
    if (line.header) return { ...line, name: line.header.station, printed: true, known: true };
    const known = railStationFromRegion(line.text, { fuzzy: false });
    const han = line.text.replace(/\s/g, '').match(/^(\p{Script=Han}{1,7}?)站?$/u)?.[1];
    const printed = han && (known || han.length > 1 && line.score >= .88) ? han : '';
    return { ...line, name: printed || known, printed: !!printed, known: !!known };
  }).filter(line => line.name);
  const routes = [];
  for (const train of lines.filter(line => line.train && line.score >= .76)) {
    const nearby = stations.map(line => ({ ...line, ...projection(line, train) })).filter(line =>
      (!line.header || line.along < 0) &&
      Math.abs(line.below) <= Math.max(line.glyphHeight, train.glyphHeight) * (line.printed && !line.header ? .84 : 1.5)
      && Math.abs(line.along) >= (line.glyphWidth + train.glyphWidth) * .41);
    const stationsInRow = nearby.map(line => {
      if (!line.printed || line.known) return line;
      const romanized = nearby.filter(candidate => !candidate.printed && candidate.known && candidate.score >= .8 &&
        candidate.below > line.below && candidate.below - line.below <= train.glyphHeight * 1.3 &&
        Math.abs(candidate.along - line.along) <= Math.max(line.glyphWidth, candidate.glyphWidth) * .44);
      const names = new Set(romanized.map(candidate => candidate.name));
      return names.size === 1 ? { ...line, name: names.values().next().value, known: true } : line;
    });
    const left = stationsInRow.filter(line => line.along < 0), right = stationsInRow.filter(line => line.along > 0);
    const pairs = [];
    for (const origin of left) for (const destination of right) {
      if (origin.name === destination.name ||
          Math.abs(origin.below - destination.below) > Math.max(train.glyphHeight, origin.glyphHeight, destination.glyphHeight) * (origin.header ? 1.1 : .6)) continue;
      const quality = Number(origin.printed) + Number(destination.printed);
      if (!origin.known && !destination.known && !(quality === 2 && [origin, destination].every(line => /站$/.test(line.text)))) continue;
      pairs.push({ origin: origin.name, destination: destination.name, quality });
    }
    const quality = Math.max(...pairs.map(pair => pair.quality));
    const best = new Map(pairs.filter(pair => pair.quality === quality).map(pair => [pair.origin + '→' + pair.destination, pair]));
    if (best.size !== 1) continue;
    const { origin, destination } = best.values().next().value;
    routes.push({ origin, destination, service: train.train, namesOnPaper: quality === 2 });
  }
  return routes.length === 1 ? routes[0] : null;
}

export function railNumbersFromLayout(lines, service) {
  const trains = lines.filter(line => line.train === service && line.score >= .7);
  if (trains.length !== 1) return {};
  const train = trains[0];
  const find = footer => {
    const numbers = new Set();
    for (const line of lines) {
      if (line.score < .63) continue;
      const { along, below } = projection(line, train);
      if (!footer && line.header) {
        if (along < 0 && below <= train.glyphHeight * .6) numbers.add(line.header.ticketNumber);
        continue;
      }
      if (footer ? below < train.glyphHeight * 2.1 : below > -train.glyphHeight * .34) continue;
      const code = printedRailNumber(line.text, footer);
      if (code) numbers.add(code);
    }
    return numbers.size === 1 ? numbers.values().next().value : '';
  };
  const saleCode = find(true);
  const ticketNumber = find(false) || ticketNumberFromFooter(lines
    .filter(line => line.score >= .72 && projection(line, train).below < -train.glyphHeight * .34 && line.centerX < train.centerX)
    .map(line => line.text), saleCode);
  return { ...(ticketNumber && { ticketNumber }), ...(saleCode && { saleCode }) };
}

export function ticketNumberFromFooter(lines, saleCode) {
  const serial = saleCode?.match(/^[0-9]{14}([A-Z]\d{6})$/)?.[1];
  if (!serial) return '';
  const serials = new Set();
  for (const text of lines) {
    const top = text.normalize('NFKC').replace(/\s/g, '');
    const number = top.match(/^(\d{0,2})(?:\d)(\d{6})$/);
    if (number?.[2] === serial.slice(1)) serials.add(number[1] + serial);
  }
  return serials.size === 1 ? serials.values().next().value : '';
}

export function railTextAngle(items) {
  const angles = items.filter(item => item.score >= .7 && item.text.length >= 4)
    .map(({ poly: [left, right] }) => Math.atan2(right[1] - left[1], right[0] - left[0]))
    .filter(angle => Math.abs(angle) < .55).sort((a, b) => a - b);
  const median = angles[Math.floor(angles.length / 2)];
  return angles.filter(angle => Math.abs(angle - median) <= .09).length >= Math.max(3, angles.length * .6) ? median : 0;
}

function* joinedRailRows(lines, start) {
  const neighbors = lines.map(line => ({ line, ...projection(line, start) }))
    .filter(({ line, along, below }) => along > start.glyphWidth / 2 &&
      Math.abs(below) < Math.max(start.glyphHeight, line.glyphHeight) * .64)
    .sort((a, b) => a.along - b.along);
  let text = start.text, end = start.glyphWidth / 2;
  for (const { line, along } of neighbors.slice(0, 3)) {
    const gap = along - line.glyphWidth / 2 - end;
    if (gap > Math.max(start.glyphHeight, line.glyphHeight) * 2.25 || gap < -line.glyphHeight * .5) break;
    text += ' ' + line.text;
    end = along + line.glyphWidth / 2;
    yield text;
  }
}

export function railSplitFieldsFromLayout(lines, printed) {
  const fields = {};
  const confident = lines.filter(line => line.score >= .55);
  const departureDate = calendarDate(printed.departureDate);
  if (departureDate.length !== 10 || !printed.departureTime) {
    const dates = new Map();
    for (const line of confident) {
      if (!/^(?:19|20)[0-9OIl]{2}/.test(line.text)) continue;
      let date = readRailDateRow(line.text);
      for (const row of joinedRailRows(confident, line)) date = readRailDateRow(row) || date;
      if (date && (departureDate.length !== 10 || departureDate === date.departureDate)) {
        dates.set(date.departureDate, date.departureTime || dates.get(date.departureDate) || '');
      }
    }
    if (dates.size === 1) {
      const [[date, time]] = dates;
      fields.departureDate = date;
      if (!printed.departureTime && time) fields.departureTime = time;
    }
  }
  if ((!printed.seat && !printed.railStanding) || (printed.railStanding && !printed.carriage)) {
    const seats = new Map();
    for (const line of confident) {
      if (!/^[0-9OIl]{1,2}(?:\s*[车車#%*+]|\s*$)/i.test(line.text)) continue;
      for (const row of joinedRailRows(confident, line)) {
        const seat = railSeatFromLine(row);
        if (seat?.carriage && (printed.railStanding ? seat.railStanding : seat.seat || seat.railStanding)) {
          seats.set(JSON.stringify(seat), seat);
        }
      }
    }
    if (seats.size === 1) Object.assign(fields, seats.values().next().value);
  }
  if (!printed.seatClass.startsWith('新空调')) {
    const labels = new Set();
    for (const line of confident.filter(line => /^新(?:\s*空|\s*$)/.test(line.text))) {
      for (const row of joinedRailRows(confident, line)) {
        const label = row.replace(/\s/g, '');
        if (SEAT_CLASSES.rail.includes(label) && (!printed.seatClass || label === '新空调' + printed.seatClass)) labels.add(label);
      }
    }
    if (labels.size === 1) fields.seatClass = labels.values().next().value;
  }
  if (!printed.issuer) {
    const names = new Set();
    for (const line of confident) {
      if (!/^(?:[\p{Script=Han}\s]{1,14}[A-Z]{0,3}|[A-Z0-9\s]{17,25})$/u.test(line.text)) continue;
      for (const row of joinedRailRows(confident, line)) {
        const name = railIssuerFromLine(row);
        if (name) names.add(name);
      }
    }
    if (names.size === 1) fields.issuer = names.values().next().value;
  }
  const prices = new Set();
  for (const line of confident) {
    if (!/^(?:[¥￥Y羊]|票价|金额|退票(?:手续)?费)/.test(line.text)) continue;
    let price = '';
    for (const row of joinedRailRows(confident, line)) {
      price = railFareFromLine(row) || price;
    }
    if (price && (!printed.price || price.startsWith(printed.price + '.'))) prices.add(price);
  }
  if (prices.size === 1) fields.price = prices.values().next().value;
  return fields;
}

export function railValueRegions(layout, width, height, record) {
  const words = ocrWords(layout);
  const dates = words.filter(word => word.confidence >= 65 && word.left < width * .46 &&
    /^(?:19|20)\d{2}\s*[年*]\s*\d{1,2}\s*月/.test(word.text));
  if (dates.length > 1) return null;
  const train = record?.service && words.find(word => word.left > width * .25 && word.left < width * .66 &&
    trainCode(word.text, true) === record.service);
  const station = record?.origin && words.find(word => word.left < width * .43 &&
    railStationFromRegion(word.text, { fuzzy: false }) === record.origin);
  const date = dates[0];
  if (!train && !date) return null;
  const line = Math.min(date?.height || train.height * .82, height * .12);
  const margin = date?.left ?? station?.left ?? Math.max(0, train.left - line * 7);
  const region = (left, top, right, bottom) => {
    left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top));
    right = Math.min(width, Math.ceil(right)); bottom = Math.min(height, Math.ceil(bottom));
    return right - left >= 20 && bottom - top >= 12 ? { left, top, width: right - left, height: bottom - top } : null;
  };
  const number = region(margin - line, train ? train.top - line * 4.3 : date.top - line * 6.5,
    train ? Math.min(width * .53, train.left + line) : Math.min(width * .52, margin + date.width),
    train ? train.top + line * .4 : date.top - line * 1.7);
  return {
    paper: date && region(date.left + date.width * .12, date.top + line * .8,
      date.left + date.width * .9, date.top + line * 2.8),
    price: date && region(date.left - line, date.top + line * .78,
      Math.min(width * .57, date.left + Math.max(width * .28, line * 7)), date.top + line * 3.6),
    seat: date && region(Math.max(width * .43, Math.min(width * .60, date.left + date.width - line)),
      date.top - line, width, date.top + line * 2.6),
    service: train ? region(train.left - line * 1.1, train.top - line * .65,
      train.left + train.width + line * .7, train.top + train.height + line * .65) : date && region(
      Math.max(width * .31, margin + date.width * .56), date.top - line * 3.45,
      Math.min(width * .7, margin + date.width * 1.6), date.top - line * .35),
    date: region(margin - line, date ? date.top - line * .75 : Math.min(train.top, station?.top ?? train.top) + line * .7,
      Math.min(width * .62, date ? date.left + date.width + line : train.left + train.width), date ? date.top + line * 1.65 : train.top + line * 5.3),
    ticketNumber: number,
    ticketInk: number && { ...number, height: Math.min(height - number.top, number.height + Math.ceil(line)) }
  };
}
