import { calendarDate } from './journey-date.js';
import { parseScanText } from './scan-engine.js';
import { prepareRailDetailImage, railPhotoColor, separateRailRedInk } from './scan-image.js';
import { isRailOrderText } from './rail-order.js';
import { parsePrintedRailTicket, printedRailNumber, railFareFromLine, railSeatFromLine, splitRailTicketHeader, trainCode } from './rail-ticket.js';
import { locateRailRoute, railNumbersFromLayout, railSplitFieldsFromLayout, railTextAngle, railValueRegions, ticketNumberFromFooter } from './rail-photo-layout.js';
import { readRailDateRow } from './scan-date.js';
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
    const train = trainCode(text, true);
    const [topLeft, topRight, , bottomLeft] = poly;
    const dx = topRight[0] - topLeft[0], dy = topRight[1] - topLeft[1];
    const glyphWidth = Math.hypot(dx, dy) || width || 1;
    const glyphHeight = Math.hypot(bottomLeft[0] - topLeft[0], bottomLeft[1] - topLeft[1]) || height;
    return { text, score, train, header: splitRailTicketHeader(text), left, top, width, height, glyphWidth, glyphHeight,
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

async function readRegion(engine, bitmap, region, ink = '') {
  const canvas = document.createElement('canvas');
  const scale = Math.min(2, inferenceOptions.textDetLimitSideLen / Math.max(region.width, region.height));
  canvas.width = Math.round(region.width * scale);
  canvas.height = Math.round(region.height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: !!ink });
  context.drawImage(bitmap, region.left, region.top, region.width, region.height, 0, 0, canvas.width, canvas.height);
  if (ink) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    if (ink === 'red-only') {
      if (!separateRailRedInk(pixels)) return [];
    } else {
      for (let i = 0; i < pixels.data.length; i += 4) {
        const [r, g, b] = [pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]];
        const gray = g - Math.max(0, r - (g + b) / 2) * .9;
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
      }
    }
    context.putImageData(pixels, 0, 0);
  }
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

async function refineRailValues(engine, bitmap, regions, first, reading, progress, colorNumber) {
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
  const needService = regions.service && (!record.service || (/^\d+$/.test(record.service) &&
    !first.items.some(({text, score}) => score >= .9 && trainCode(text, true) === record.service)));
  const needDate = regions.date && (!completeRailDate(record) || !record.departureTime);
  const needNumber = regions.ticketNumber && !record.ticketNumber;
  if (!needSeat && !needFare && !needService && !needDate && !needNumber) return reading;
  progress('正在核对票面字段…');
  const railFields = { ...reading.railFields };
  if (needService) {
    const service = await readRegion(engine, bitmap, regions.service)
      .then(items => regionalValue(items, text => trainCode(text, true))).catch(() => '');
    if (service && (!record.service || (service.length > record.service.length && service.slice(1) === record.service))) {
      railFields.service = service;
    }
  }
  if (needDate) {
    try {
      const date = regionalValue(await readRegion(engine, bitmap, regions.date),
        (text, score) => readRailDateRow(text, score >= .95 ? record.departureTime : ''));
      if (date && (!completeRailDate(record) || completeRailDate(record) === date.departureDate)) {
        railFields.departureDate = date.departureDate;
        if (!record.departureTime && date.departureTime) railFields.departureTime = date.departureTime;
      }
    } catch { /* The printed date may be cut off or covered. */ }
  }
  if (needNumber) {
    try {
      const readSerial = items => regionalValue(items, text => printedRailNumber(text)) ||
        ticketNumberFromFooter(items.filter(item => item.score >= .82).map(item => item.text), record.saleCode);
      const serial = readSerial(await readRegion(engine, bitmap, regions.ticketNumber)) ||
        readSerial(await readRegion(engine, colorNumber?.bitmap || bitmap, colorNumber?.region || regions.ticketInk, 'red-only')) ||
        readSerial(await readRegion(engine, bitmap, regions.ticketNumber, 'contrast'));
      if (serial) railFields.ticketNumber = serial;
    } catch { /* Keep the original fields if the serial cannot be read. */ }
  }
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
      let enhanced;
      try {
        let source = bitmap;
        let [result] = await engine.predict(bitmap, inferenceOptions);
        firstReading = paddleRailReading(result, railPhotoColor(bitmap));
        let [record] = recognizedRailRecords(firstReading);
        let regions = railValueRegions(firstReading.layout, bitmap.width, bitmap.height, record);
        const colorNumber = regions?.ticketInk && { bitmap, region: regions.ticketInk };
        if (regions?.paper && !isRailOrderText(firstReading.text) && !printedRailTemplate(firstReading.text)) {
          const paperColor = railPhotoColor(bitmap, regions.paper);
          if (paperColor) firstReading = { ...firstReading, paperColor, paperColorFromTicket: true };
        }
        if (!firstReading.multiplePrintedTickets && !isRailOrderText(firstReading.text) && result.items.length >= 4 &&
            (!record || !fullRailRead([record]) || !record.ticketNumber || !record.departureTime)) {
          progress('正在增强票面细节…');
          try {
            const { canvas, paperColor } = prepareRailDetailImage(bitmap, railTextAngle(result.items));
            enhanced = await createImageBitmap(canvas);
            const [second] = await engine.predict(enhanced, { ...inferenceOptions, textDetLimitSideLen: 1440 });
            const other = paddleRailReading(second, firstReading.paperColorFromTicket ? firstReading.paperColor : paperColor || firstReading.paperColor);
            if (!other.multiplePrintedTickets) {
              firstReading = chooseRailReading(firstReading, other);
              if (firstReading.layout === other.layout) {
                result = second;
                source = enhanced;
                [record] = recognizedRailRecords(firstReading);
                regions = railValueRegions(firstReading.layout, enhanced.width, enhanced.height, record);
              }
            }
          } catch { /* The original photograph is still available. */ }
        }
        return await refineRailValues(engine, source, regions, result, firstReading, progress, colorNumber);
      } finally {
        bitmap.close();
        enhanced?.close();
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

const completeRailDate = record => {
  const date = calendarDate(record.departureDate);
  return date.length === 10 ? date : '';
};
const dateOrText = (record, key) => key === 'departureDate' ? completeRailDate(record) : record[key];
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
  const sameSerial = ['ticketNumber', 'saleCode'].some(key => record[key] && record[key] === other[key]);
  const sameRouteAndDay = record.origin && record.origin === other.origin && record.destination &&
    record.destination === other.destination && completeRailDate(record) && completeRailDate(record) === completeRailDate(other);
  const sameServiceAndStation = record.service && record.service === other.service &&
    ['origin', 'destination'].some(key => record[key] && record[key] === other[key]);
  const agrees = sameSerial || ((sameRouteAndDay || sameServiceAndStation) &&
    coreFields.every(key => {
      const left = dateOrText(record, key), right = dateOrText(other, key);
      return !left || !right || left === right;
    }));
  if (!agrees) return reading;

  const hasValue = value => Array.isArray(value) ? value.length > 0 : !!value;
  const seatAgrees = ['carriage', 'seat'].every(key => !record[key] || !other[key] || record[key] === other[key]) &&
    !(record.railStanding && other.seat) && !(record.seat && other.railStanding);
  const extra = ['service', 'origin', 'destination', 'departureDate', 'departureTime', 'price', 'seatClass', 'ticketNumber', 'saleCode', 'issuer', 'ticketMarks'];
  if (seatAgrees) extra.push('carriage', 'seat', 'railStanding');
  const additions = extra
    .filter(key => key === 'departureDate'
      ? !completeRailDate(record) && !!completeRailDate(other)
      : !hasValue(record[key]) && hasValue(other[key]))
    .map(key => [key, other[key]]);
  if (record.seatClass && other.seatClass === '新空调' + record.seatClass) additions.push(['seatClass', other.seatClass]);
  const secondaryReading = preferPrimary ? fallback : primary;
  const strongerTemplate = !printedRailTemplate(reading.text) &&
    (printedRailTemplate(secondaryReading.text) || (secondaryReading.paperColorFromTicket && !reading.paperColorFromTicket));
  if (other.fieldSources.template === 'ocr' &&
      (record.fieldSources.template !== 'ocr' || strongerTemplate)) {
    additions.push(['template', other.template]);
  }
  return additions.length ? { ...reading, railFields: { ...reading.railFields, ...Object.fromEntries(additions) } } : reading;
}
