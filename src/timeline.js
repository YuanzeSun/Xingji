import {calendarDate} from './journey-date.js';
import { escape as e } from './html.js';
import { isRefundReceipt } from './record-kind.js';
import { flightCabinLabel } from './seat-classes.js';
import {ticketSelection} from './ticket-card.js';

const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' });
function dateParts(value) {
  value=calendarDate(value);
  if (!value) return { label: '日期未知', detail: '' };
  const [, month, day] = value.split('-');
  return { label: day ? `${month}.${day}` : month ? `${month}月` : '日期待补充', detail: day ? weekday.format(new Date(value + 'T12:00:00Z')) : '' };
}

export function groupTicketsByYear(records) {
  const groups = new Map();
  for (const record of records) {
    const year = calendarDate(record.departureDate).slice(0, 4) || '日期未知';
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(record);
  }
  return groups;
}
export const ticketYearHeading=(year,count)=>`<header class="timeline-year-heading"><h2>${e(year)}</h2><span>${count} 张票据</span></header>`;
export function timeline(records, icon, {selectable=false,selected=new Set(),groupYears=true} = {}) {
  if (!records.length) return '<section class="timeline"><div class="empty-state"><h2>暂无票据</h2><p>录入票据后在这里查看。</p></div></section>';
  const groups=groupYears ? groupTicketsByYear(records) : new Map([['',records]]);
  return `<section class="timeline timeline-list-compact${selectable ? ' has-selection' : ''}" aria-label="票据时间列表">${[...groups].map(([year, rows]) => `<section class="timeline-year-group">${year ? ticketYearHeading(year,rows.length) : ''}<ol class="timeline-list">${rows.map(record => {
    const date = dateParts(record.departureDate);
    if(!groupYears)date.detail=[calendarDate(record.departureDate).slice(0,4),date.detail].filter(Boolean).join(' · ');
    const meta = [isRefundReceipt(record) ? '退票费凭证' : record.type === 'rail' ? '火车票' : '机票', record.type === 'flight' ? flightCabinLabel(record.seatClass) : record.seatClass, record.railStanding && '无座'].filter(Boolean);
    return `<li class="timeline-ticket${selected.has(record.id) ? ' is-selected' : ''}">${selectable ? ticketSelection(record,selected.has(record.id)) : ''}<button class="timeline-item" data-action="view" data-id="${e(record.id)}"><time class="timeline-date" ${calendarDate(record.departureDate) ? `datetime="${e(calendarDate(record.departureDate))}"` : ''}><strong>${e(date.label)}</strong>${date.detail ? `<span>${e(date.detail)}</span>` : ''}</time><span class="timeline-dot">${icon(record.type === 'rail' ? 'train' : 'plane')}</span><span class="timeline-body"><span class="timeline-main"><strong class="timeline-service">${e(record.service || '班次待补充')}</strong><span class="timeline-route"><span>${e(record.origin || '出发地待补充')}</span><span class="timeline-arrow">→</span><span>${e(record.destination || '到达地待补充')}</span></span></span><span class="timeline-meta">${meta.map(value => `<span>${e(value)}</span>`).join('')}</span>${icon('chevron')}</span></button></li>`;
  }).join('')}</ol></section>`).join('')}</section>`;
}
