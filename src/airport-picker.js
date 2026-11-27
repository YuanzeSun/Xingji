import { searchAirports } from './places.js';
import { escape as e } from './html.js';

let nextId = 0;
const regions = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['zh-CN'], { type:'region' }) : null;

export function bindSuggestionPicker(input, onChoose, { search = searchAirports, label = '匹配机场', empty = '未找到匹配机场，可继续手动填写', renderOption } = {}) {
  const list = input.closest('.airport-picker')?.querySelector('[role="listbox"]');
  if (!list) return;
  list.id = `airport-matches-${++nextId}`;
  list.setAttribute('aria-label', label);
  const fieldLabel = input.closest('.field')?.firstElementChild;
  if (fieldLabel) { fieldLabel.id = list.id + '-label'; input.setAttribute('aria-labelledby', fieldLabel.id); }
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  let matches = [], active = -1, composing = false;
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const activate = index => {
    active = index;
    const options = list.querySelectorAll('[role="option"]');
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === active)));
    const option = options[active];
    if (option) {
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView?.({ block:'nearest' });
    }
  };
  const show = () => {
    if (input.readOnly || input.disabled) { close(); return; }
    if (composing || input.ownerDocument.activeElement !== input) return;
    if (!input.value.trim()) { matches = []; list.innerHTML = ''; close(); return; }
    matches = search(input.value);
    list.innerHTML = matches.length ? matches.map((place, index) => {
      let content, title = '';
      if (renderOption) content = renderOption(place);
      else {
        const name = place.chineseFullName || place.englishName;
        const detail = [place.cities?.join(' / ') || place.city || place.municipality, regions?.of(place.country) || place.country, place.englishName !== name ? place.englishName : ''].filter(Boolean).join(' · ');
        title = ` title="${e(name + ' · ' + detail)}"`;
        content = `<span class="airport-option-code">${e(place.code)}</span><span class="airport-option-name"><strong>${e(name)}</strong><small>${e(detail)}</small></span>`;
      }
      return `<span id="${list.id}-${index}" role="option" aria-selected="false" data-airport-index="${index}" class="airport-option"${title}>${content}</span>`;
    }).join('') : `<span class="airport-empty" role="status">${e(empty)}</span>`;
    const rect = input.getBoundingClientRect(), viewport = input.ownerDocument.defaultView.innerWidth;
    const modal = input.closest('dialog'), dialog = modal?.getBoundingClientRect();
    const leftEdge = dialog?.width ? Math.max(12, dialog.left + modal.clientLeft + 12) : 12;
    const rightEdge = dialog?.width ? Math.min(viewport - 12, dialog.left + modal.clientLeft + modal.clientWidth - 12) : viewport - 12;
    const width = Math.min(Math.max(rect.width, 360), rightEdge - leftEdge);
    list.style.width = `${width}px`;
    list.style.left = `${Math.max(leftEdge, Math.min(rect.left, rightEdge - width)) - rect.left}px`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    activate(matches.length ? 0 : -1);
  };
  const choose = index => {
    const place = matches[index];
    if (!place) return;
    onChoose(place);
    close();
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('blur', close);
  input.addEventListener('compositionstart', () => { composing = true; close(); });
  input.addEventListener('compositionend', () => { composing = false; show(); });
  input.addEventListener('keydown', event => {
    if (composing || event.isComposing) return;
    if (event.key === 'Escape' && !list.hidden) { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (list.hidden) { show(); if (matches.length && event.key === 'ArrowUp') activate(matches.length - 1); }
      else if (matches.length) activate((active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    }
    if (event.key === 'Enter' && !list.hidden && active >= 0) { event.preventDefault(); event.stopPropagation(); choose(active); }
  });
  list.addEventListener('pointerdown', event => event.preventDefault());
  list.addEventListener('click', event => {
    const option = event.target.closest('[data-airport-index]');
    if (option) { event.preventDefault(); choose(Number(option.dataset.airportIndex)); }
  });
  close();
}

export function bindAirportPicker(input, onChoose) { return bindSuggestionPicker(input, onChoose); }
