import {refreshTicketDateLocks} from './date-field.js';
export const barcodeFieldLocked = (record, key) => key==='departureDate' ? false : record.type === 'flight' && !!record.boardingCode && record.boardingCodeSource === 'original' && (key === 'type' || record.fieldSources?.[key]==='barcode');

export function refreshBarcodeFieldLocks(root, record) {
  refreshTicketDateLocks(root,record);
  for (const control of root.querySelectorAll('input[name],select[name],textarea[name]')) {
    if(control.closest('[data-journey-date]'))continue;
    if (control.closest('[data-bcbp-generator]')) continue;
    const key = control.name, locked = barcodeFieldLocked(record, key), wasLocked = control.hasAttribute('data-barcode-lock');
    if (!locked && !wasLocked) continue;
    control.toggleAttribute('data-barcode-lock', locked);
    if (record[key] !== undefined) control.value = record[key];
    const field = control.closest('.field');
    if (field) {
      field.toggleAttribute('data-barcode-locked', locked);
      for (const badge of field.querySelectorAll('[data-field-source]')) {
        badge.toggleAttribute('data-source-locked', locked);
        if (locked) badge.title = '条码读取，移除原始条码后可编辑';
      }
      const preset = field.querySelector('[data-seat-preset]');
      if (preset) { preset.disabled = locked; preset.value = [...preset.options].some(option => option.value === record[key]) ? record[key] : '__custom__'; }
    }
    if (control.tagName === 'SELECT') control.disabled = locked || control.hasAttribute('data-transport-fixed');
    else control.readOnly = locked;
  }
}
