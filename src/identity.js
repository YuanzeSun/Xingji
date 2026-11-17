export function maskIdentity(value) {
  const supplied = String(value || '').normalize('NFKC').trim();
  if (!supplied || supplied.includes('*')) return supplied;
  const number = supplied.replace(/\s+/gu, '');
  if (/^\d{17}[\dXx]$/.test(number)) return number.slice(0, 6) + '*'.repeat(8) + number.slice(-4).toUpperCase();
  if (/^\d{15}$/.test(number)) return number.slice(0, 6) + '*'.repeat(6) + number.slice(-3);
  const characters = [...number];
  if (characters.length <= 4) return '*'.repeat(characters.length);
  return characters.slice(0, 2).join('') + '*'.repeat(characters.length - 4) + characters.slice(-2).join('');
}
