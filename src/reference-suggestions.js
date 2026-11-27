import { AIRLINES } from './data/airline-reference.js';
import { normalizePlaceKey as key } from './places.js';
import { bindSuggestionPicker } from './airport-picker.js';
import { escape as e } from './html.js';

const airlines = AIRLINES.map(([id, zh, en, codes, aliases]) => ({ id, name: zh || en, english: en, codes, terms: [zh, en, ...codes, ...aliases].filter(Boolean).map(key) }));
const frequentAirlines = new Set(['中国国际航空', '中国东方航空', '中国南方航空', '海南航空', '深圳航空', '四川航空', '厦门航空', '山东航空', '春秋航空', '吉祥航空', '新加坡航空', '国泰航空']);
export function suggestAirlines(query, limit = 8) {
  const value = key(query); if (!value) return [];
  return airlines.map(row => ({ row, score: Math.min(...row.terms.map(term => term === value ? 0 : term.startsWith(value) ? 1 : term.includes(value) ? 2 : 99)) }))
    .filter(match => match.score < 99).sort((a, b) => a.score - b.score || Number(frequentAirlines.has(b.row.name)) - Number(frequentAirlines.has(a.row.name)) || a.row.name.localeCompare(b.row.name, 'zh-CN')).slice(0, limit).map(({ row }) => ({ ...row }));
}

export function bindAirlinePicker(input) {
  bindSuggestionPicker(input, row => {
    input.value = row.name;
    input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
  }, {
    search: suggestAirlines, label: '匹配航空公司', empty: '未找到匹配航空公司，可继续手动填写',
    renderOption: row => `<span class="airport-option-name"><strong>${e(row.name)}</strong><small>${e([row.codes.join(' / '), row.english !== row.name ? row.english : ''].filter(Boolean).join(' · '))}</small></span>`
  });
}
