import {calendarDate} from './journey-date.js';
import { escape as e } from './html.js';
import { isRefundReceipt } from './record-kind.js';
import { flightCabinLabel } from './seat-classes.js';
import {ticketSelection} from './ticket-card.js';

const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' });
function dateParts(value) {
  if (!value) return { label: '日期未知', detail: '' };
  const [, month, day] = value.split('-');
  return { label: day ? `${month}.${day}` : month ? `${month}月` : '日期待补充', detail: day ? weekday.format(new Date(value + 'T12:00:00Z')) : '' };
}

export function ticketPeriods(records, renderRows, countTickets = rows => rows.length) {
  const groups = new Map();
  for (const record of records) {
    const period = calendarDate(record.departureDate).slice(0, 7);
    if (!groups.has(period)) groups.set(period, []);
    groups.get(period).push(record);
  }
  return [...groups].map(([period, rows]) => {
    const [year, month] = period.split('-');
    const label = month ? `${year} 年 ${Number(month)} 月` : year ? `${year} 年 · 月份未知` : '日期未知';
    const count = countTickets(rows);
    return `<section class="ticket-period" data-ticket-period="${period}" data-ticket-count="${count}"><header class="ticket-period-heading"><h2>${label}</h2><span>${count} 张票据</span></header>${renderRows(rows)}</section>`;
  }).join('');
}
export function timeline(records, icon, {selectable=false,selected=new Set(),groupByDate=true} = {}) {
  if (!records.length) return '<section class="timeline"><div class="empty-state"><h2>暂无票据</h2><p>录入票据后在这里查看。</p></div></section>';
  const renderRows = rows => `<ol class="timeline-list">${rows.map(record => {
    const calendar = calendarDate(record.departureDate);
    const date = dateParts(calendar);
    if (!groupByDate) date.detail = [calendar.slice(0, 4), date.detail].filter(Boolean).join(' · ');
    const meta = [isRefundReceipt(record) ? '退票费凭证' : record.type === 'rail' ? '火车票' : '机票', record.type === 'flight' ? flightCabinLabel(record.seatClass) : record.seatClass, record.railStanding && '无座'].filter(Boolean);
    return `<li class="timeline-ticket${selected.has(record.id) ? ' is-selected' : ''}">${selectable ? ticketSelection(record,selected.has(record.id)) : ''}<button class="timeline-item" data-action="view" data-id="${e(record.id)}"><time class="timeline-date" ${calendar ? `datetime="${calendar}"` : ''}><strong>${e(date.label)}</strong>${date.detail ? `<span>${e(date.detail)}</span>` : ''}</time><span class="timeline-dot">${icon(record.type === 'rail' ? 'train' : 'plane')}</span><span class="timeline-body"><span class="timeline-main"><strong class="timeline-service">${e(record.service || '班次待补充')}</strong><span class="timeline-route"><span>${e(record.origin || '出发地待补充')}</span><span class="timeline-arrow">→</span><span>${e(record.destination || '到达地待补充')}</span></span></span><span class="timeline-meta">${meta.map(value => `<span>${e(value)}</span>`).join('')}</span>${icon('chevron')}</span></button></li>`;
  }).join('')}</ol>`;
  return `<section class="timeline timeline-list-compact${selectable ? ' has-selection' : ''}" aria-label="票据时间列表">${groupByDate ? ticketPeriods(records, renderRows) : renderRows(records)}</section>`;
}
