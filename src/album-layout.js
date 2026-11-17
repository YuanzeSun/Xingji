import { ticketDimensions } from './tickets.js';

// Millimetres, including space for the small date captions and pasted-paper edges.
export const A4 = { width: 210, height: 297 };
const margin = 16, top = 40, bottom = 277, gap = 10, caption = 10;
const contentWidth = A4.width - margin * 2;

export function albumPages(records) {
  const pages = [];
  let page = [], row = [], y = top;
  const flush = () => {
    if (!row.length) return;
    const height = Math.max(...row.map(item => item.height));
    if (y + height + caption > bottom && page.length) {
      pages.push(page); page = []; y = top;
    }
    const width = row.reduce((sum, item) => sum + item.width, 0) + gap * (row.length - 1);
    let x = row.length === 1 && row[0].record.type === 'rail' ? margin : (A4.width - width) / 2;
    for (const item of row) {
      page.push({ ...item, x, y, solo: row.length === 1, angle: item.index % 2 ? 0.35 : -0.35 });
      x += item.width + gap;
    }
    y += height + caption + gap;
    row = [];
  };
  records.forEach((record, index) => {
    const dimensions = ticketDimensions(record);
    const width = record.type === 'flight' ? contentWidth : (contentWidth - gap) / 2;
    const item = { record, index, width, height: width * dimensions.height / dimensions.width };
    if (record.type === 'flight') { flush(); row.push(item); flush(); }
    else { row.push(item); if (row.length === 2) flush(); }
  });
  flush();
  if (page.length) pages.push(page);
  return pages;
}
