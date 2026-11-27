import {ticketCard,ticketListRow} from './ticket-card.js';
import {ticketSpaceMarkup} from './ticket-space.js';
import {timeline,ticketPeriods} from './timeline.js';
import {flightTicketKey} from './flight-ticket-shared.js';
import {flightsInDepartureOrder} from './journey-duration.js';

const modes = [['list','列表','<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>'],['grid','网格','<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'],['space','3D 空间','<path d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/>']];
const sizes = {small:{label:'小',scale:.4},medium:{label:'中',scale:1}};
export function ticketViewOptions(value = {}, defaultMode = 'grid') {
  return {mode:modes.some(([mode])=>mode===value?.mode) ? value.mode : defaultMode,size:Object.hasOwn(sizes,value?.size) ? value.size : 'medium'};
}
const ticketGridStyle = size => `--ticket-min:${390*sizes[size].scale}px;--ticket-scale:${sizes[size].scale}`;
export function ticketViewControls(value) {
  return `<section class="ticket-view-controls" aria-label="票据展示方式"><div class="ticket-view-modes" role="group" aria-label="切换展示方式">${modes.map(([mode,label,path])=>`<button type="button" data-ticket-view="${mode}" aria-pressed="${value.mode===mode}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${path}</svg>${label}</button>`).join('')}</div><div class="ticket-size-controls" role="group" aria-label="显示大小" ${value.mode==='space' ? 'hidden' : ''}><span>${value.mode==='list' ? '列表大小' : '票面大小'}</span>${Object.entries(sizes).map(([size,{label}])=>`<button type="button" data-ticket-size="${size}" aria-pressed="${value.size===size}">${label}</button>`).join('')}</div></section>`;
}

export function ticketViewEntries(records, view) {
  if (view.mode !== 'grid') return records;
  const groups = new Map();
  for (const record of records) {
    const key = flightTicketKey(record);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const stacks = new Map(), behind = new Set();
  for (const matches of groups.values()) {
    if (matches.length < 2) continue;
    const [front, ...stackedFlights] = flightsInDepartureOrder(matches);
    stacks.set(front.id, { ...front, stackedFlights });
    for (const leg of stackedFlights) behind.add(leg.id);
  }
  return records.filter(record => !behind.has(record.id)).map(record => stacks.get(record.id) || record);
}

export const visibleTicketCount = records => records.reduce((count, record) => count + 1 + (record.stackedFlights?.length || 0), 0);

export function ticketCollection(records, value, options) {
  if (value.mode==='space') return ticketSpaceMarkup();
  const groupByDate=['newest','oldest'].includes(options.sort ?? 'newest');
  if(value.mode==='list'&&value.size==='medium')return timeline(records,options.icon,{...options,selectable:options.selectable ?? true,groupByDate});
  const list=value.mode==='list',render=list ? ticketListRow : ticketCard;
  const renderRows=rows=>`<div class="ticket-collection ${list ? 'ticket-list' : 'ticket-grid'}" data-faces-only="${!list&&value.size==='small'}" style="${ticketGridStyle(value.size)}">${rows.map(record=>render(record,options)).join('')}</div>`;
  return groupByDate ? `<section class="ticket-chronology">${ticketPeriods(records,renderRows,visibleTicketCount)}</section>` : renderRows(records);
}
export function appendTicketCollection(container, records, view, options) {
  const fragment = container.ownerDocument.createElement('template');
  fragment.innerHTML = ticketCollection(records, view, options);
  const next = fragment.content.firstElementChild;
  const current = container.firstElementChild;
  if (current.matches('.ticket-collection')) {
    current.append(...next.children);
    return;
  }
  const last = current.lastElementChild, first = next.firstElementChild;
  if (last.matches('.timeline-list')) {
    last.append(...first.children);
    return;
  }
  if (last.dataset.ticketPeriod === first.dataset.ticketPeriod) {
    const previousRows = last.lastElementChild;
    previousRows.append(...first.lastElementChild.children);
    last.dataset.ticketCount = Number(last.dataset.ticketCount) + Number(first.dataset.ticketCount);
    last.querySelector('.ticket-period-heading > span').textContent = last.dataset.ticketCount + ' 张票据';
    first.remove();
  }
  current.append(...next.children);
}
export function bindTicketViewControls(root, {value,change}) {
  const controls=root.querySelector('.ticket-view-controls');if(!controls)return;
  controls.querySelectorAll('[data-ticket-view]').forEach(button=>button.addEventListener('click',()=>change(button.dataset.ticketView)));
  controls.querySelectorAll('[data-ticket-size]').forEach(button=>button.addEventListener('click',()=>{
    value.size=button.dataset.ticketSize;
    change(value.mode);
  }));
}
