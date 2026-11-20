import { calendarDate } from './journey-date.js';
import { parseScanText } from './scan-engine.js';
import { railPhotoColor } from './scan-image.js';
import { isRailOrderText } from './rail-order.js';
import { parsePrintedRailTicket, railFareFromLine, railSeatFromLine } from './rail-ticket.js';
import { locateRailRoute, railNumbersFromLayout, railSplitFieldsFromLayout, railValueRegions, trainLine } from './rail-photo-layout.js';
import { marksFromRailRegion } from './ticket-marks.js';
import { printedRailTemplate } from './rail-template.js';

const detector = 'PP-OCRv6_tiny_det';
const recognizer = 'PP-OCRv6_small_rec';
const coreFields = ['service', 'origin', 'destination', 'departureDate'];
const printedDeparture = /^(?:19|20)\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}[^\d\n]{0,3}\d{1,2}\s*:\s*\d{2}/;
const inferenceOptions = {
  textDetLimitSideLen: 960, textDetLimitType: 'max', textDetBoxThresh: .45, textRecScoreThresh: .48
};
let modelPromise;

function loadModel(base) {
  modelPromise ??= (async () => {
    const sdkUrl = new URL('vendor/paddle/index.mjs', base).href;
    const { PaddleOCR } = await import(sdkUrl);
    const asset = name => ({
      url: new URL('ocr/paddle/' + name + '.tar', base).href
    });
    return PaddleOCR.create({
      worker: true,
      textDetectionModelName: detector,
      textDetectionModelAsset: asset(detector),
      textRecognitionModelName: recognizer,
      textRecognitionModelAsset: asset(recognizer),
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

export function paddleRailReading({ image, items }, paperColor) {
  const lines = items.map(({ poly, text, score }) => {
    const xs = poly.map(([x]) => x), ys = poly.map(([, y]) => y);
    const left = Math.min(...xs), top = Math.min(...ys);
    const width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    text = text.normalize('NFKC').trim();
    if (score >= .8) text = text.replace(/^((?:19|20)\d{2})\s*\*(?=\s*\d{1,2}月\d{1,2}[日目])/, '$1年');
    const train = text.match(trainLine)?.[1].replace(/\s/g, '');
    const [topLeft, topRight, , bottomLeft] = poly;
    const dx = topRight[0] - topLeft[0], dy = topRight[1] - topLeft[1];
    const glyphWidth = Math.hypot(dx, dy) || width || 1;
    const glyphHeight = Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]) || height;
    return { text, score, train, left, top, width, height, glyphWidth, glyphHeight,
      centerX: left + width / 2, centerY: top + height / 2, cos: dx / glyphWidth, sin: dy / glyphWidth };
  }).filter(line => line.text);
  const text = lines.map(line => line.text).join('\n');
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
  let printed = !order && parsePrintedRailTicket(text, 'OCR', { layout, paperColor });
  let route = !order && (printed || departures.length === 1) ? locateRailRoute(lines) : null;
  if (route && (route.namesOnPaper || !(printed?.origin && printed?.destination && printed?.service))) {
    printed = parsePrintedRailTicket(text, 'OCR', { layout, paperColor, route });
  } else route = null;

  const railFields = printed ? { ...railNumbersFromLayout(lines, printed.service), ...railSplitFieldsFromLayout(lines, printed) } : {};
  if (printed) {
    const isolated = lines.filter(line => line.score >= .6).map(line => line.text).join('\n');
    const marks = marksFromRailRegion(isolated);
    if (marks.length) railFields.ticketMarks = marks;
  }
  return { text, layout, paperColor, railFields, ...(route && { route }) };
}

async function readRegion(engine, bitmap, region) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(2, inferenceOptions.textDetLimitSideLen / Math.max(region.width, region.height));
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);
  canvas.getContext('2d').drawImage(bitmap, region.left, region.top, region.width, region.height, 0, 0, canvas.width, canvas.height);
  const cropped = await createImageBitmap(canvas);
  try {
    const [result] = await engine.predict(cropped, inferenceOptions);
    return result.items;
  } finally {
    cropped.close();
  }
}

function regionalValue(items, parse) {
  const values = new Map();
  for (const { text, score } of items) {
    const value = score >= .82 && parse(text, score);
    if (value) values.set(JSON.stringify(value), value);
  }
  return values.size === 1 ? values.values().next().value : null;
}

async function refineRailValues(engine, bitmap, regions, first, reading, progress) {
  const [record] = recognizedRailRecords(reading);
  if (!record || !regions || isRailOrderText(reading.text)) return reading;
  const seatMatches = (seat) => seat?.carriage && (seat.seat || seat.railStanding);
  const needSeat = regions.seat && !first.items.some(({text, score}) => {
    const seat = railSeatFromLine(text);
    return score >= .92 && seatMatches(seat) && seat.carriage === record.carriage &&
      (seat.railStanding ? record.railStanding : seat.seat === record.seat);
  });
  const needFare = regions.price && !first.items.some(({text, score}) => score >= .9 && record.price &&
    /[.·元圆圓]/.test(text.normalize('NFKC')) && railFareFromLine(text) === record.price);
  if (!needSeat && !needFare) return reading;
  progress('正在核对票价和席位…');
  const railFields = { ...reading.railFields };
  if (needSeat) {
    try {
      const seat = regionalValue(await readRegion(engine, bitmap, regions.seat), (text, score) => {
        // The faded 车 glyph is sometimes read as 4 in this position.
        const value = railSeatFromLine(text, { fadedCarriage: score >= .94 });
        return seatMatches(value) ? value : null;
      });
      if (seat && (!record.carriage || seat.carriage === record.carriage) &&
          (!record.seat || seat.seat === record.seat) && (!record.railStanding || seat.railStanding)) {
        Object.assign(railFields, seat);
      }
    } catch { /* Keep the full-ticket result if the crop is unclear. */ }
  }
  if (needFare) {
    try {
      const price = regionalValue(await readRegion(engine, bitmap, regions.price), text => railFareFromLine(text, { regional: true }));
      if (price && (!record.price || price.startsWith(record.price + '.'))) railFields.price = price;
    } catch { /* Preserve any amount already verified by the full read. */ }
  }
  return { ...reading, railFields };
}

export async function recognizePaddleRailPhoto(file, progress = () => {}) {
  const base = new URL('./', location.href);
  const loading = loadModel(base);
  let timer, firstReading;
  try {
    const infer = async () => {
      const engine = await loading;
      const bitmap = await createImageBitmap(file);
      try {
        const [result] = await engine.predict(bitmap, inferenceOptions);
        firstReading = paddleRailReading(result, railPhotoColor(bitmap));
        const regions = railValueRegions(firstReading.layout, bitmap.width, bitmap.height);
        if (regions?.paper && !isRailOrderText(firstReading.text) && !printedRailTemplate(firstReading.text)) {
          const paperColor = railPhotoColor(bitmap, regions.paper);
          if (paperColor) firstReading = { ...firstReading, paperColor, paperColorFromTicket: true };
        }
        return await refineRailValues(engine, bitmap, regions, result, firstReading, progress);
      } finally {
        bitmap.close();
      }
    };
    const limit = new Promise((resolve, reject) => {
      timer = setTimeout(() => firstReading ? resolve(firstReading) : reject(new Error('火车票识别超时')), 20000);
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
  const seatAgrees = ['carriage', 'seat'].every(key => !record[key] || !other[key] || record[key] === other[key]) &&
    !(record.railStanding && other.seat) && !(record.seat && other.railStanding);
  const extra = ['origin', 'destination', 'departureDate', 'departureTime', 'price', 'ticketNumber', 'saleCode', 'issuer', 'ticketMarks'];
  if (seatAgrees) extra.push('carriage', 'seat', 'railStanding');
  const additions = extra
    .filter(key => !hasValue(record[key]) && hasValue(other[key]))
    .map(key => [key, other[key]]);
  const secondaryReading = preferPrimary ? fallback : primary;
  const strongerTemplate = !printedRailTemplate(reading.text) &&
    (printedRailTemplate(secondaryReading.text) || (secondaryReading.paperColorFromTicket && !reading.paperColorFromTicket));
  if (other.fieldSources.template === 'ocr' &&
      (record.fieldSources.template !== 'ocr' || strongerTemplate)) {
    additions.push(['template', other.template]);
  }
  return additions.length ? { ...reading, railFields: { ...reading.railFields, ...Object.fromEntries(additions) } } : reading;
}
