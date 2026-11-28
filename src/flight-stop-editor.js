import { fieldSourceKind, fieldSourceLabel, markFieldSources } from './field-sources.js';
import { bindAirportPicker } from './airport-picker.js';
import { flightQuery } from './flight-query.js';
import { airportCode } from './flight-stop.js';
import { resolvePlace } from './places.js';

export function flightStopField() {
  return `<label class="field" data-flight-stop-editor><span>经停机场<small class="field-source" data-flight-stop-source hidden></small></span>
    <span class="airport-picker"><input name="flightStopAirport" type="text" placeholder="机场名或三字码" maxlength="120" /><span class="airport-suggestions" role="listbox" hidden></span></span>
  </label>`;
}

function fieldError(message) {
  return Object.assign(new Error(message), { fields: ['flightStopAirport'] });
}

function readFlightStop(record, input) {
  const value = input.normalize('NFKC').trim();
  if (!value) return;
  let query;
  try { query = flightQuery(record); }
  catch (error) { throw fieldError(error.message); }
  if (!query.dep || !query.arr || query.dep === query.arr) {
    throw fieldError('请先确认出发机场和到达机场');
  }
  const place = resolvePlace({ type: 'flight', origin: value }, 'origin');
  const code = place.code || value.toUpperCase();
  if (!airportCode(code)) throw fieldError('请选择一个经停机场，或填写机场三字码');
  if (code === query.dep || code === query.arr) throw fieldError('经停机场须与出发和到达机场不同');
  return { ...query, airport: code };
}

export function bindFlightStopEditor(form, record, manualInput, onEdit) {
  const airport = form.elements.flightStopAirport;
  const source = form.querySelector('[data-flight-stop-source]');

  function refreshSource() {
    const filled = Boolean(airport.value.trim());
    const edited = manualInput !== undefined;
    source.hidden = !filled;
    source.textContent = edited ? '手动输入' : fieldSourceLabel(record, 'flightStop');
    source.dataset.sourceKind = edited ? 'manual' : fieldSourceKind(record, 'flightStop');
  }
  function refresh() {
    const value = manualInput ?? record.flightStop?.airport ?? '';
    const place = resolvePlace({ type: 'flight', origin: value }, 'origin');
    airport.value = place.chineseFullName || place.name || value;
    refreshSource();
  }
  function setManualInput(value) {
    manualInput = value;
    onEdit(value);
  }
  bindAirportPicker(airport, place => {
    setManualInput(place.code);
    refresh();
  });
  airport.addEventListener('input', () => {
    setManualInput(airport.value);
    refreshSource();
  });
  airport.addEventListener('change', refresh);
  refresh();

  return {
    refresh,
    commit() {
      if (manualInput === undefined) return;
      const value = readFlightStop(record, manualInput);
      if (value) {
        record.flightStop = value;
        markFieldSources(record, ['flightStop'], 'manual');
      } else {
        delete record.flightStop;
        delete record.fieldSources.flightStop;
      }
    }
  };
}
