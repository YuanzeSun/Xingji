export const uppercaseName = value => String(value || '').toUpperCase();
const textTypes = new Set(['text', 'search', 'textarea']);

export function bindUppercaseInputs(form, selector = 'input, textarea') {
  const { InputEvent, CompositionEvent } = form.ownerDocument.defaultView;
  const composing = new WeakSet();
  form.addEventListener('compositionstart', event => composing.add(event.target), true);
  const normalize = event => {
    const input = event.target;
    if (event.type === 'compositionend') composing.delete(input);
    // Pickers and lookups use plain synthetic events to apply their own values.
    if (!event.isTrusted && !(event instanceof InputEvent || event instanceof CompositionEvent)) return;
    if (event.isComposing || composing.has(input)) return;
    if (!input.matches(selector) || !textTypes.has(input.type) || input.readOnly || input.matches(':disabled')) return;
    const before = input.value, value = uppercaseName(before);
    if (value === before) return;
    const start = input.selectionStart, end = input.selectionEnd, direction = input.selectionDirection;
    input.value = value;
    input.setSelectionRange(before.slice(0, start).toUpperCase().length, before.slice(0, end).toUpperCase().length, direction);
    if (event.type !== 'input') input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  };
  for (const event of ['input', 'change', 'compositionend']) form.addEventListener(event, normalize, true);
}
