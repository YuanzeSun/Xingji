import { dateLabel } from './journey-date.js';
import { fieldsForTransport, SCHEMA_VERSION, validateRecord, yearOf } from './model.js';
import { isFieldSourceEntry, normalizeFieldSources } from './field-sources.js';
import { LOOKUP_FIELDS } from './lookup-values.js';
import { escape as e } from './html.js';

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);

function prepareRecord(row) {
  if (!plainObject(row)) throw new Error('票据格式无效');
  if (row.deleted === true) return validateRecord(row);
  const draft = { ...row };
  const fields = fieldsForTransport(row.type);
  draft.fieldSources = Object.fromEntries(Object.entries(normalizeFieldSources(draft.fieldSources))
    .filter(([field, source]) => isFieldSourceEntry(field, source, fields)));
  if (plainObject(draft.lookupValues)) {
    draft.lookupValues = Object.fromEntries(Object.entries(draft.lookupValues).filter(([field]) => LOOKUP_FIELDS.includes(field)));
  }
  return validateRecord(draft);
}

function describeChanges(before, after, changes, path = '') {
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const field = path ? path + '.' + key : key;
    if (!Object.hasOwn(after, key)) changes.removed.push(field);
    else if (!Object.hasOwn(before, key)) changes.added.push(field);
    else if (plainObject(before[key]) && plainObject(after[key])) describeChanges(before[key], after[key], changes, field);
    else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes.updated.push(field);
  }
}

function archiveFiles(snapshot) {
  if (!snapshot.paths) return [{ rows: snapshot.records }];
  return snapshot.paths.map(path => {
    const file = JSON.parse(snapshot.contents[path]);
    if (file?.format !== 'xingji-archive' || file.schemaVersion !== SCHEMA_VERSION || !Array.isArray(file.records)) {
      throw new Error(`无法迁移 ${path} 的档案格式`);
    }
    return { path, rows: file.records };
  });
}

export function planArchiveFieldMigration(snapshot) {
  const records = [], changes = [], errors = [], rewritten = new Set();
  const ids = new Set();
  const files = archiveFiles(snapshot);
  if (snapshot.paths && files.reduce((sum, file) => sum + file.rows.length, 0) !== snapshot.recordCount) {
    throw new Error('云端票据数量与索引不匹配，无法迁移');
  }
  let count = 0;
  for (const { rows, path } of files) {
    for (const row of rows) {
      count++;
      if (ids.has(row?.id)) throw new Error('云端票库包含重复的票据编号，无法迁移');
      if (row?.id) ids.add(row.id);
      const change = { added: [], removed: [], updated: [] };
      try {
        const record = prepareRecord(row);
        if (path && path !== `archive/${yearOf(record)}.json`) throw new Error('票据年份与归档文件不匹配');
        describeChanges(row, record, change);
        if (change.added.length || change.removed.length || change.updated.length) {
          change.deleted = record.deleted;
          if (!record.deleted) {
            const route = [record.origin, record.destination].filter(Boolean).join(' → ');
            change.title = [dateLabel(record.departureDate, '-'), record.service, route].filter(Boolean).join(' · ');
          }
          changes.push(change);
          if (path) rewritten.add(path);
          records.push(record);
        } else records.push(row);
      } catch (error) {
        errors.push({ title: `第 ${count} 条票据`, message: error.message });
      }
    }
  }
  return { records, changes, errors, rewritten };
}

export async function writeArchiveFieldMigration(store, snapshot, plan) {
  if (plan.errors.length || !plan.changes.length) throw new Error('没有可提交的迁移');
  if (!snapshot.paths) return store.write(plan.records, snapshot, snapshot.settings);
  if (snapshot.head !== await store.head()) throw new Error('云端票库已更新，请重新预览迁移');
  const contents = Object.fromEntries(Object.entries(snapshot.contents).filter(([path]) => !plan.rewritten.has(path)));
  return store.write(plan.records, { ...snapshot, records: plan.records, contents }, snapshot.settings, 'Migrate Xingji ticket fields');
}

const changeCategories = [['removed', '删除字段'], ['added', '补充字段'], ['updated', '调整字段']];

function groupChanges(changes) {
  const groups = new Map();
  for (const change of changes) {
    const fields = changeCategories.filter(([key]) => change[key].length)
      .map(([key, label]) => [label, [...change[key]].sort()]);
    const key = JSON.stringify(fields);
    if (!groups.has(key)) groups.set(key, { fields, items: [] });
    groups.get(key).items.push(change);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

export function archiveFieldMigrationMarkup(plan, target) {
  const ticketChanges = plan.changes.filter(change => !change.deleted);
  const deletionChanges = plan.changes.filter(change => change.deleted);
  const groups = [...groupChanges(ticketChanges), ...groupChanges(deletionChanges)];
  const hasChanges = plan.changes.length > 0;
  const canApply = hasChanges && !plan.errors.length;
  const tickets = ticketChanges.length, deleted = deletionChanges.length;
  const affected = [
    tickets && `整理 ${tickets} 张票据的字段`,
    deleted && `精简 ${deleted} 条删除标记`
  ].filter(Boolean).join('，并');
  const message = plan.errors.length ? '部分票据无法迁移，请先核对下方原因。' :
    hasChanges ? '确认后应用以下变更。' : '票库已符合当前版本。';
  return `<form data-field-migration-form>
    <div class="detail-body archive-field-migration">
      <p class="migration-target">${e(target)}</p>
      ${hasChanges ? `<p><strong>将${affected}</strong></p>` : ''}
      <p>${message}</p>
      ${hasChanges ? `<ul class="migration-records">${groups.map(({ fields, items }) => `<li>
        <dl>${fields.map(([label, paths]) =>
          `<div><dt>${label}</dt><dd>${paths.map(path => `<code>${e(path)}</code>`).join('、')}</dd></div>`).join('')}</dl>
        ${items[0].deleted ? `<p class="migration-deleted">涉及 ${items.length} 条删除标记</p>` :
          `<details open><summary>涉及 ${items.length} 张票据</summary>
            <ul class="migration-ticket-list">${items.map(({ title }) => `<li>${e(title)}</li>`).join('')}</ul></details>`}
      </li>`).join('')}</ul>` : ''}
      ${plan.errors.length ? `<ul class="migration-records">${plan.errors.map(item =>
        `<li><strong>${e(item.title)}</strong><p>${e(item.message)}</p></li>`).join('')}</ul>` : ''}
      <p class="form-error" data-field-migration-error role="alert"></p>
    </div>
    <div class="modal-footer">
      <button type="button" class="button secondary" data-action="close-modal">${canApply ? '取消' : '关闭'}</button>
      ${canApply ? '<button type="submit" class="button primary">应用字段变更</button>' : ''}
    </div>
  </form>`;
}
