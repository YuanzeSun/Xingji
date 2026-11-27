import {escape as e} from './html.js';
import {formatDate} from './model.js';
import {ticketSVG} from './tickets.js';
import {isRefundReceipt} from './record-kind.js';
import {flightCabinLabel} from './seat-classes.js';

const kind = record => isRefundReceipt(record) ? '退票费凭证' : record.type === 'rail' ? '火车票' : '机票';
const routeLabel = record => `${record.service || '票据'} ${record.origin || '出发地待补充'}至${record.destination || '到达地待补充'}`;
const serviceLabel = (record, fallback = '班次待补充') => record.service || (record.flightStatus === 'open' ? 'OPEN' : fallback);
export function ticketSelection(record, selected) {
  return `<label class="card-select"><input type="checkbox" data-archive-select="${e(record.id)}" ${selected ? 'checked' : ''} aria-label="选择 ${e(routeLabel(record))} ${e(formatDate(record.departureDate))}票据"/></label>`;
}

function ticketFace(record, { selectable, selected, depth }) {
  const layer = depth === undefined ? '' : ` ticket-stack-leg${selected ? ' is-selected' : ''}`;
  const offset = depth ? ` style="--stack-depth:${depth}"` : '';
  return `<div class="ticket-face${layer}" data-ticket-type="${record.type}"${offset}>${selectable ? ticketSelection(record,selected) : ''}<button class="ticket-preview" data-action="view" data-id="${e(record.id)}" aria-label="查看 ${e(routeLabel(record))}票据">${ticketSVG(record)}</button></div>`;
}

function ticketRoute(legs) {
  const endpoint = (name, fallback) => `<span class="route-endpoint">${e(name || fallback)}</span>`;
  return legs.map((leg, index) => {
    const previous = legs[index - 1];
    const departure = leg.originCode || leg.origin;
    const connected = previous && departure && departure === (previous.destinationCode || previous.destination);
    const origin = connected ? '' : endpoint(leg.origin, '出发地待补充');
    const separator = previous && !connected ? '<span class="route-arrow">/</span>' : '';
    return `${separator}${origin}<span class="route-arrow">→</span>${endpoint(leg.destination, '到达地待补充')}`;
  }).join('');
}

export function ticketCard(record, {icon, selectable = true, selected}) {
  const legs = [record, ...(record.stackedFlights || [])];
  const stacked = legs.length > 1;
  const services = legs.map(leg => serviceLabel(leg)).join(' / ');
  const faces = legs.map((leg, index) => ticketFace(leg, {
    selectable, selected: selected?.has(leg.id), depth: stacked ? index : undefined
  })).join('');
  const content = stacked
    ? `<div class="ticket-stack-deck" style="--stack-size:${legs.length - 1}" role="group" aria-label="联程航班，共 ${legs.length} 段">${faces}</div>`
    : faces;
  return `<article class="ticket-card${stacked ? ' ticket-stack' : selected?.has(record.id) ? ' is-selected' : ''}">
    <div class="card-top"><span class="transport-tag ${record.type}">${icon(record.type === 'rail' ? 'train' : 'plane')}${stacked ? `联程 · ${legs.length} 段` : kind(record)}</span><time>${e(formatDate(record.departureDate))}</time></div>
    <div class="card-info"><div class="card-route"><strong class="card-service">${e(services)}</strong><h2>${ticketRoute(legs)}</h2></div></div>
    ${content}</article>`;
}
export function ticketListRow(record, {icon, selectable = true, selected}) {
  const checked = selected?.has(record.id);
  const seat = [record.type === 'rail' && record.carriage ? record.carriage+'车' : '',record.seat,record.type === 'flight' ? flightCabinLabel(record.seatClass) : record.seatClass].filter(Boolean).join(' · ');
  return `<article class="ticket-card ticket-list-row${checked ? ' is-selected' : ''}">${selectable ? ticketSelection(record,checked) : ''}<button class="ticket-list-open" data-action="view" data-id="${e(record.id)}" aria-label="查看 ${e(routeLabel(record))}票据"><span class="ticket-list-date"><time>${e(formatDate(record.departureDate))}</time><small>${e(record.departureTime)}</small></span><span class="ticket-list-service"><span class="transport-tag ${record.type}" title="${kind(record)}">${icon(record.type === 'rail' ? 'train' : 'plane')}</span><strong>${e(serviceLabel(record, '待补充'))}</strong></span><span class="ticket-list-route"><span>${e(record.origin || '出发地待补充')}</span><span class="route-arrow">→</span><span>${e(record.destination || '到达地待补充')}</span></span><span class="ticket-list-person" title="${e(record.passenger)}">${e(record.passenger)}</span><span class="ticket-list-seat" title="${e(seat)}">${e(seat)}</span><span class="ticket-list-price">${record.price ? '¥'+e(record.price) : ''}</span>${icon('chevron')}</button></article>`;
}
