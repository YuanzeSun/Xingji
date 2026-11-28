import { escape as e } from './html.js';
import { calendarDate, dateLabel } from './journey-date.js';

export function showRelatedTickets(container, title, records, trigger, { onClose, edit = false } = {}) {
  const tickets = [...new Map(records.map(record => [record.id, record])).values()];
  if (!tickets.length || container.querySelector('.related-tickets-dialog[open]')) return;
  const doc = container.ownerDocument;
  const dialog = doc.createElement('dialog');
  dialog.className = 'modal related-tickets-dialog';
  dialog.setAttribute('aria-labelledby', 'related-tickets-title');
  tickets.sort((a, b) => calendarDate(b.departureDate).localeCompare(calendarDate(a.departureDate)) ||
    (b.departureTime || '').localeCompare(a.departureTime || ''));
  dialog.innerHTML = `<div class="modal-heading">
    <div><h2 id="related-tickets-title">${e(title)}</h2><p>${tickets.length} 张相关票据</p></div>
    <button class="button secondary small" type="button" data-close-related autofocus>关闭</button>
  </div><ul class="related-tickets-list">${tickets.map(record => `<li><button type="button" data-action="${edit ? 'edit' : 'view'}" data-id="${e(record.id)}">
      <span class="related-ticket-meta"><strong>${e(record.service || (record.type === 'rail' ? '火车票' : '机票'))}</strong>
        <span>${e(dateLabel(record.departureDate))}</span></span>
      <span class="related-ticket-route">${e(record.origin || record.originCode || '出发地')} → ${e(record.destination || record.destinationCode || '到达地')}</span>
    </button></li>`).join('')}</ul>`;
  dialog.addEventListener('click', event => {
    const ticket = event.target.closest('.related-tickets-list button');
    if (event.target === dialog || event.target.closest('[data-close-related]') || (edit && ticket && !ticket.disabled)) dialog.close();
    else ticket?.focus({ preventScroll: true });
  });
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    onClose?.();
    trigger.focus({ preventScroll: true });
  }, { once: true });
  container.append(dialog);
  dialog.showModal();
}
