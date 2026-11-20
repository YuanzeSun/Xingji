import { calendarDate } from './journey-date.js';
import { parseScanText } from './scan-engine.js';
import { railPhotoColor } from './scan-image.js';
import { isRailOrderText } from './rail-order.js';
import { parsePrintedRailTicket, railStationFromRegion } from './rail-ticket.js';
import { marksFromRailRegion } from './ticket-marks.js';

const model = 'PP-OCRv6_tiny';
const coreFields = ['service', 'origin', 'destination', 'departureDate'];
const trainLine = /^([A-Z]\s*\d{1,5}|[1-9]\d{2,3})(?:\s*次)?$/;
const printedDeparture = /^(?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}[^\d\n]{0,3}\d{1,2}\s*:\s*\d{2}/;
let modelPromise;

function loadModel(base) {
  modelPromise ??= (async () => {
    const sdkUrl = new URL('vendor/paddle/index.mjs', base).href;
    const { PaddleOCR } = await import(sdkUrl);
    const asset = kind => ({
      url: new URL('ocr/paddle/' + model + '_' + kind + '.tar', base).href
    });
    return PaddleOCR.create({
      worker: true,
      textDetectionModelName: model + '_det',
      textDetectionModelAsset: asset('det'),
      textRecognitionModelName: model + '_rec',
      textRecognitionModelAsset: asset('rec'),
      ortOptions: {
        backend: 'wasm',
        numThreads: 1,
        wasmPaths: new URL('vendor/paddle/', base).href
      }
    });
  })().catch(error => {
    modelPromise = undefined;
    throw error;
  });
  return modelPromise;
}

function routeFromTicketRow(lines) {
  const stations = lines.map(line => {
    const known = railStationFromRegion(line.text);
    const printed = line.score >= .88 && line.text.replace(/\s/g, '').match(/^([\p{Script=Han}]{2,7})站$/u)?.[1];
    return { ...line, station: known || printed, known: !!known };
  }).filter(line => line.station);
  const routes = [];
  for (const train of lines.filter(line => line.train && line.score >= .76)) {
    const neighbors = stations.filter(line => Math.abs(line.centerY - train.centerY) < Math.max(line.height, train.height));
    const sides = [
      neighbors.filter(line => line.left + line.width <= train.left),
      neighbors.filter(line => line.left >= train.left + train.width)
    ].map(side => [...new Map(side.map(line => [line.station, line])).values()]);
    if (sides[0].length !== 1 || sides[1].length !== 1) continue;
    const [origin, destination] = sides.map(([line]) => line);
    if (origin.station === destination.station || !(origin.known || destination.known)) continue;
    routes.push({ origin: origin.station, destination: destination.station, service: train.train });
  }
  return routes.length === 1 ? routes[0] : null;
}

export function paddleRailReading({ image, items }, paperColor) {
  const lines = items.map(({ poly, text, score }) => {
    const xs = poly.map(([x]) => x), ys = poly.map(([, y]) => y);
    const left = Math.min(...xs), top = Math.min(...ys);
    const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    text = text.normalize('NFKC').trim();
    if (score >= .8) text = text.replace(/^((?:19|20)\d{2})\s*\*(?=\s*\d{1,2}月\d{1,2}[日目])/, '$1年');
    const train = text.match(trainLine)?.[1].replace(/\s/g, '');
    return { text, score, train, left, top, width, height, centerY: top + height / 2 };
  }).filter(line => line.text);
  let text = lines.map(line => line.text).join('\n');
  const order = isRailOrderText(text);
  const departures = lines.filter(line => printedDeparture.test(line.text));
  if (!order && departures.length > 1 && new Set(lines.map(line => line.train).filter(Boolean)).size > 1) {
    return { text: '', multiplePrintedTickets: true };
  }
  // Reuse the ticket parser's word coordinates so left and right stations retain their roles.
  const page = [1, 1, 0, 0, 0, 0, 0, 0, image.width, image.height, -1, ''];
  const boxes = lines.map(({ left, top, width, height, text, score }, index) =>
    [5, 1, 1, 1, index + 1, 1, left, top, width, height, score * 100, text]);
  const layout = [page, ...boxes].map(row => row.join('\t')).join('\n');
  const railFields = {};
  let printed = !order && parsePrintedRailTicket(text, 'OCR', { layout, paperColor });
  if (!order && departures.length === 1 && !(printed?.origin && printed?.destination && printed?.service)) {
    const route = routeFromTicketRow(lines);
    if (route && (!printed?.service || printed.service === route.service)) {
      text = '车次：' + route.service + '\n' + text;
      printed = parsePrintedRailTicket(text, 'OCR', { layout, paperColor });
      if (printed) Object.assign(railFields, {
        origin: printed.origin || route.origin,
        destination: printed.destination || route.destination
      });
    }
  }
  if (printed) {
    const isolated = lines.filter(line => line.score >= .6).map(line => line.text).join('\n');
    const marks = marksFromRailRegion(isolated);
    if (marks.length) railFields.ticketMarks = marks;
  }
  return { text, layout, paperColor, railFields };
}

export async function recognizePaddleRailPhoto(file) {
  const base = new URL('./', location.href);
  const loading = loadModel(base);
  let timer;
  try {
    const infer = async () => {
      const engine = await loading;
      const bitmap = await createImageBitmap(file);
      try {
        const paperColor = railPhotoColor(bitmap);
        const [result] = await engine.predict(bitmap, {
          textDetLimitSideLen: 960, textDetLimitType: 'max', textDetBoxThresh: .45, textRecScoreThresh: .48
        });
        return paddleRailReading(result, paperColor);
      } finally {
        bitmap.close();
      }
    };
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('火车票识别超时')), 20000);
    });
    return await Promise.race([infer(), limit]);
  } finally {
    clearTimeout(timer);
  }
}

const dateOrText = (record, key) => key === 'departureDate' ? calendarDate(record[key]) : record[key];
const score = record => coreFields.filter(key => dateOrText(record, key)).length;

export function recognizedRailRecords(reading) {
  return reading?.text ? parseScanText(reading.text, 'OCR', reading) : [];
}

export function fullRailRead(records) {
  return records.length > 0 && records.every(record => score(record) === coreFields.length);
}

export function chooseRailReading(primary, fallback) {
  const first = recognizedRailRecords(primary);
  const second = recognizedRailRecords(fallback);
  if (!first.length) return fallback;
  if (!second.length) return primary;
  if (second.length > 1) return fallback;
  if (first.length > 1) return primary;

  const [a] = first, [b] = second;
  const preferPrimary = score(a) >= score(b);
  const reading = preferPrimary ? primary : fallback;
  const [record, other] = preferPrimary ? [a, b] : [b, a];
  const agrees = record.service && record.service === other.service &&
    ['origin', 'destination'].some(key => record[key] && record[key] === other[key]) &&
    coreFields.every(key => {
      const left = dateOrText(record, key), right = dateOrText(other, key);
      return !left || !right || left === right;
    });
  if (!agrees) return reading;

  const hasValue = value => Array.isArray(value) ? value.length > 0 : !!value;
  const extra = ['origin', 'destination', 'departureDate', 'departureTime', 'ticketNumber', 'saleCode', 'ticketMarks']
    .filter(key => !hasValue(record[key]) && hasValue(other[key]))
    .map(key => [key, other[key]]);
  return extra.length ? { ...reading, railFields: { ...reading.railFields, ...Object.fromEntries(extra) } } : reading;
}