import { normalizeTicketCode } from './ticket-code.js';
import { normalizeBoardingCode } from './boarding-code.js';

export const hasLegacyCodes = records => records.some(record => ['ticketCode', 'boardingCode'].some(field => typeof record[field] === 'string' && record[field].startsWith('data:image/png;base64,')));
export async function upgradeCodeRecords(records, rebuild) {
  if (!hasLegacyCodes(records)) return records;
  rebuild ||= (await import('./code-reader.js')).rebuildCodesFromImage;
  const cache = new Map(), result = [];
  for (const record of records) {
    const next = { ...record };
    for (const [field, type, normalize] of [['ticketCode', 'rail', normalizeTicketCode], ['boardingCode', 'flight', normalizeBoardingCode]]) {
      const value = record[field];
      if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) continue;
      const key = type + ':' + value;
      if (!cache.has(key)) {
        const bytes = Uint8Array.from(atob(value.slice(value.indexOf(',') + 1)), char => char.charCodeAt(0));
        const decoded = await rebuild(new Blob([bytes], { type: 'image/png' }), type);
        if (decoded.codes.length !== 1 || !decoded.codes[0].verified) throw new Error('已有条码图片无法转换为原始数据，已停止同步并保留原数据');
        cache.set(key, normalize(decoded.codes[0].data));
      }
      next[field] = cache.get(key);
    }
    result.push(next);
  }
  return result;
}
