import { createWorker } from 'tesseract.js';
import { chooseRailReading, fullRailRead, recognizedRailRecords, recognizePaddleRailPhoto } from './paddle-rail.js';
import { dateRectangle, readPrintedDate } from './scan-date.js';
import { isRailOrderText, railOrderService } from './rail-order.js';
import { railTimeWords } from './ocr-layout.js';
import { isFlightScreenshotText } from './flight-screenshot.js';
import { refineRailService, refineRailTemplate, refineRailReceipt, refineRailFields, railReadScore, preferEnhancedRailRead } from './rail-ocr.js';
import { railValueRegions } from './rail-photo-layout.js';
import { prepareRailPhoto, prepareOCRImage, railPhotoColor, cropColoredRailPaper } from './scan-image.js';

async function rereadRailPhoto(worker, photo, first) {
  let best = { image: photo, data: first };
  const cropped = railReadScore(first) < 11 ? cropColoredRailPaper(photo) : null;
  for (const mode of ['6', '11']) {
    if (railReadScore(best.data) >= 11) break;
    try {
      const image = mode === '6' ? cropped || photo : await prepareRailPhoto(cropped || best.image);
      if (!image) continue;
      await worker.setParameters({ tessedit_pageseg_mode: mode });
      const { data } = await worker.recognize(image, {}, { text: true, tsv: true });
      await refineRailService(worker, image, data);
      if (preferEnhancedRailRead(best.data, data)) best = { image, data };
    } catch { /* Retain the best read already collected. */ }
    finally { await worker.setParameters({ tessedit_pageseg_mode: '3' }); }
  }
  return best;
}

async function createRecognizer(progress) {
  progress('正在加载备用识别模型…');
  const base = new URL('./', location.href);
  let rejectStartup;
  const startupError = new Promise((_, reject) => { rejectStartup = reject; });
  const creating = createWorker(['chi_sim', 'eng'], 1, {
    workerPath: new URL('vendor/worker.min.js', base).href,
    corePath: new URL('vendor/', base).href,
    langPath: new URL('ocr/', base).href,
    // Tesseract can signal a language-load failure without rejecting createWorker.
    errorHandler: cause => rejectStartup?.(new Error('文字识别模型未能加载，请重试', { cause }))
  });
  const worker = await Promise.race([creating, startupError]).finally(() => { rejectStartup = undefined; });
  await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
  progress('正在补读火车票票面…');
  return {
    async recognize(image) {
      image = await prepareOCRImage(image);
      let { data } = await worker.recognize(image, {}, { text: true, tsv: true });
      if (/BOARDING\s*(?:PASS|CARD)|登\s*[机機]\s*牌|航班(?:号)?[：:\s]*[A-Z]{2}\s*\d|\bFLIGHT\b/i.test(data.text) || isFlightScreenshotText(data.text)) {
        return { text: '', flightImage: true };
      }
      const photo = image;
      await refineRailService(worker, image, data);
      if (!isRailOrderText(data.text)) {
        ({ image, data } = await rereadRailPhoto(worker, photo, data));
      }
      const regions = railValueRegions(data.tsv, image.width, image.height);
      // The enhanced image may be monochrome. Keep the source photo's colour in that case.
      const fromTicket = regions?.paper && railPhotoColor(image, regions.paper);
      const paperColor = fromTicket || railPhotoColor(image) || (image !== photo ? railPhotoColor(photo) : '');
      if (!isRailOrderText(data.text)) {
        await refineRailTemplate(worker, image, data, paperColor);
        await refineRailReceipt(worker, image, data);
      }
      let text = data.text, layout = data.tsv || '';
      const order = isRailOrderText(text);
      if (order && layout) {
        const rows = layout.split('\n').map(line => line.split('\t'));
        const page = rows.find(row => row[0] === '1'), width = +page?.[8] || Infinity, height = +page?.[9] || Infinity;
        try {
          await worker.setParameters({ tessedit_char_whitelist: '0123456789:', tessedit_pageseg_mode: '7' });
          for (const word of railTimeWords(layout, railOrderService(text))) {
            const pad = Math.max(4, Math.round(word.height * .2)), left = Math.max(0, word.left - pad), top = Math.max(0, word.top - pad);
            try {
              const refined = await worker.recognize(image, { rectangle: { left, top, width: Math.min(width - left, word.width + pad * 2), height: Math.min(height - top, word.height + pad * 2) } });
              const value = refined.data.text.trim();
              if (!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(value) || refined.data.confidence < Math.max(60, Math.min(word.confidence, 80))) continue;
              const row = rows.find(row => row[0] === '5' && +row[6] === word.left && +row[7] === word.top && row[11] === word.text);
              if (row) row[11] = value;
              if (text.split(word.text).length === 2) text = text.replace(word.text, value);
            } catch { /* Keep the first read; uncertain values remain reviewable. */ }
          }
          layout = rows.map(row => row.join('\t')).join('\n');
        } finally { await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' }); }
      }
      if (!order) {
        const rectangle = dateRectangle(data.tsv, image.width || Infinity, image.height || Infinity);
        if (rectangle) {
          try {
            await worker.setParameters({ tessedit_char_whitelist: '0123456789年月日', tessedit_pageseg_mode: '7' });
            const refined = await worker.recognize(image, { rectangle });
            const date = readPrintedDate(refined.data.text);
            if (date && refined.data.confidence >= 45) text = `日期：${date}\n` + text;
          } catch { /* Keep the full-ticket read if the date crop fails. */ }
          finally { await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' }); }
        }
      }
      const railFields = order ? {} : await refineRailFields(worker, image, { text, tsv: layout }, paperColor);
      return { text, layout, paperColor, paperColorFromTicket: !!fromTicket, railFields };
    },
    terminate: () => worker.terminate()
  };
}
export async function recognize(file, progress = () => {}) {
  progress('正在识别火车票…');
  let reading;
  try { reading = await recognizePaddleRailPhoto(file, progress); }
  catch { /* Older browsers can use the original OCR engine. */ }
  if (reading?.multiplePrintedTickets) return reading;
  const records = recognizedRailRecords(reading);
  if (!fullRailRead(records)) {
    let worker;
    try {
      worker = await createRecognizer(progress);
      const fallback = await worker.recognize(file);
      if (reading?.paperColorFromTicket && !fallback.paperColorFromTicket && !records.length) {
        fallback.paperColor = reading.paperColor;
      }
      reading = chooseRailReading(reading, fallback);
    } catch (error) {
      if (!records.length) throw error;
    } finally { await worker?.terminate(); }
  }
  return reading;
}
