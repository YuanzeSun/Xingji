import {refreshTicketDateLocks} from './date-field.js';
import {railBarcodeFieldLocked, railInvoiceFieldLocked} from './field-sources.js';
import {splitBerth} from './seat-field.js';
import {refreshRailQRMarks} from './ticket-form.js';
export const ticketFieldLocked = (record, key) => railInvoiceFieldLocked(record,key) || railBarcodeFieldLocked(record,key) ||
  (key!=='departureDate' && record.type === 'flight' && !!record.boardingCode && record.boardingCodeSource === 'original' && (key === 'type' || record.fieldSources?.[key]==='barcode'));

export function refreshTicketFieldLocks(root, record) {
  refreshTicketDateLocks(root,record);
  for (const control of root.querySelectorAll('input[name],select[name],textarea[name]')) {
    if(control.closest('[data-journey-date]'))continue;
    if (control.closest('[data-bcbp-generator]')) continue;
    const key = control.name, locked = ticketFieldLocked(record, key), wasLocked = control.hasAttribute('data-barcode-lock');
    if (!locked && !wasLocked) continue;
    control.toggleAttribute('data-barcode-lock', locked);
    if (record[key] !== undefined) control.value = record[key];
    const field = control.closest('.field');
    if (field) {
      field.toggleAttribute('data-barcode-locked', locked);
      for (const badge of field.querySelectorAll('[data-field-source]')) {
        badge.toggleAttribute('data-source-locked', locked);
        if (locked) badge.title = railInvoiceFieldLocked(record,key) ? 'PDF 导入，字段已锁定' : '条码读取，移除原始条码后可编辑';
      }
      const preset = field.querySelector('[data-seat-preset]');
      if (preset) { preset.disabled = locked; preset.value = [...preset.options].some(option => option.value === record[key]) ? record[key] : '__custom__'; }
    }
    if (control.tagName === 'SELECT') control.disabled = locked || control.hasAttribute('data-transport-fixed');
    else control.readOnly = locked;
  }
  if (record.type !== 'rail') return;
  refreshRailQRMarks(root, record);
  const seatLocked = ticketFieldLocked(record, 'seat');
  const seat = splitBerth(record.seat);
  for (const [selector, value] of [['[data-seat-number]', seat.number], ['[data-berth]', seat.berth]]) {
    const control = root.querySelector(selector);
    if (!control || (!seatLocked && !control.hasAttribute('data-barcode-lock'))) continue;
    control.toggleAttribute('data-barcode-lock', seatLocked);
    control.value = value;
    if (control.tagName === 'SELECT') control.disabled = seatLocked;
    else control.readOnly = seatLocked;
  }
  const standing = root.querySelector('[data-rail-standing]');
  if (standing) {
    const locked = seatLocked || ticketFieldLocked(record, 'railStanding');
    standing.disabled = locked;
    if (locked) standing.checked = record.railStanding === true;
    standing.parentElement.querySelector('[data-field-source]')?.toggleAttribute('data-source-locked', locked);
  }
}
