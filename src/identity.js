const normalizedIdentity = value => String(value || '').normalize('NFKC').trim();
const nationalId = /^\d{17}[\dXx]$/;
export const hasMaskedIdentity = value => normalizedIdentity(value).includes('*');

export function requireCompleteIdentity(value) {
  if (hasMaskedIdentity(value)) throw Object.assign(new Error('请填写完整证件号，证件号不能包含星号。'), { fields: ['identity'] });
}

export function bindIdentityInput(input) {
  let previous = hasMaskedIdentity(input.value) ? '' : input.value;
  const accept = () => {
    if (hasMaskedIdentity(input.value)) input.value = previous;
    else previous = input.value;
  };
  input.addEventListener('beforeinput', event => {
    accept();
    if (hasMaskedIdentity(event.data ?? event.dataTransfer?.getData('text/plain'))) event.preventDefault();
  });
  input.addEventListener('input', accept);
}

export function maskIdentity(value) {
  const supplied = normalizedIdentity(value);
  if (!supplied || supplied.includes('*')) return '';
  const number = supplied.replace(/\s+/gu, '');
  if (nationalId.test(number)) return number.slice(0, 6) + '*'.repeat(8) + number.slice(-4).toUpperCase();
  if (/^\d{15}$/.test(number)) return number.slice(0, 6) + '*'.repeat(6) + number.slice(-3);
  const characters = [...number];
  if (characters.length <= 4) return '*'.repeat(characters.length);
  return characters.slice(0, 2).join('') + '*'.repeat(characters.length - 4) + characters.slice(-2).join('');
}

export function maskRailIdentity(value, { isNationalId } = {}) {
  const supplied = normalizedIdentity(value);
  if (!supplied || supplied.includes('*')) return '';
  const number = supplied.replace(/\s+/gu, '');
  if (isNationalId !== false && nationalId.test(number)) return number.slice(0, 10) + '****' + number.slice(14).toUpperCase();
  const characters = [...number], hidden = Math.min(characters.length, characters.length <= 11 ? 2 : 4);
  return characters.slice(0, characters.length - hidden).join('') + '*'.repeat(hidden);
}
