import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { bindUppercaseInputs } from '../src/uppercase-input.js';
import { createRecord } from '../src/model.js';
import { ticketSVG } from '../src/tickets.js';

test('name inputs capitalize typing and paste without moving the cursor or changing separators', () => {
  const dom = new JSDOM('<form><input name="firstName"><input name="lastName"><input name="chineseName"></form>');
  const form = dom.window.document.querySelector('form');
  bindUppercaseInputs(form, '[name="firstName"], [name="lastName"]');
  for (const name of ['firstName', 'lastName']) {
    const input = form.elements[name];
    input.value = "élise Anne/o'neil-smith";
    input.setSelectionRange(3, 3);
    input.dispatchEvent(new dom.window.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    assert.equal(input.value, "ÉLISE ANNE/O'NEIL-SMITH");
    assert.equal(input.selectionStart, 3);
  }
  form.elements.chineseName.value = '张三';
  form.elements.chineseName.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(form.elements.chineseName.value, '张三');
  dom.window.close();
});

test('ticket input capitalization waits for composition and preserves supplied and locked values', () => {
  const dom = new JSDOM('<form><input name="passenger"><input name="locked" readonly><input name="code" type="hidden"></form>');
  const { InputEvent, CompositionEvent, Event } = dom.window;
  const form = dom.window.document.querySelector('form'), input = form.elements.passenger;
  bindUppercaseInputs(form);
  let lastRead;
  input.addEventListener('input', () => { lastRead = input.value; });
  input.value = 'Zhang/San';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(input.value, 'Zhang/San');
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'aßé 张三/8f';
  input.setSelectionRange(2, 3, 'backward');
  input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  assert.equal(input.value, 'aßé 张三/8f');
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  assert.equal(lastRead, 'ASSÉ 张三/8F');
  assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [3, 4, 'backward']);
  for (const field of [form.elements.locked, form.elements.code]) {
    field.value = 'aBc123';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    assert.equal(field.value, 'aBc123');
  }
  dom.window.close();
});

test('both printed pass sections uppercase names without rewriting the source record', () => {
  const record = createRecord({ type: 'flight', template: 'air-boarding-pass', passenger: 'Zhang/San-Ming 张三' });
  const before = structuredClone(record);
  const dom = new JSDOM(ticketSVG(record), { contentType: 'image/svg+xml' });
  for (const side of ['main', 'stub']) assert.match(dom.window.document.querySelector(`[data-boarding-section="${side}"]`).textContent, /ZHANG\/SAN-MING 张三/);
  assert.deepEqual(record, before);
  dom.window.close();
});
