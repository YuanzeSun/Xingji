import {escape as e} from './html.js';
import {formatDate} from './model.js';
import {ticketSVG} from './tickets.js';
import {isRefundReceipt} from './record-kind.js';
import {flightCabinLabel} from './seat-classes.js';

const kind = record => isRefundReceipt(record) ? '退票费凭证' : record.type === 'rail' ? '火车票' : '机票';
const routeLabel = record => `${record.service || '票据'} ${record.origin || '出发地待补充'}至${record.destination || '到达地待补充'}`;
export function ticketSelection(record, selected) {
  return `<label class="card-select"><input type="checkbox" data-archive-select="${e(record.id)}" ${selected ? 'checked' : ''} aria-label="选择 ${e(routeLabel(record))} ${e(formatDate(record.departureDate))}票据"/></label>`;
}
export function ticketCard(record, {icon, selectable = true, selected = false}) {
  return `<article class="ticket-card${selected ? ' is-selected' : ''}"><div class="card-top"><span class="transport-tag ${record.type}">${icon(record.type === 'rail' ? 'train' : 'plane')}${kind(record)}</span><time>${e(formatDate(record.departureDate))}</time></div><div class="card-info"><div class="card-route"><strong class="card-service">${e(record.service || (record.flightStatus === 'open' ? 'OPEN' : '班次待补充'))}</strong><h2><span class="route-endpoint">${e(record.origin || '出发地待补充')}</span><span class="route-arrow">→</span><span class="route-endpoint">${e(record.destination || '到达地待补充')}</span></h2></div></div><div class="ticket-face" data-ticket-type="${record.type}">${selectable ? ticketSelection(record,selected) : ''}<button class="ticket-preview" data-action="view" data-id="${e(record.id)}" aria-label="查看 ${e(routeLabel(record))}票据">${ticketSVG(record)}</button></div></article>`;
}
export function ticketListRow(record, {icon, selectable = true, selected = false}) {
  const seat = [record.type === 'rail' && record.carriage ? record.carriage+'车' : '',record.seat,record.type === 'flight' ? flightCabinLabel(record.seatClass) : record.seatClass].filter(Boolean).join(' · ');
  return `<article class="ticket-card ticket-list-row${selected ? ' is-selected' : ''}">${selectable ? ticketSelection(record,selected) : ''}<button class="ticket-list-open" data-action="view" data-id="${e(record.id)}" aria-label="查看 ${e(routeLabel(record))}票据"><span class="ticket-list-date"><time>${e(formatDate(record.departureDate))}</time><small>${e(record.departureTime)}</small></span><span class="ticket-list-service"><span class="transport-tag ${record.type}" title="${kind(record)}">${icon(record.type === 'rail' ? 'train' : 'plane')}</span><strong>${e(record.service || (record.flightStatus === 'open' ? 'OPEN' : '待补充'))}</strong></span><span class="ticket-list-route"><span>${e(record.origin || '出发地待补充')}</span><span class="route-arrow">→</span><span>${e(record.destination || '到达地待补充')}</span></span><span class="ticket-list-person" title="${e(record.passenger)}">${e(record.passenger)}</span><span class="ticket-list-seat" title="${e(seat)}">${e(seat)}</span><span class="ticket-list-price">${record.price ? '¥'+e(record.price) : ''}</span>${icon('chevron')}</button></article>`;
}
