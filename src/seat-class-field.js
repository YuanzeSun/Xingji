import { SEAT_CLASSES, normalizeSeatClass } from './seat-classes.js';
import { escape as e } from './html.js';
import { requiredTicketFields } from './ticket-form.js';
import {fieldSourceBadge} from './field-sources.js';

export function seatClassField(record) {
  const flight = record.type === 'flight', presets = SEAT_CLASSES[record.type];
  const value = normalizeSeatClass(record.seatClass, record.type);
  const custom = !!value && !presets.includes(value);
  const required = requiredTicketFields(record.type, record.template, record.flightStatus, record.railStanding).includes('seatClass');
  return `<div class="field seat-class-field"><span>${flight ? '舱位代码' : '席别'}${required ? '<b class="required-mark" aria-label="必填">*</b>' : ''}${fieldSourceBadge('seatClass',record)}</span><select ${required ? 'required aria-required="true"' : ''} data-seat-preset aria-label="选择席别或舱位"><option value="">${flight ? '选择舱位代码' : '选择席别'}</option>${presets.map(label => `<option value="${e(label)}" ${value === label ? 'selected' : ''}>${e(label)}</option>`).join('')}<option value="__custom__" ${custom ? 'selected' : ''}>自定义…</option></select><input name="seatClass" aria-required="${required}" value="${e(value)}" aria-label="自定义席别或舱位" placeholder="${flight ? '如 Y、M1，按原票填写' : '填写席别'}" ${custom ? '' : 'hidden'} /></div>`;
}

export function bindSeatClassFields(root) {
  for (const select of root.querySelectorAll('[data-seat-preset]')) {
    const input = select.parentElement.querySelector('[name="seatClass"]');
    let customValue = input.hidden ? '' : input.value;
    input.addEventListener('input', () => { if (!input.hidden) customValue = input.value; });
    select.addEventListener('change', () => {
      const custom = select.value === '__custom__';
      input.hidden = !custom; input.required = custom && select.required;
      input.value = custom ? customValue : select.value;
      input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
      if (custom) input.focus();
    });
  }
}
