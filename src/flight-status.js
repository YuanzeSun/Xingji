export const FLIGHT_STATUSES = { normal: '正常', open: 'OPEN', invalid: '无效' };
export function normalizeFlightStatus(value = '') {
  const text = String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text || ['normal', '正常', '正常机票'].includes(text)) return 'normal';
  if (['open', 'open票', 'open 票', 'open ticket'].includes(text)) return 'open';
  if (['invalid', 'void', '无效', '无效票'].includes(text)) return 'invalid';
  throw new Error('不支持的机票状态');
}
export const isInactiveFlight = record => record.type === 'flight' && ['open', 'invalid'].includes(record.flightStatus);
