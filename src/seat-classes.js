export const SEAT_CLASSES = Object.freeze({
  rail: ['商务座', '特等座', '优选一等座', '一等座', '二等座', '高级软卧', '软卧', '硬卧', '一等卧', '二等卧', '动卧', '软座', '硬座'],
  flight: [...new Set('YBMHKLQVWSTNUXJCDZIFAEGOPR')]
});

const aliases = {
  rail: { 商务: '商务座', 特等: '特等座', 一等: '一等座', 二等: '二等座' },
  flight: { 经济: '经济舱', 超经: '超级经济舱', 高端经济舱: '超级经济舱', 公务: '公务舱', 商务: '公务舱', 商务舱: '公务舱', 头等: '头等舱' }
};

export function flightCabinLabel(value) {
  const cabin=normalizeSeatClass(value,'flight');
  return /^[A-Z]\d{0,2}$/.test(cabin) ? cabin+'舱' : cabin;
}

export function normalizeSeatClass(value, type) {
  const trimmed = String(value || '').trim();
  const key = trimmed.normalize('NFKC').replace(/\s+/g, '');
  if (type === 'flight') {
    const code = key.match(/^([A-Z]\d{0,2})(?:舱)?$/i)?.[1] || key.match(/^(?:经济舱|超级经济舱|公务舱|商务舱|头等舱)[(]([A-Z]\d{0,2})[)]$/i)?.[1] || key.match(/^([A-Z]\d{0,2})(?:舱)?[(](?:经济舱|超级经济舱|公务舱|商务舱|头等舱)[)]$/i)?.[1];
    if (code) return code.toUpperCase();
  }
  const names = aliases[type] || {};
  return (Object.hasOwn(names, key) ? names[key] : '') || SEAT_CLASSES[type]?.find(label => label === key) || trimmed;
}
