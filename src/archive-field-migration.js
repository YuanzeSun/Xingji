import { dateLabel } from './journey-date.js';
import { fieldsForTransport, SCHEMA_VERSION, validateRecord, yearOf } from './model.js';
import { normalizeFieldSources } from './field-sources.js';
import { LOOKUP_FIELDS } from './lookup-values.js';
import { escape as e } from './html.js';

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);

function prepareRecord(row) {
  if (!plainObject(row)) throw new Error('票据格式无效');
  const draft = { ...row };
  if (row.type === 'flight' && !row.deleted) {
    if (row.boardingCode) {
      draft.boardingCodeSource ||= 'original';
      draft.boardingLegIndex ||= '0';
    }
    if (!row.flightStop && row.flightStops?.count === 1 && row.flightStops.airports?.length === 1 &&
        Array.isArray(row.flightStops.airports)) {
      const { fnum, date, dep, arr, airports: [airport] } = row.flightStops;
      draft.flightStop = { fnum, date, dep, arr, airport };
      if (row.fieldSources?.flightStops) draft.fieldSources = { ...row.fieldSources, flightStop: row.fieldSources.flightStops };
    }
  }
  if (plainObject(draft.fieldSources)) {
    const fields = fieldsForTransport(row.type);
    draft.fieldSources = Object.fromEntries(Object.entries(draft.fieldSources).filter(([field, source]) => {
      try { normalizeFieldSources({ [field]: source }, fields); return true; }
      catch { return false; }
    }));
  }
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
          const route = [record.origin, record.destination].filter(Boolean).join(' → ');
          change.title = record.deleted ? `已删除票据 · 第 ${count} 条` :
            [dateLabel(record.departureDate, '-'), record.service, route].filter(Boolean).join(' · ');
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

export function archiveFieldMigrationMarkup(plan, target, labels) {
  const name = path => path.split('.').map(field => Object.hasOwn(labels, field) ? labels[field] : field).join(' / ');
  const categories = [['removed', '删除'], ['added', '补齐'], ['updated', '调整']];
  const hasChanges = plan.changes.length > 0;
  const message = plan.errors.length ? '部分票据无法整理，请核对下方原因。' :
    hasChanges ? '请核对各条票据的字段变更，确认后写入主票库。' : '票库已符合当前版本。';
  return `<form data-field-migration-form>
    <div class="detail-body archive-field-migration">
      <p><strong>${e(target)}</strong> · ${plan.changes.length} 条票据有变更</p>
      <p>${message}</p>
      ${plan.changes.length ? `<ul class="migration-records">${plan.changes.map(change => `<li>
        <strong>${e(change.title)}</strong>
        <dl>${categories.filter(([key]) => change[key].length).map(([key, label]) =>
          `<div><dt>${label}</dt><dd>${e(change[key].map(name).join('、'))}</dd></div>`).join('')}</dl>
      </li>`).join('')}</ul>` : ''}
      ${plan.errors.length ? `<ul class="migration-records">${plan.errors.map(item =>
        `<li><strong>${e(item.title)}</strong><p>${e(item.message)}</p></li>`).join('')}</ul>` : ''}
      <p class="form-error" data-field-migration-error role="alert"></p>
    </div>
    <div class="modal-footer">
      <button type="button" class="button secondary" data-action="close-modal">${hasChanges && !plan.errors.length ? '取消' : '关闭'}</button>
      ${hasChanges && !plan.errors.length ? '<button type="submit" class="button primary">确认迁移</button>' : ''}
    </div>
  </form>`;
}
