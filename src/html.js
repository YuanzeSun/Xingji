export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function selectOptions(options, selected) {
  return options.map(([value, label]) => Array.isArray(label)
    ? `<optgroup label="${escape(value)}">${selectOptions(label, selected)}</optgroup>`
    : `<option value="${escape(value)}" ${selected === value ? 'selected' : ''}>${escape(label)}</option>`).join('');
}
