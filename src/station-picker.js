import { searchStations } from './places.js';
import { bindSuggestionPicker } from './airport-picker.js';
import { escape as e } from './html.js';

export function bindStationPicker(input,onChoose) {
  return bindSuggestionPicker(input,onChoose,{
    search:searchStations,label:'匹配火车站',empty:'未找到匹配车站，可继续手动填写',
    renderOption:place=>`<span class="airport-option-name"><strong>${e(place.name)}</strong><small>${e(place.city)}</small></span>`
  });
}
