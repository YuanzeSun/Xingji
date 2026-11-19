import { escape as e } from './html.js';
import { albumPages } from './album-layout.js';
import { exportTicketImages, exportTicketAlbum, ticketFileName } from './ticket-export.js';

export function exportDialog(records, { format = 'pdf' } = {}) {
  const album = format === 'pdf';
  return `<div class="batch-export">${album ? '<label class="field"><span>纪念册名称</span><input name="album-title" value="我的行迹" maxlength="30" /></label><label class="checkbox-row album-cover"><input type="checkbox" name="album-cover" checked />添加封面</label>' : ''}
    <p data-export-count>已选择 ${records.length} 张票据</p><p class="fine-print" data-album-summary></p>
    <div class="batch-progress" hidden><progress max="${records.length}" value="0" aria-label="导出进度"></progress><p role="status" aria-live="polite"></p><button class="text-button" type="button" data-export-cancel>取消导出</button></div><p class="form-error" role="alert" data-export-error hidden></p></div>
    <div class="modal-footer batch-export-footer"><button class="button primary" data-export-format="${e(format)}">${album ? '导出纪念册' : records.length === 1 ? '下载 PNG 图片' : '下载逐张图片 ZIP'}</button></div>`;
}

export function bindExportDialog(container, records, { download, images = exportTicketImages, album = exportTicketAlbum }) {
  let controller, disposed = false;
  const button = container.querySelector('[data-export-format]'), imageMode = button.dataset.exportFormat === 'zip';
  const controls = [...container.querySelectorAll('[data-export-format], [name="album-title"], [name="album-cover"]')];
  const progress = container.querySelector('.batch-progress'), status = progress.querySelector('p'), bar = progress.querySelector('progress');
  const error = container.querySelector('[data-export-error]');
  const update = () => {
    container.querySelector('[data-album-summary]').textContent = imageMode ? (records.length === 1 ? '单张高清 PNG 图片' : '每张票据生成一张高清 PNG 图片，打包为 ZIP 下载。') : `A4 竖版 · 预计 ${albumPages(records).length + Number(container.querySelector('[name="album-cover"]').checked)} 页 · 按当前排序排版`;
    button.disabled = !records.length;
  };
  const change = () => { if (!controller) { progress.hidden = true; error.hidden = true; update(); } };
  const cancel = () => controller?.abort();
  const run = async () => {
    if (controller || !records.length) return;
    const title = container.querySelector('[name="album-title"]')?.value.trim() || '我的行迹';
    controller = new AbortController(); const signal = controller.signal;
    for (const control of controls) control.disabled = true;
    error.hidden = true; progress.hidden = false; bar.max = records.length; bar.value = 0; status.textContent = '正在准备导出…';
    container.querySelector('[data-export-cancel]').hidden = false;
    try {
      const blob = await (imageMode ? images : album)(records, { title, cover:container.querySelector('[name="album-cover"]')?.checked ?? false, signal, onProgress:({completed,total,phase}) => { if (!disposed) { bar.value = completed; status.textContent = `${phase} · ${completed} / ${total}`; } } });
      signal.throwIfAborted(); if (disposed) return;
      const name = imageMode ? '行迹票面' : title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '我的行迹';
      const filename = imageMode && records.length === 1 ? ticketFileName(records[0]) + '.png'
        : `${name}_${new Date().toISOString().slice(0,10)}.${imageMode ? 'zip' : 'pdf'}`;
      const delivered = await download(blob, filename, signal);
      if (disposed) return;
      if (delivered === false) { status.textContent = '导出已取消'; return; }
      status.textContent = `已生成 ${records.length} 张票据${imageMode ? '的高清图片' : '的纪念册'}`;
    } catch (cause) {
      if (disposed) return;
      if (signal.aborted) status.textContent = '已取消导出';
      else { error.hidden = false; error.textContent = cause.message || '导出失败，请重试'; status.textContent = '导出未完成'; }
    } finally {
      controller = null;
      if (!disposed) { for (const control of controls) control.disabled = false; update(); container.querySelector('[data-export-cancel]').hidden = true; }
    }
  };
  container.addEventListener('change', change); container.querySelector('[data-export-cancel]').addEventListener('click', cancel); button.addEventListener('click', run);
  update();
  return () => { disposed = true; controller?.abort(); container.removeEventListener('change',change); container.querySelector('[data-export-cancel]').removeEventListener('click',cancel); button.removeEventListener('click',run); };
}
