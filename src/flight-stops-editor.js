import { fieldSourceLabel, markFieldSources } from './field-sources.js';
import { flightQuery } from './flight-query.js';
import { airportCode, MAX_FLIGHT_STOPS } from './flight-stops.js';
import { resolvePlace } from './places.js';

export function flightStopsField() {
  const counts = Array.from({ length: MAX_FLIGHT_STOPS }, (_, index) => index + 1);
  return `<div class="full-field form-grid" data-flight-stops-editor>
    <label class="field"><span>经停情况<small class="field-source" data-flight-stops-source></small></span>
      <select name="flightStopCount">
        <option value="">未记录</option><option value="0">直飞</option>
        ${counts.map(count => `<option value="${count}">经停 ${count} 次</option>`).join('')}
      </select>
    </label>
    <label class="field" data-flight-stops-airports hidden><span>经停机场（可选）</span>
      <input name="flightStopAirports" type="text" placeholder="机场名或三字码，用顿号分隔" autocomplete="off" spellcheck="false" maxlength="300" />
    </label>
  </div>`;
}

function fieldError(message, field = 'flightStopAirports') {
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
  const airports = count ? input.airports.normalize('NFKC').split(/[、,;；]+/).map(value => value.trim()).filter(Boolean).map(value => {
    const code = value.toUpperCase();
    if (airportCode(code)) return code;
    const place = resolvePlace({ type: 'flight', origin: value }, 'origin');
    if (place.status !== 'matched') throw fieldError(`无法识别「${value}」，请填写机场三字码或完整机场名`);
    return place.code;
  }) : [];
  if (airports.length > count) throw fieldError('经停机场数超过经停次数');
  if (new Set(airports).size !== airports.length) throw fieldError('经停机场重复');
  if (airports.includes(query.dep) || airports.includes(query.arr)) throw fieldError('经停机场须与出发和到达机场不同');
  return { ...query, count, airports };
}

export function bindFlightStopsEditor(form, record, manualInput, onEdit) {
  const field = form.querySelector('[data-flight-stops-editor]');
  const count = form.elements.flightStopCount, airports = form.elements.flightStopAirports;
  const airportField = field.querySelector('[data-flight-stops-airports]');
  const source = field.querySelector('[data-flight-stops-source]');

  function refreshVisibilityAndSource() {
    airportField.hidden = Number(count.value) === 0;
    source.textContent = manualInput ? (count.value === '' ? '未填写' : '手动输入') : fieldSourceLabel(record, 'flightStops');
    source.dataset.sourceKind = manualInput ? (count.value === '' ? '' : 'manual') : record.fieldSources?.flightStops || '';
  }
  function refresh() {
    count.value = manualInput?.count ?? record.flightStops?.count ?? '';
    airports.value = manualInput?.airports ?? record.flightStops?.airports.join('、') ?? '';
    refreshVisibilityAndSource();
  }
  function update() {
    if (Number(count.value) === 0) airports.value = '';
    manualInput = { count: count.value, airports: airports.value };
    refreshVisibilityAndSource();
    onEdit(manualInput);
  }
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
