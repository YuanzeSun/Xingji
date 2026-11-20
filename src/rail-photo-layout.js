import { printedRailNumber, railStationFromRegion } from './rail-ticket.js';

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