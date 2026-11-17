import { createWorker } from 'tesseract.js';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const worker = await createWorker(['chi_sim', 'eng'], 1, { langPath: resolve(root, 'public/ocr'), cacheMethod: 'none', errorHandler: () => {} });
try {
  const { data } = await worker.recognize(resolve(root, '.preview/rail-receipt.png'));
  const text = data.text;
  if (!/G\s*103/.test(text) || !/2025/.test(text)) throw new Error('OCR sample did not recover the service and date.');
  console.log(JSON.stringify({ recognizedService: /G\s*103/.test(text), recognizedYear: /2025/.test(text), textLength: text.length, confidence: data.confidence }));
} finally { await worker.terminate(); }
