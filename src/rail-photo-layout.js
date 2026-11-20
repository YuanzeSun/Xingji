import { ocrWords } from './ocr-layout.js';
import { printedRailNumber, railFareFromLine, railIssuerFromLine, railSeatFromLine, railStationFromRegion } from './rail-ticket.js';

export const trainLine = /^([A-Z]\s*\d{1,5}|[1-9]\d{2,3})(?:\s*次)?$/;

function projection(line, anchor) {
  const x = line.centerX - anchor.centerX, y = line.centerY - anchor.centerY;
  return {
    along: x * anchor.cos + y * anchor.sin,
    below: y * anchor.cos - x * anchor.sin
  };
}

export function locateRailRoute(lines) {
  const stations = lines.filter(line => line.score >= .5).map(line => {
    const known = railStationFromRegion(line.text, { fuzzy: false });
    const han = line.text.replace(/\s/g, '').match(/^(\p{Script=Han}{1,7}?)站?$/u)?.[1];
    const printed = han && (known || han.length > 1 && line.score >= .88) ? han : '';
    return { ...line, name: printed || known, printed: !!printed, known: !!known };
  }).filter(line => line.name);
  const routes = [];
  for (const train of lines.filter(line => line.train && line.score >= .76)) {
    const nearby = stations.map(line => ({ ...line, ...projection(line, train) })).filter(line =>
      Math.abs(line.below) <= Math.max(line.glyphHeight, train.glyphHeight) * (line.printed ? .84 : 1.5)
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
          Math.abs(origin.below - destination.below) > Math.max(train.glyphHeight, origin.glyphHeight, destination.glyphHeight) * .6) continue;
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
      const { below } = projection(line, train);
      if (footer ? below < train.glyphHeight * 2.1 : below > -train.glyphHeight * .34) continue;
      const code = printedRailNumber(line.text, footer);
      if (code) numbers.add(code);
    }
    return numbers.size === 1 ? numbers.values().next().value : '';
  };
  const ticketNumber = find(false), saleCode = find(true);
  return { ...(ticketNumber && { ticketNumber }), ...(saleCode && { saleCode }) };
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

export function railValueRegions(layout, width, height) {
  const dates = ocrWords(layout).filter(word => word.confidence >= 65 && word.left < width * .46 &&
    /^(?:19|20)\d{2}\s*[年*]\s*\d{1,2}\s*月/.test(word.text));
  if (dates.length !== 1) return null;
  const date = dates[0], line = Math.min(date.height, height * .12);
  const region = (left, top, right, bottom) => {
    left = Math.max(0, Math.floor(left)); top = Math.max(0, Math.floor(top));
    right = Math.min(width, Math.ceil(right)); bottom = Math.min(height, Math.ceil(bottom));
    return right - left >= 20 && bottom - top >= 12 ? { left, top, width: right - left, height: bottom - top } : null;
  };
  return {
    paper: region(date.left + date.width * .12, date.top + line * .8,
      date.left + date.width * .9, date.top + line * 2.8),
    price: region(date.left - line, date.top + line * .78,
      Math.min(width * .57, date.left + Math.max(width * .28, line * 7)), date.top + line * 3.6),
    seat: region(Math.max(width * .43, Math.min(width * .60, date.left + date.width - line)),
      date.top - line, width, date.top + line * 2.6)
  };
}
