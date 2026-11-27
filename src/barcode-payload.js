import { codeBytes } from './barcode-data.js';
import { escape } from './html.js';

function payloadText(bytes) {
  const encodings = bytes[0] === 77 && bytes[1] >= 49 && bytes[1] <= 52 ? ['utf-8', 'gb18030'] : ['utf-8'];
  for (const encoding of encodings) {
    try { return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { /* Try the other encoding used by domestic boarding passes. */ }
  }
  return null;
}

export function barcodePayloadMarkup(code, { open = false } = {}) {
  if (!code) return '';
  const bytes = codeBytes(code.rawBytes), text = payloadText(bytes);
  const binary = text === null || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text);
  const raw = binary ? Array.from(bytes, byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ') : text;
  const kind = code.format.endsWith('QRCode') ? '二维码' : code.format === 'Code128' ? '条形码' : '条码';
  const label = kind + (binary ? '原始字节（十六进制）' : '原始字符串');
  const content = escape(raw).replace(/\r/g, '&#13;');
  return '<details class="barcode-payload" data-barcode-payload' + (open ? ' open' : '') + '><summary>' + label +
    '</summary><pre><code dir="ltr">' + content + '</code></pre></details>';
}
