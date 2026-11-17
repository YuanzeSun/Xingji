import {calendarDate,dateLabel} from './journey-date.js';
import { exportPNG } from './tickets.js';
import { albumPages, A4 } from './album-layout.js';
import { drawAlbumCover, drawRailNote } from './album-decoration.js';

export function ticketFileName(record) {
  return `${calendarDate(record.departureDate) || '未定日期'}_${record.service || '票据'}_${record.origin}-${record.destination}`
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 160).replace(/[. ]+$/, '');
}

const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
function check(signal) { signal?.throwIfAborted(); }

export async function exportTicketImages(records, options = {}) {
  if (records.length !== 1) return exportTicketZIP(records, options);
  check(options.signal);
  options.onProgress?.({ completed: 0, total: 1, phase: '正在生成票面' });
  const image = await (options.renderTicket || exportPNG)(records[0]);
  check(options.signal);
  options.onProgress?.({ completed: 1, total: 1, phase: '票面已生成' });
  return image;
}

export async function exportTicketZIP(records, { signal, onProgress = () => {}, renderTicket = exportPNG } = {}) {
  if (!records.length) throw new Error('请先选择票据');
  check(signal);
  const { Zip, ZipPassThrough } = await import('fflate');
  const chunks = [];
  let failure;
  const zip = new Zip((error, chunk) => { if (error) failure = error; else chunks.push(chunk); });
  try {
    for (let index = 0; index < records.length; index++) {
      check(signal);
      onProgress({ completed: index, total: records.length, phase: '正在生成票面' });
      await yieldFrame();
      const image = await renderTicket(records[index]);
      check(signal);
      // Numbering preserves the selected order and keeps duplicate journeys distinct.
      const name = `${String(index + 1).padStart(String(records.length).length, '0')}_${ticketFileName(records[index])}.png`;
      const file = new ZipPassThrough(name);
      zip.add(file);
      file.push(new Uint8Array(await image.arrayBuffer()), true);
      if (failure) throw failure;
      onProgress({ completed: index + 1, total: records.length, phase: '正在打包图片' });
    }
    check(signal); zip.end();
    if (failure) throw failure;
    return new Blob(chunks, { type: 'application/zip' });
  } finally { zip.terminate(); }
}

async function textPNG(lines, width, height) {
  await Promise.all([document.fonts.load('16px TicketSong'),document.fonts.load('500 16px TicketHei')]);
  const canvas = document.createElement('canvas'), scale = 12;
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
  for (const { text, y, size, color = '#315249', serif = false, align = 'left', wrap = false, lineHeight = size * 1.3, maxLines = 3 } of lines) {
    ctx.font = `${serif ? '' : '500 '}${size}px ${serif ? 'TicketSong, serif' : 'TicketHei, sans-serif'}`;
    ctx.fillStyle = color; ctx.textBaseline = 'top';
    ctx.textAlign = align;
    const rows = []; let row = '';
    for (const char of String(text)) {
      if (wrap && row && ctx.measureText(row + char).width > width) { rows.push(row); row = ''; }
      row += char;
    }
    rows.push(row);
    rows.slice(0,maxLines).forEach((value,index)=>ctx.fillText(value,align === 'center' ? width / 2 : 0,y + index * lineHeight,width));
  }
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('纪念册文字生成失败');
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportTicketAlbum(records, { title = '我的行迹', cover = true, signal, onProgress = () => {}, renderTicket = exportPNG, renderText = textPNG } = {}) {
  if (!records.length) throw new Error('请先选择票据');
  check(signal);
  const { PDFDocument, StandardFonts, degrees, rgb } = await import('pdf-lib');
  check(signal);
  const pdf = await PDFDocument.create(), mm = value => value * 72 / 25.4;
  title = String(title).trim().slice(0, 30) || '我的行迹';
  pdf.setTitle(title); pdf.setAuthor('YuanzeSun'); pdf.setCreator('行迹 Xingji'); pdf.setLanguage('zh-CN');
  pdf.catalog.getOrCreateViewerPreferences().setPrintScaling('None');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const heading = await pdf.embedPng(await renderText([{text:'旅途票笺',y:0,size:3.6,serif:true}],70,6));
  const credit = await pdf.embedPng(await renderText([{ text:'行迹 · by @YuanzeSun', y:0, size:2.1, color:'#98a394' }],100,4));
  check(signal);
  const decoration = {pdf,font,mm,rgb,renderText};
  const pages = albumPages(records);
  const totalPages = pages.length + Number(cover);
  const addPage = index => {
    const page = pdf.addPage([mm(A4.width), mm(A4.height)]);
    page.drawRectangle({ x: 0, y: 0, width: page.getWidth(), height: page.getHeight(), color: rgb(0.984, 0.976, 0.953) });
    page.drawLine({start:{x:mm(16),y:mm(19)},end:{x:mm(194),y:mm(19)},thickness:.4,color:rgb(.80,.81,.75)});
    page.drawImage(credit, { x:mm(16), y:mm(8), width:mm(100), height:mm(4) });
    page.drawText(`${String(index + 1).padStart(2, '0')} / ${String(totalPages).padStart(2, '0')}`, { x: mm(180), y: mm(10), size: 7, font, color: rgb(0.50, 0.57, 0.52) });
    return page;
  };
  const coverPage = cover ? addPage(0) : null;
  let completed = 0;
  for (const [pageIndex, items] of pages.entries()) {
    check(signal);
    const page = addPage(pageIndex + Number(cover));
    page.drawImage(heading,{x:mm(16),y:mm(278),width:mm(70),height:mm(6)});
    page.drawText('XINGJI / JOURNEY ARCHIVE',{x:mm(140),y:mm(280),font,size:6.8,color:rgb(.45,.52,.46)});
    page.drawLine({start:{x:mm(16),y:mm(274)},end:{x:mm(194),y:mm(274)},thickness:.6,color:rgb(.69,.52,.33)});
    for (const item of items) {
      check(signal);
      onProgress({ completed, total: records.length, phase: '正在排版纪念册' });
      await yieldFrame();
      const blob = await renderTicket(item.record);
      check(signal);
      const image = await pdf.embedPng(await blob.arrayBuffer());
      const w = mm(item.width), h = mm(item.height), radians = item.angle * Math.PI / 180;
      const x = mm(item.x + item.width / 2) - w * Math.cos(radians) / 2 + h * Math.sin(radians) / 2;
      const y = mm(297 - item.y - item.height / 2) - w * Math.sin(radians) / 2 - h * Math.cos(radians) / 2;
      for (const [offset, opacity] of [[0.8, 0.035], [0.4, 0.06]]) {
        page.drawRectangle({ x: x + mm(offset), y: y - mm(offset), width: w, height: h, rotate: degrees(item.angle), color: rgb(0.1, 0.2, 0.16), opacity });
      }
      page.drawImage(image, { x, y, width: w, height: h, rotate: degrees(item.angle) });
      // The tape overlaps only the outermost edge, leaving ticket text and codes clear.
      page.drawRectangle({ x: mm(item.x + item.width / 2 - 8), y: mm(297 - item.y - 0.8), width: mm(16), height: mm(4.5), rotate: degrees(-2), color: rgb(0.87, 0.83, 0.69), opacity: 0.30 });
      const caption = await pdf.embedPng(await renderText([{ text: String(item.index + 1).padStart(2,'0') + '  /  ' + (item.record.departureDate ? dateLabel(item.record.departureDate,'-') : '日期未收录'), y: 0, size: 2.5, color: '#69796f' }], item.width, 5));
      page.drawImage(caption, { x: mm(item.x), y: mm(297 - item.y - item.height - 7), width: mm(item.width), height: mm(5) });
      if (item.solo && item.record.type === 'rail') {
        await drawRailNote(page,item,decoration);
      }
      completed++;
      onProgress({ completed, total: records.length, phase: '正在排版纪念册' });
      await pdf.flush();
    }
  }
  if (coverPage) {
    check(signal);
    await drawAlbumCover(coverPage,title,records,decoration);
  }
  check(signal);
  onProgress({ completed, total: records.length, phase: '正在整理 PDF' });
  await yieldFrame();
  const bytes = await pdf.save();
  check(signal);
  return new Blob([bytes], { type: 'application/pdf' });
}
