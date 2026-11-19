import { createWorker } from 'tesseract.js';
import { dateRectangle, readPrintedDate } from './scan-date.js';
import { isRailOrderText, railOrderService } from './rail-order.js';
import { railTimeWords, ocrWords } from './ocr-layout.js';
import { isFlightScreenshotText } from './flight-screenshot.js';
import { prepareFlightScreenshot } from './flight-screenshot-image.js';
import { refineRailService, refineRailReceipt, railReadScore, preferEnhancedRailRead } from './rail-ocr.js';
import { prepareRailPhoto, prepareOCRImage } from './scan-image.js';
import { isBoardingPassText } from './boarding-pass.js';
async function refineFlightSchedule(worker, image, data) {
  const word=ocrWords(data.tsv).find(word=>/^(?:19|20)\d{2}[-./年]/.test(word.text));
  if(!word || word.left>=image.width*.4)return;
  const dateLine=data.text.split('\n').find(line=>line.includes(word.text))||'';
  if(/(?:19|20)\d{2}[-./年]\d{1,2}[-./月]\d{1,2}/.test(dateLine)&&(dateLine.match(/(?:[01]?\d|2[0-3]):[0-5]\d/g)||[]).length===2)return;
  const pad=Math.max(5,Math.round(word.height*.25)),left=Math.max(0,word.left-pad),top=Math.max(0,word.top-pad),right=Math.min(image.width,Math.max(word.left+word.width,image.width*.56));
  try {
    await worker.setParameters({tessedit_char_whitelist:'0123456789年月日-/:.+ ',tessedit_pageseg_mode:'7'});
    const refined=await worker.recognize(image,{rectangle:{left,top,width:right-left,height:Math.min(image.height-top,word.height+pad*2)}});
    const schedule=refined.data.text.trim();
    if(!/(?:19|20)\d{2}[-./年]\d{1,2}[-./月]\d{1,2}/.test(schedule) || (schedule.match(/\d{1,2}:\d{2}/g)||[]).length!==2 || refined.data.confidence<45)return;
    let replaced=false;
    data.tsv=data.tsv.split('\n').flatMap(line=>{
      const row=line.split('\t');
      if(row[0]!=='5'||+row[6]>=right||Math.abs(+row[7]+ +row[9]/2-word.top-word.height/2)>word.height*.8)return [line];
      if(replaced)return [];
      replaced=true;row[6]=left;row[7]=top;row[8]=right-left;row[9]=word.height;row[11]='计划 '+schedule;
      return [row.join('\t')];
    }).join('\n');
    data.text=data.text.split('\n').map(line=>line.includes(word.text)?'计划 '+schedule:line).join('\n');
  } catch { /* Keep the whole-image read when the date row cannot be refined. */ }
  finally { await worker.setParameters({tessedit_char_whitelist:'',tessedit_pageseg_mode:'3'}); }
}
export async function createRecognizer(progress = () => {}, {
  workerFactory=createWorker,
  readCodes=async image=>(await import('./code-reader.js')).readBoardingCodesFromImage(image)
} = {}) {
  const base = new URL('./', location.href);
  const worker = await workerFactory(['chi_sim', 'eng'], 1, {
    workerPath: new URL('vendor/worker.min.js', base).href,
    corePath: new URL('vendor/', base).href,
    langPath: new URL('ocr/', base).href,
    logger: m => progress(m.status === 'recognizing text' ? `正在识别 ${Math.round(m.progress * 100)}%` : '正在加载本地识别模型…'),
    errorHandler: () => {}
  });
  await worker.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '1', tessedit_pageseg_mode: '3' });
  return {
    async recognize(image, { refineRailDate = false, type = '', decodedBoardingCodes } = {}) {
      const source = image;
      image=await prepareOCRImage(source);
      const codeRead=decodedBoardingCodes ? Promise.resolve(decodedBoardingCodes)
        : type==='rail' ? Promise.resolve([]) : Promise.resolve().then(()=>readCodes(source)).catch(()=>[]);
      let data;
      try { ({data}=await worker.recognize(image, {}, { text: true, tsv: true })); }
      catch(error){if(!(await codeRead).length)throw error;data={text:'',tsv:'',confidence:0};}
      if (refineRailDate) await refineRailService(worker, image, data);
      if (refineRailDate && !isRailOrderText(data.text) && !isFlightScreenshotText(data.text) && !/BOARDING|\bFLIGHT\b|航班|航空公司/i.test(data.text) && railReadScore(data) < 12) {
        try {
          const prepared = await prepareRailPhoto(image);
          if (prepared) {
            const alternative = await worker.recognize(prepared, {}, { text: true, tsv: true });
            await refineRailService(worker, prepared, alternative.data);
            if (preferEnhancedRailRead(data, alternative.data)) { image = prepared; data = alternative.data; }
          }
        } catch { /* The original image remains available for review. */ }
      }
      if (refineRailDate) await refineRailReceipt(worker, image, data);
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
      if (refineRailDate && !order && /限乘|当日当次|车次|二等座|一等座|硬[卧座]|软[卧座]/.test(text)) {
        const rectangle = dateRectangle(data.tsv, image.width || Infinity, image.height || Infinity);
        if (rectangle) {
          try {
            await worker.setParameters({ tessedit_char_whitelist: '0123456789年月日', tessedit_pageseg_mode: '7' });
            const refined = await worker.recognize(image, { rectangle });
            const date = readPrintedDate(refined.data.text);
            if (date && refined.data.confidence >= 45) text = `日期：${date}\n` + text;
          } finally { await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' }); }
        }
      }
      let supplementalText='';
      if(isFlightScreenshotText(text)){
        try{
          const prepared=await prepareFlightScreenshot(image);
          if(prepared){
            const recovered=await worker.recognize(prepared,{}, {text:true,tsv:true});
            await refineFlightSchedule(worker,prepared,recovered.data);
            if(/(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s*\d{2,5}/i.test(recovered.data.text)){
              supplementalText=text;
              try{const alternative=await prepareFlightScreenshot(image,{preserveEdges:false});if(alternative)supplementalText+='\n'+(await worker.recognize(alternative)).data.text;}catch{ /* The primary read is still usable. */ }
              text=isFlightScreenshotText(recovered.data.text)?recovered.data.text:'行程详情\n'+recovered.data.text;layout=recovered.data.tsv||'';
            }
          }
        }catch{ /* Keep the original read if contrast recovery is unavailable. */ }
      }
      const boardingReadings=[],boardingCodes=await codeRead;
      const rail=/限乘|当日当次|二等座|一等座|硬[卧座]|软[卧座]|报销凭证/.test(text);
      if(boardingCodes.length || type==='flight' || !rail&&!isRailOrderText(text)&&!isFlightScreenshotText(text)&&(isBoardingPassText(text)||text.trim().length<80||data.confidence<60)){
        try{
          await worker.setParameters({tessedit_pageseg_mode:'11'});
          const extra=await worker.recognize(image,{}, {text:true,tsv:true});
          boardingReadings.push({text:extra.data.text,layout:extra.data.tsv||'',confidence:extra.data.confidence});
        }catch{ /* A failed secondary read does not discard the original. */ }
        finally{await worker.setParameters({tessedit_pageseg_mode:'3'});}
      }
      const confidence=Math.max(data.confidence,...boardingReadings.map(read=>read.confidence),boardingCodes.length?90:0);
      return { text, layout, supplementalText, boardingReadings, boardingCodes, confidence };
    },
    terminate: () => worker.terminate()
  };
}
export async function recognize(file, progress = () => {}, { details = false } = {}) {
  const worker = await createRecognizer(progress);
  try { const result = await worker.recognize(file, { refineRailDate: true }); return details ? result : result.text; }
  finally { await worker.terminate(); }
}
