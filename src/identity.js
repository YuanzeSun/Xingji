const normalizedIdentity = value => String(value || '').normalize('NFKC').trim();
const nationalId = /^\d{17}[\dXx]$/;
export const hasMaskedIdentity = value => /[*•●]/u.test(normalizedIdentity(value));

export const identityPattern = value => normalizedIdentity(value).replace(/\s+/gu, '').replace(/[•●]/gu, '*').toUpperCase();

export function printedIdentityHint(text) {
  const normalized = text.normalize('NFKC');
  const labelled = normalized.match(/(?:证件号(?:码)?|身份证(?:号(?:码)?)?|护照号(?:码)?)\s*[:：]?\s*([A-Z0-9*•●]{3,40})(?![A-Z0-9*•●])/iu)?.[1];
  if (labelled) return labelled;
  return normalized.match(/(?<![A-Z0-9])([\d*•●]{14}[\dX*•●]|[\d*•●]{17}[\dX*•●])[ \t]+(?=\p{Script=Han}{2,8})/u)?.[1]
    || normalized.match(/(?<!\d)(\d{6,14}X{2,8}\d{2,4})[ \t]+(?=\p{Script=Han}{2,8})/iu)?.[1].replace(/X+/i, run => '*'.repeat(run.length))
    || '';
}

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
