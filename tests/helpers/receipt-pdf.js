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
            const pages = new TextDecoder().decode(data).split('\\f');
            return { promise: Promise.resolve({
              numPages: pages.length,
              async getPage(index) {
                return { async getTextContent() {
                  return { items: pages[index - 1].split('\\n').map(str => ({ str, hasEOL: true })) };
                } };
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

