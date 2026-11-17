export const uppercaseName = value => String(value || '').toUpperCase();

export function bindUppercaseNames(form, names, enabled = () => true) {
  const normalize = event => {
    const input = event.target;
    if (!names.includes(input.name) || event.isComposing || !enabled()) return;
    const value = uppercaseName(input.value);
    if (value === input.value) return;
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    const before = input.value;
    input.value = value;
    if (start !== null && end !== null) input.setSelectionRange(uppercaseName(before.slice(0, start)).length, uppercaseName(before.slice(0, end)).length, direction);
  };
  for (const event of ['input', 'change', 'compositionend']) form.addEventListener(event, normalize);
}
