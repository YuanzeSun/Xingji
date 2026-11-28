import { RAIL_SEAT_CLASSES, normalizeSeatClass } from './seat-classes.js';
import { escape as e } from './html.js';
import { requiredRecordFields, ticketRequiredMark } from './ticket-form.js';
import {fieldSourceBadge} from './field-sources.js';

export function seatClassField(record) {
  const value = normalizeSeatClass(record.seatClass, record.type);
  const required = requiredRecordFields(record).includes('seatClass');
  const marks = ticketRequiredMark(record, 'seatClass', required) + fieldSourceBadge('seatClass', record);
  if (record.type === 'flight') {
    return `<label class="field"><span>舱位代码${marks}</span><input type="text" name="seatClass" value="${e(value)}" ${required ? 'required' : ''} spellcheck="false" /></label>`;
  }
  const custom = !!value && !RAIL_SEAT_CLASSES.includes(value);
  return `<div class="field seat-class-field"><span>席别${marks}</span><select ${required ? 'required aria-required="true"' : ''} data-seat-preset aria-label="选择席别"><option value="">选择席别</option>${RAIL_SEAT_CLASSES.map(label => `<option value="${e(label)}" ${value === label ? 'selected' : ''}>${e(label)}</option>`).join('')}<option value="__custom__" ${custom ? 'selected' : ''}>自定义…</option></select><input name="seatClass" aria-required="${required}" value="${e(value)}" aria-label="自定义席别" placeholder="填写席别" ${custom ? '' : 'hidden'} /></div>`;
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
