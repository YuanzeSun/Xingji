import { fieldSourceLabel, markFieldSources } from './field-sources.js';
import { bindAirportPicker } from './airport-picker.js';
import { flightQuery } from './flight-query.js';
import { airportCode } from './flight-stops.js';
import { resolvePlace } from './places.js';

export function flightStopsField() {
  return `<div class="full-field form-grid" data-flight-stops-editor>
    <label class="field"><span>经停情况<small class="field-source" data-flight-stops-source></small></span>
      <select name="flightStopCount">
        <option value="">未记录</option><option value="0">直飞</option><option value="1">经停一次</option>
      </select>
    </label>
    <label class="field" data-flight-stop-airport hidden><span>经停机场（可选）</span>
      <span class="airport-picker"><input name="flightStopAirport" type="text" placeholder="机场名或三字码" maxlength="120" /><span class="airport-suggestions" role="listbox" hidden></span></span>
    </label>
  </div>`;
}

function fieldError(message, field = 'flightStopAirport') {
  return Object.assign(new Error(message), { fields: [field] });
}

function readFlightStops(record, input) {
  if (input.count === '') return;
  const count = Number(input.count);
  let query;
  try { query = flightQuery(record); }
  catch (error) { throw fieldError(error.message, 'flightStopCount'); }
  if (!query.dep || !query.arr || query.dep === query.arr) {
    throw fieldError('请先确认出发机场和到达机场', 'flightStopCount');
  }
  const value = count ? input.airport.normalize('NFKC').trim() : '';
  if (!value) return { ...query, count, airports: [] };
  const place = resolvePlace({ type: 'flight', origin: value }, 'origin');
  const code = place.code || value.toUpperCase();
  if (!airportCode(code)) throw fieldError('请选择一个经停机场，或填写机场三字码');
  if (code === query.dep || code === query.arr) throw fieldError('经停机场须与出发和到达机场不同');
  return { ...query, count, airports: [code] };
}

export function bindFlightStopsEditor(form, record, manualInput, onEdit) {
  const field = form.querySelector('[data-flight-stops-editor]');
  const count = form.elements.flightStopCount, airport = form.elements.flightStopAirport;
  const airportField = field.querySelector('[data-flight-stop-airport]');
  const source = field.querySelector('[data-flight-stops-source]');

  function refreshVisibilityAndSource() {
    airportField.hidden = Number(count.value) === 0;
    source.textContent = manualInput ? (count.value === '' ? '未填写' : '手动输入') : fieldSourceLabel(record, 'flightStops');
    source.dataset.sourceKind = manualInput ? (count.value === '' ? '' : 'manual') : record.fieldSources?.flightStops || '';
  }
  function refresh() {
    count.value = manualInput?.count ?? record.flightStops?.count ?? '';
    airport.value = manualInput?.airport ?? record.flightStops?.airports[0] ?? '';
    refreshVisibilityAndSource();
  }
  function update() {
    if (Number(count.value) === 0) airport.value = '';
    manualInput = { count: count.value, airport: airport.value };
    refreshVisibilityAndSource();
    onEdit(manualInput);
  }
  bindAirportPicker(airport, place => {
    airport.value = place.code;
    airport.dispatchEvent(new airport.ownerDocument.defaultView.Event('input', { bubbles: true }));
  });
  field.addEventListener('input', update);
  field.addEventListener('change', update);
  refresh();

  return {
    refresh,
    commit() {
      if (!manualInput) return;
      const value = readFlightStops(record, manualInput);
      if (value) {
        record.flightStops = value;
        markFieldSources(record, ['flightStops'], 'manual');
      } else {
        delete record.flightStops;
        delete record.fieldSources.flightStops;
      }
    }
  };
}
