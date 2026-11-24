import { registerHooks } from 'node:module';

export function stubReceiptPDF() {
  const url = import.meta.resolve('pdfjs-dist/build/pdf.mjs');
  return registerHooks({
    load(specifier, context, next) {
      if (specifier !== url) return next(specifier, context);
      return {
        shortCircuit: true,
        format: 'module',
        source: `
          export const GlobalWorkerOptions = {};
          export function getDocument({ data }) {
            const pages = JSON.parse(new TextDecoder().decode(data));
            return { promise: Promise.resolve({
              numPages: pages.length,
              async getPage(index) {
                const { view, items } = pages[index - 1];
                return { view, async getTextContent() { return { items }; } };
              },
              async destroy() {}
            }) };
          }
        `
      };
    }
  });
}

export function pickReceipt(window, file) {
  const input = document.querySelector('[data-rail-receipt-file]');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
}


export function receiptPage({ service = 'G21', seat = '05车08F号', seatClass = '二等座', passenger = '发票姓名' } = {}) {
  // Same positions as a railway invoice, with fictional values and fragments out of reading order.
  const item = (str, x, y, height = 12) => ({ str, transform: [height, 0, 0, height, x, y], height });
  return {
    view: [0, 0, 595.27, 396.65],
    items: [
      item('开票日期:2026年06月01日', 431, 341),
      item('发票号码:26000000000000000001', 26, 339),
      item('南京南', 406, 298, 20), item('站', 466, 298),
      item('北京南', 96, 298, 20), item('站', 156, 298), item(service, 269, 298, 16),
      item('Nanjingnan', 411, 279), item('Beijingnan', 99, 279),
      item('2024年10月01日', 26, 253), item('08:00开', 125, 253),
      item(seat, 213, 253), item(seatClass, 360, 253),
      item('票价:', 26, 217), item('￥', 55, 217, 18),
      item('1101012000****0012', 26, 164), item(passenger, 213, 164),
      item('电子客票号:', 26, 107), item('2600000000000000000000001', 92, 107),
      item('购买方名称:', 26, 83), item('示例单位', 92, 83),
      item('统一社会信用代码:', 360, 83), item('100000000000000001', 462, 83),
      item('电子发票（铁路电子客票）', 178, 362, 20), item('503.50', 73, 217, 18)
    ]
  };
}

export const receiptBytes = (...pages) => new TextEncoder().encode(JSON.stringify(pages)).buffer;
