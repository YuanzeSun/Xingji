export const FLIGHT_STATUSES = { normal: '正常', open: 'OPEN', invalid: '无效' };
export function normalizeFlightStatus(value = '') {
  const text = String(value).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text || ['normal', '正常', '正常机票'].includes(text)) return 'normal';
  if (['open', 'open票', 'open 票', 'open ticket'].includes(text)) return 'open';
  if (['invalid', 'void', '无效', '无效票'].includes(text)) return 'invalid';
  throw new Error('不支持的机票状态');
}
export const isInactiveFlight = record => record.type === 'flight' && ['open', 'invalid'].includes(record.flightStatus);
export function flightStatusFromText(text) {
  const labelled = text.match(/(?:机票状态|票据状态|TICKET\s+STATUS)\s*[:：]\s*(OPEN(?:[ \t]*TICKET|[ \t]*票)?|INVALID|VOID|无效票?|正常(?:机票)?|NORMAL)(?=$|[\s,，;；])/i);
  const stamp = text.match(/(?:^|\n)[ \t]*(OPEN(?:[ \t]+TICKET)?|INVALID|VOID|无效票)[ \t]*(?=\n|$)/i);
  return labelled || stamp ? normalizeFlightStatus((labelled || stamp)[1]) : '';
}
