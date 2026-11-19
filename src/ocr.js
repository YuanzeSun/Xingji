import { createWorker } from 'tesseract.js';
import { dateRectangle, readPrintedDate } from './scan-date.js';
import { isRailOrderText, railOrderService } from './rail-order.js';
import { railTimeWords } from './ocr-layout.js';
import { isFlightScreenshotText } from './flight-screenshot.js';
import { refineRailService, refineRailTemplate, refineRailReceipt, railReadScore, preferEnhancedRailRead } from './rail-ocr.js';
import { prepareRailPhoto, prepareOCRImage, railPhotoColor, cropColoredRailPaper } from './scan-image.js';
import { isBoardingPassText, plannedBoardingTime } from './boarding-pass.js';

const readBoardingCodes = async image => (await import('./code-reader.js')).readBoardingCodesFromImage(image);

async function readBoardingTime(worker, image, data) {
  if (!data.text) return '';
  const time = data.confidence >= 40 ? plannedBoardingTime(data.text, data.tsv) : '';
  if (time) return time;
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '11' });
    const { data: sparse } = await worker.recognize(image, {}, { text: true, tsv: true });
    if (sparse.confidence >= 40) return plannedBoardingTime(sparse.text, sparse.tsv);
  } catch { /* The barcode is still usable when text recognition fails. */ }
  finally { await worker.setParameters({ tessedit_pageseg_mode: '3' }).catch(() => {}); }
  return '';
}

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

export async function createRecognizer(progress = () => {}, {
  workerFactory=createWorker,
  readCodes=readBoardingCodes
} = {}) {
  const base = new URL('./', location.href);
  let rejectStartup;
  const startupError = new Promise((_, reject) => { rejectStartup = reject; });
  const creating = workerFactory(['chi_sim', 'eng'], 1, {
    workerPath: new URL('vendor/worker.min.js', base).href,
    corePath: new URL('vendor/', base).href,
    langPath: new URL('ocr/', base).href,
    logger: m => progress(m.status === 'recognizing text' ? `正在识别 ${Math.round(m.progress * 100)}%` : '正在加载本地识别模型…'),
    // Tesseract can signal a language-load failure without rejecting createWorker.
    errorHandler: cause => rejectStartup?.(new Error('文字识别模型未能加载，请重试', { cause }))
  });
  const worker = await Promise.race([creating, startupError]).finally(() => { rejectStartup = undefined; });
  await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
  return {
    async recognize(image, { refineRailDate = false, type = '', decodedBoardingCodes } = {}) {
      const source = image;
      const codeRead=decodedBoardingCodes ? Promise.resolve(decodedBoardingCodes)
        : type==='rail' ? Promise.resolve([]) : Promise.resolve().then(()=>readCodes(source)).catch(()=>[]);
      let data;
      try {
        image = await prepareOCRImage(source);
        ({ data } = await worker.recognize(image, {}, { text: true, tsv: true }));
      }
      catch(error){if(!(await codeRead).length)throw error;data={text:'',tsv:'',confidence:0};}
      const boardingCodes = await codeRead;
      if (type === 'flight' || boardingCodes.length || isBoardingPassText(data.text) || isFlightScreenshotText(data.text)) {
        const scheduledBoardingTime = await readBoardingTime(worker, image, data);
        return { text: '', flightImage: true, scheduledBoardingTime, boardingCodes, confidence: boardingCodes.length ? 90 : data.confidence };
      }
      const photo = image;
      if (refineRailDate) await refineRailService(worker, image, data);
      if (refineRailDate && !isRailOrderText(data.text) && !/BOARDING|\bFLIGHT\b|航班|航空公司/i.test(data.text)) {
        ({ image, data } = await rereadRailPhoto(worker, photo, data));
      }
      const paperColor = railPhotoColor(image) || (image !== photo ? railPhotoColor(photo) : '');
      if (refineRailDate && !isRailOrderText(data.text)) {
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
      if (refineRailDate && !order) {
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
      return { text, layout, paperColor, railImage: true, confidence: data.confidence };
    },
    terminate: () => worker.terminate()
  };
}
export async function recognize(file, progress = () => {}, { details = false } = {}) {
  const decodedBoardingCodes = readBoardingCodes(file).catch(() => []);
  const worker = await createRecognizer(progress).catch(async error => {
    if (!(await decodedBoardingCodes).length) throw error;
    return null;
  });
  if (!worker) return details ? { text: '', flightImage: true, boardingCodes: await decodedBoardingCodes, confidence: 90 } : '';
  try { const result = await worker.recognize(file, { refineRailDate: true, decodedBoardingCodes }); return details ? result : result.text; }
  finally { await worker.terminate(); }
}
