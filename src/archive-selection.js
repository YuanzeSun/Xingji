export function reconcileSelection(selected, records) {
  const available = new Set(records.map(record => record.id));
  for (const id of selected) if (!available.has(id)) selected.delete(id);
  return records.filter(record => selected.has(record.id));
}

export function archiveSelectionMarkup(result, selected, { canDelete = false } = {}) {
  const count = reconcileSelection(selected, result.error ? [] : result.records).length;
  return `<div class="archive-selection-bar" role="region" aria-label="票据批量操作"><label class="archive-select-all"><input type="checkbox" data-archive-select-all aria-label="全选当前筛选结果" ${!result.records.length || result.error ? 'disabled' : ''} ${count && count === result.records.length ? 'checked' : ''}/>全选</label><span class="archive-selection-count" role="status" aria-live="polite">已选 ${count} 张</span>${count ? `<div class="archive-selection-actions"><button class="button small secondary" data-action="export-album">导出纪念册</button><button class="button small secondary" data-action="export-images">逐个导出</button><button class="button small secondary danger" data-action="delete-selected" ${canDelete ? '' : 'disabled'}>删除</button><button type="button" class="button small secondary" data-action="finish-selection">完成</button></div>` : ''}</div>`;
}
