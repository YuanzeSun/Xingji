import test from 'node:test';
import assert from 'node:assert/strict';
import { browser, until } from './helpers/d1-app.js';
import { prepareCloud } from './helpers/cloud.js';

test('flight time review preserves the editor and only saves after confirmation', async () => {
  const window = browser();
  const server = await prepareCloud();
  const form = () => document.querySelector('#editor-form');
  const review = () => document.querySelector('dialog[aria-labelledby="flight-time-review-title"]');
  const fill = (name, value) => {
    const input = form().elements[name];
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const submit = () => form().requestSubmit();

  try {
    await import('../src/app.js');
    await until(() => document.querySelector('[data-page="archive"]'));
    document.querySelector('[data-page="archive"]').click();
    const entry = '[data-action="new"][data-type="flight"]:not(:disabled)';
    await until(() => document.querySelector(entry));
    document.querySelector(entry).click();
    await until(form);
    for (const [field, value] of Object.entries({
      origin: 'PEK', destination: 'SHA', service: 'CA1234', passenger: 'TEST/USER', seat: '12A', seatClass: 'Y',
      departureTime: '10:00', arrivalTime: '11:00', actualDepartureTime: '10:00', actualArrivalTime: '12:00'
    })) fill(field, value);
    for (const field of ['departureDate', 'arrivalDate', 'actualDepartureDate', 'actualArrivalDate']) {
      fill(field + 'Year', '2026');
      fill(field + 'Month', '11');
      fill(field + 'Day', '18');
    }

    const originalForm = form();
    submit();
    assert.match(review().textContent, /起飞时间相同/);
    assert.match(review().textContent, /实际在途时间达到计划的 2 倍/);
    assert.equal(server.records().length, 0);
    review().querySelector('[autofocus]').click();
    await until(() => !form().dataset.pending);
    assert.equal(form(), originalForm);
    assert.equal(form().elements.actualArrivalTime.value, '12:00');
    assert.equal(server.records().length, 0);

    fill('actualDepartureTime', '10:30');
    fill('actualArrivalTime', '11:00');
    submit();
    assert.doesNotMatch(review().textContent, /起飞时间相同/);
    assert.match(review().textContent, /到达时间相同/);
    assert.match(review().textContent, /实际在途时间只有计划的一半/);
    review().querySelector('[data-confirm-flight-times]').click();
    await until(() => !form());
    assert.equal(server.records().length, 1);
    assert.equal(server.records()[0].actualDepartureTime, '10:30');
  } finally {
    window.dispatchEvent(new window.Event('offline'));
    window.close();
  }
});
