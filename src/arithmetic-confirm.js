import { escape as e } from './html.js';

export function createArithmeticChallenge(random = max => crypto.getRandomValues(new Uint32Array(1))[0] % max) {
  const op=random(4),a=random(9)+1,b=random(9)+1;
  if(op===0)return {question:`${a} + ${b}`,answer:a+b};
  if(op===1)return {question:`${Math.max(a,b)} − ${Math.min(a,b)}`,answer:Math.abs(a-b)};
  if(op===2)return {question:`${a} × ${b}`,answer:a*b};
  return {question:`${a*b} ÷ ${b}`,answer:a};
}
export function arithmeticField(challenge) {
  return `<label class="field arithmetic-field"><span>请计算 <strong data-arithmetic-question>${e(challenge.question)}</strong></span><input name="arithmetic-answer" inputmode="numeric" autocomplete="off" maxlength="6" aria-label="算式答案" required /></label><p class="form-error" role="alert" data-arithmetic-error></p>`;
}
export const checkArithmeticAnswer = (challenge,value) => /^\d{1,6}$/.test(String(value).trim()) && Number(value)===challenge.answer;
