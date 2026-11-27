export const FLIGHT_STATUSES = { normal: '正常', open: 'OPEN', invalid: '无效' };
export function normalizeFlightStatus(value) {
  const status = value || 'normal';
  if (!Object.hasOwn(FLIGHT_STATUSES, status)) throw new Error('不支持的机票状态');
  return status;
}
export const isInactiveFlight = record => record.type === 'flight' && ['open', 'invalid'].includes(record.flightStatus);
