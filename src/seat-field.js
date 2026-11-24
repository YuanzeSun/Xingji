import { escape as e } from './html.js';
import { requiredRecordFields, ticketRequiredMark } from './ticket-form.js';

export function splitBerth(value = '') {
  const match = String(value).trim().match(/^(.*?)(?:号)?([上中下]铺)$/u);
  return match ? { number: match[1], berth: match[2] } : { number: String(value).trim(), berth: '' };
}

export function seatField(record) {
  const { number, berth } = splitBerth(record.seat);
  const sleeper = /卧/.test(record.seatClass) || (!record.seatClass && !!berth);
  const required = requiredRecordFields(record).includes('seat');
  return `<div class="field seat-field"><span>座位 / 铺位${ticketRequiredMark(record, 'seat', required)}${fieldSourceBadge('seat',record)}</span><div class="seat-controls"><input data-seat-number ${required ? 'required aria-required="true"' : ''} aria-label="座位或铺位编号" value="${e(number)}" placeholder="如 015、08F" /><select data-berth aria-label="铺位"${sleeper ? '' : ' hidden'}><option value="">铺位未收录</option>${['上铺', '中铺', '下铺'].map(value => `<option value="${value}"${value === berth ? ' selected' : ''}>${value}</option>`).join('')}</select></div><input type="hidden" name="seat" value="${e(record.seat)}" /></div>`;
}

export function bindSeatFields(root) {
  const number = root.querySelector('[data-seat-number]');
  if (!number) return;
  const input = root.querySelector('[name="seat"]'), berth = root.querySelector('[data-berth]'), seatClass = root.querySelector('[name="seatClass"]');
  let rememberedBerth = berth.value, updating = false;
  const compose = () => {
    const sleeper = /卧/.test(seatClass.value) || (!seatClass.value && !!rememberedBerth);
    berth.hidden = !sleeper;
    const value = number.value.trim();
    input.value = value + (value && sleeper && rememberedBerth ? '号' + rememberedBerth : '');
  };
  const notify = () => {
    updating = true;
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
    updating = false;
  };
  number.addEventListener('input', () => {
    const pasted = splitBerth(number.value);
    if (pasted.berth) { number.value = pasted.number; berth.value = rememberedBerth = pasted.berth; }
    compose();
  });
  berth.addEventListener('change', () => { rememberedBerth = berth.value; compose(); notify(); });
  seatClass.addEventListener('input', compose);
  input.addEventListener('input', () => {
    if (updating) return;
    const value = splitBerth(input.value);
    number.value = value.number; berth.value = rememberedBerth = value.berth;
    berth.hidden = !/卧/.test(seatClass.value) && !!seatClass.value;
  });
}
import {fieldSourceBadge} from './field-sources.js';
