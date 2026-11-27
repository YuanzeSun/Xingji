import { codeBytes, decodeCodeText } from './barcode-data.js';
import { escape } from './html.js';

export function barcodePayloadMarkup(code) {
  if (!code) return '';
  const bytes = codeBytes(code.rawBytes);
  const boardingPass = bytes[0] === 77 && bytes[1] >= 49 && bytes[1] <= 52;
  const text = decodeCodeText(bytes, boardingPass ? 'gb18030' : undefined);
  const binary = text === null || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text);
  const raw = binary ? Array.from(bytes, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') : text;
  const kind = code.format.endsWith('QRCode') ? '二维码' : code.format === 'Code128' ? '条形码' : '条码';
  const label = kind + (binary ? '原始字节（十六进制）' : '原始字符串');
  const content = escape(raw).replace(/\r/g, '&#13;');
  return `<figure class="barcode-payload" data-barcode-payload><figcaption>${label}</figcaption><pre><code dir="ltr">${content}</code></pre></figure>`;
}
