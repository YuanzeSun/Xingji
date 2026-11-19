import { createImportFlow } from './import-flow.js';
import {BOARDING_METADATA_LABELS,BOARDING_METADATA_FIELDS} from './boarding-metadata.js';
import {boardingJourneyMarkup} from './boarding-details.js';
import {calendarDate,daysInYear,JOURNEY_DATE_FIELDS} from './journey-date.js';
import {barcodeFieldLocked,refreshBarcodeFieldLocks} from './barcode-fields.js';
import {ACTUAL_FLIGHT_FIELDS} from './flight-times.js';
import {barcodeRequiredMark,boardingGeneratorMarkup,readBoardingGenerator,refreshBoardingPassenger} from './boarding-code-generator.js';
import {fieldSourceBadge,markFieldSources,refreshFieldSources} from './field-sources.js';
import {readBoardingCode} from './bcbp.js';
import {flightPassengerName} from './flight-passenger.js';
import { bindIdentityInput, hasMaskedIdentity } from './identity.js';
import {markManualFields,applyLookupValues,lookupContext,clearLookupValues} from './lookup-values.js';
import { createArithmeticChallenge, arithmeticField, checkArithmeticAnswer } from './arithmetic-confirm.js';
import { archiveSelectionMarkup, reconcileSelection } from './archive-selection.js';
import { upgradeCodeRecords } from './code-upgrade.js';
import { renderCodeData } from './barcode-data.js';
import { createRecord, validateRecord, mergeThreeWay, TEMPLATES, DEFAULT_RAIL_TEMPLATE, FIELDS, now, clone, readArchive, formatDate } from './model.js';
import * as db from './db.js';
import { readSyncState, readResetState, activeBinding, sameArchiveBaseline, activateD1, bindRepository, signOutCloud, keepUnlinkedArchive, saveArchiveResetProgress, stageImport, stageRecords, stageSettings, rejectPendingChange, discardRejectedChange, acknowledgeSync, replaceWithRemote } from './sync-state.js';
import { sharedSettings, sameSettings, maskedKey, wasUnlinked } from './shared-settings.js';
import { watchAppUpdates } from './app-update.js';
import { supportsDesktopMcp } from './device.js';
import { archiveResetMarkup, prepareArchiveReset, createPairedReset, matchesResetPair, continuePairedReset } from './archive-reset.js';
import { ArchiveResetError, GitHubStore, synchronize } from './github.js';
import { D1Store, workerURL } from './d1.js';
import { fullBackup, readFullBackup } from './archive-backup.js';
import { bindArchivePair, backUpToGitHub, assertLinkTargets, hasCloudLink, pairedD1, pairedGitHub, publishCloudLink, sameGitHubAccount } from './archive-migration.js';
import { parseText, decodeMail, mapFlightResult, extractPDF } from './importers.js';
import { ticketSVG, exportSVG, exportPNG } from './tickets.js';
import { ticketDetails } from './ticket-details.js';
import { escape as e } from './html.js';
import { demoRecords } from './demo.js';
import { MARK_SHAPES, describeMarks } from './ticket-marks.js';
import { ticketCodeEditor, bindTicketCodeEditor } from './code-editor.js';
import {ticketViewOptions,ticketViewControls,ticketCollection, appendTicketCollection,bindTicketViewControls} from './ticket-view.js';
import {mountTicketSpace} from './ticket-space.js';
import { requiredTicketFields, missingTicketFields, ticketFieldLabel, validateTicketForm, ticketFormFeedback } from './ticket-form.js';
import { seatClassField, bindSeatClassFields } from './seat-class-field.js';
import { seatField, bindSeatFields } from './seat-field.js';
import { bindDatePickers,ticketDateField,bindTicketDates,readTicketDate,writeTicketDate,barcodeDateDay } from './date-field.js';
import { flightLookupMarkup, bindFlightLookup } from './flight-lookup.js';
import { railLookupMarkup, bindRailLookup, railTrainsetField } from './rail-lookup.js';
import { railJourneyMarkup, bindRailJourney } from './rail-journey-ui.js';
import { railJourneyMatches } from './rail-journey.js';
import { scannerMarkup, mountScanner } from './scanner.js';
import { parseScanText } from './scan-engine.js';
import { normalizePlaces, resolvePlace } from './places.js';
import { bindReferenceFields } from './reference-suggestions.js';
import { bindAirportPicker } from './airport-picker.js';
import { bindStationPicker } from './station-picker.js';
import { FLIGHT_STATUSES, normalizeFlightStatus } from './flight-status.js';
import { isRefundReceipt, isJourneyRecord } from './record-kind.js';
import { bindUppercaseNames } from './name-case.js';
import { personalProfile, applyProfileDefaults } from './personal-profile.js';
import { personalProfilePanel, collectPersonalProfile, bindPersonalProfileForm, personalProfileSummary } from './personal-profile-form.js';
import { cityOverview } from './locations.js';
import { DEFAULT_SEARCH, searchOptions, searchTickets, clearSearchField } from './search.js';
import { searchPanel, searchChips, resultSummary, cityContextHTML } from './search-panel.js';

const sameField = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const icons = {
  ticket: '<path d="M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4z"/><path d="M15 5v2m0 3v2m0 3v2m0 1v1"/>',
  train: '<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M12 3v8M8 22l2-3m6 3-2-3M8 15h1m6 0h1"/>',
  plane: '<path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  cloud: '<path d="M6 17a4 4 0 1 1 1-8 6 6 0 0 1 11-2 5 5 0 0 1 0 10M9 17l3-3 3 3m-3-3v8"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
  camera: '<path d="M8 5 10 2h4l2 3h5v16H3V5z"/><circle cx="12" cy="13" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-7 5 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/>',
  trash: '<path d="M3 6h18M8 6V3h8v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16m6-14v16"/>',
  chart: '<path d="M4 3v17h17M7 14l4-5 4 3 5-7"/>'
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.ticket}</svg>`;
const labels = { ...BOARDING_METADATA_LABELS, railPlatform:'上车站台', type: '交通方式', template: '票面样式', origin: '出发站 / 机场', destination: '到达站 / 机场', originCity: '出发城市', destinationCity: '到达城市', originCode: '出发站拼音 / 机场码', destinationCode: '到达站拼音 / 机场码', service: '车次 / 航班号', departureDate: '出发日期', departureTime: '出发时间', arrivalDate: '到达日期', arrivalTime: '到达时间', departureZone: '出发地时区', arrivalZone: '到达地时区', passenger: '旅客姓名', identity: '证件号（身份证 / 护照）', carriage: '车厢', seat: '座位 / 铺位', seatClass: '席别 / 舱位', price: '票价（元）', orderNumber: '订单号', ticketNumber: '票号', saleCode: '底部售票码', issuer: '售票站', gate: '检票口 / 登机口', terminal: '航站楼', boardingTime: '登机时间', airline: '航空公司', flightStatus: '机票状态', aircraft: '机型', railBureau: '担当路局', railModel: '车型', railTrainsets:'车组编号', railPowerSupply:'供电制式', railMileage:'铁路里程（km）', flightDistance:'航程距离（km）', railRunner: '担当客运段', railCarOwner: '车辆归属单位', railJourney: '铁路行程资料', aircraftRegistration: '飞机编号', pnr: '订座编号 PNR', provenance: '票面性质', offsetX: '横向微调', offsetY: '纵向微调', deleted: '删除状态', ticketMarks: '票面标识', ticketCode: '二维码', boardingCode: '机票条码' };
const imports = createImportFlow();
let importView = 0;
const state = { records: [], base: [], settings: sharedSettings(), settingsBase: sharedSettings(), flightKeyDraft: null, settingsError: '', page: 'archive', profileDraft: null, profileBase: null, profileDirty: false, profileError: '', filters: searchOptions(), filterOpen: false, routesOpen: false, mapView: { layers: ['airway', 'railway'], year: 'all' }, limit: 48, showDemo: false, config: null, syncMeta: { verified: false, pending: false, head: '', revision: 0 }, connectionStatus: 'checking', saving: false, syncing: false, lastSync: null, syncMessage: '', resetRequest: null, resetting: false, flightYear: String(new Date().getFullYear()), flightResultYear: null, flightResult: null };
const samples = demoRecords();
const ticketView=ticketViewOptions();
const archiveIsSpace=()=>ticketView.mode==='space';
let ticketSpaceCleanup=null;
let mapCleanup = null, mapEpoch = 0;
let statisticsCleanup = null;
let flightLookupCleanup = null, railLookupCleanup = null;
const statisticsView = {};
let railRouteCleanup = null, railJourneyCleanup = null;
let codeCleanup = null, scannerCleanup = null, exportCleanup = null, searchTimer, renderedRecords = '', renderedSettings = '', renderedWritable, composing = false, deferredRender = false;
let editor = null, syncTimer, syncPromise, syncAbort, authEpoch = 0, syncFailures = 0, localFileURL = null, installPrompt, modalFocus;
const root = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const live = () => (state.showDemo ? samples : state.records).filter(r => !r.deleted);
async function setDemoMode(enabled) {
  if (enabled === state.showDemo) return;
  importView++;
  if (enabled && (imports.review !== 'closed' || modalRoot.querySelector('[data-backup-restore]')) && !closeModal()) return;
  archiveSelected.clear();
  await db.set('showDemo', enabled);
  state.showDemo = enabled;
}
let credentials = { github: '', d1: '' };
let backupRestoreOffer = null, githubBackupReceipt = null;
const token = () => credentials.github;
const d1Token = () => credentials.d1;
const cloudToken = () => state.d1 ? d1Token() : token();
const hasCloud = () => !!(state.d1?.id || state.config?.id);
const withCloudLock = action => navigator.locks?.request ? navigator.locks.request('xingji-archive-connection', action) : action();
const flightKey = () => state.settings.flightMcpKey;
function toast(message, error = false) {
  const target = document.querySelector('#toast-root');
  if (!target) return;
  const el = document.createElement('div'); el.className = `toast ${error ? 'error' : ''}`; el.setAttribute('role', error ? 'alert' : 'status'); el.innerHTML = icon(error ? 'info' : 'check') + `<span>${e(message)}</span>`;
  target.append(el); setTimeout(() => el.remove(), error ? 8000 : 4200);
}
function fail(error) { console.error(error?.message || error); toast(error?.message || '操作未完成，请重试', true); }
function download(data, name, type = 'application/json;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function fileName(r) { return `${calendarDate(r.departureDate) || '未定日期'}_${r.service || '票据'}_${r.origin}-${r.destination}`.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'); }
const channel = window.BroadcastChannel ? new window.BroadcastChannel('xingji-cloud-state') : null;
const canWrite = () => !!(!state.showDemo && !state.resetting && !state.archiveResetProgress && hasCloud() &&
  state.syncMeta.verified && cloudToken() && navigator.onLine && !state.connecting &&
  (state.syncMeta.pending ? state.syncMeta.rejection && state.connectionStatus === 'rejected' && !state.syncing
    : state.connectionStatus === 'online'));

function useSnapshot(snapshot) {
  const context = archiveContext();
  if (snapshot.credentials) {
    credentials = snapshot.credentials;
    githubBackupReceipt = snapshot.githubBackupReceipt;
  }
  state.records = snapshot.records; state.base = snapshot.base; state.settings = snapshot.settings; state.settingsBase = snapshot.settingsBase; state.config = snapshot.config; state.d1 = snapshot.d1; state.syncMeta = snapshot.meta; state.lastSync = snapshot.lastSync;
  const resetStarted = !state.archiveResetProgress && snapshot.archiveResetProgress;
  state.archiveResetProgress = snapshot.archiveResetProgress;
  if (resetStarted) invalidateCloudSession();
  if (!isArchiveContext(context)) clearImportedWork();
  if (backupRestoreOffer && (!isArchiveContext(backupRestoreOffer) ||
      (!state.syncMeta.pending && !missingBackupConnection(backupRestoreOffer.connections)))) backupRestoreOffer = null;
}
const announce = (changes = {}) => channel?.postMessage(changes);
function freezeForm(form, pendingLabel) {
  const button = form.querySelector('[type="submit"]'), originalLabel = button?.innerHTML;
  if (pendingLabel) {
    form.dataset.pending = 'true'; form.setAttribute('aria-busy', 'true');
    if (button) button.innerHTML = icon('refresh', 'spin') + pendingLabel;
  }
  const controls = [...form.querySelectorAll('input,select,textarea,button')].map(input => [input, input.disabled]);
  controls.forEach(([input]) => { input.disabled = true; });
  return () => {
    controls.forEach(([input, disabled]) => {
      input.disabled = disabled;
      if (input.hasAttribute('data-readonly-disabled')) input.dataset.readonlyDisabled = String(disabled);
    });
    if (pendingLabel) {
      delete form.dataset.pending; form.removeAttribute('aria-busy');
      if (button) button.innerHTML = originalLabel;
    }
  };
}

async function verifyBeforeWrite(message) {
  if (state.syncMeta.rejection && canWrite()) return;
  if (!await doSync() || !canWrite()) throw new Error(message);
}
async function persist(records, { candidates = false, settings } = {}) {
  if (!canWrite() || state.saving) throw new Error('当前不能修改票据，请先完成云端核对');
  const expected = { records: clone(state.records), settings: clone(state.settings) };
  const { config, d1 } = state;
  const context = archiveContext();
  state.saving = true;
  try {
    await verifyBeforeWrite('云端尚未核对成功，修改未提交，请保留当前输入');
    if (!isArchiveContext(context)) throw new Error('票库已变化，请重新打开后核对。');
    const staged = await withCloudLock(() => candidates
      ? stageImport(records, config, d1, expected.settings, settings)
      : stageRecords(expected.records, records, config, d1));
    useSnapshot(staged);
    announce();
    await doSync();
    return staged;
  } finally { state.saving = false; render(); }
}
function savedMessage(message = '票据已同步') {
  if (state.syncMeta.rejection) return '本机修改已保留，云端拒绝了这次提交';
  return state.syncMeta.pending ? '已保存本机，等待云端确认' : message;
}
function queueSync(delay) {
  clearTimeout(syncTimer);
  if (state.resetting || state.archiveResetProgress || !state.syncMeta.pending || state.syncMeta.rejection || !cloudToken() || document.visibilityState === 'hidden') return;
  syncTimer = setTimeout(() => doSync(), delay);
  syncTimer.unref?.();
}
function syncLabel() {
  if (!hasCloud()) return '需要连接云端';
  if (state.archiveResetProgress) return '等待继续重置 · 只读';
  if (state.syncing) return '正在核对云端…';
  if (state.connectionStatus === 'conflict') return '有冲突待处理 · 只读';
  if (state.syncMeta.rejection) return '云端拒绝提交';
  if (state.syncMeta.pending) return '等待云端同步 · 只读';
  return canWrite() ? '已同步' : '缓存只读';
}
const bothClouds = () => !!(state.config?.id && state.d1?.id);
const firstBindingHelp = '首次绑定时，选择保留哪边的票库，并覆盖另一边。绑定后由 D1 日常同步，GitHub 可手动备份。';
function connectionForm() {
  const draft = state.connectionDraft, config = state.config || draft || {}, bound = !!state.config?.id;
  if (token()) {
    const exit = bothClouds() ? '' : '<div class="button-row"><button class="text-button" type="button" data-action="disconnect">退出 GitHub</button></div>';
    return `<p class="body-copy">${e(config.owner)}/${e(config.repo)}</p>${exit}`;
  }
  const label = bound ? '重新登录 GitHub' : state.d1 ? '绑定为备份仓库' : '连接并同步';
  return `<form id="github-form"><div class="form-grid"><label class="field"><span>GitHub用户名</span><input name="owner" value="${e(config.owner)}" ${bound ? 'readonly' : ''} required autocomplete="off" /></label><label class="field"><span>私有仓库名</span><input name="repo" value="${e(config.repo)}" ${bound ? 'readonly' : ''} required autocomplete="off" /></label></div><label class="field"><span>访问凭证</span><input type="password" name="token" value="${e(draft?.token ?? token())}" autocomplete="off" required /></label><div class="button-row"><button class="button primary" type="submit" ${state.syncing || state.connecting ? 'disabled' : ''}>${label}</button></div></form><div class="setup-help">${state.d1 && !bound ? `<p>${firstBindingHelp}</p>` : ''}<p>创建 GitHub 私有仓库并勾选添加 README。创建细粒度访问凭证时，仅授权该仓库，并将 Contents 设为 Read and write。</p><p><a href="https://github.com/new" target="_blank" rel="noopener noreferrer">创建私有仓库 ↗</a><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">创建访问凭证 ↗</a></p></div>`;
}
function captureConnectionDraft(form) {
  state.connectionDraft = { ...state.connectionDraft, owner: form.elements.owner.value, repo: form.elements.repo.value, token: form.elements.token.value };
}
function d1ConnectionPanel() {
  const draft = state.d1Draft, bound = !!state.d1;
  const help = bothClouds()
    ? '两边绑定后，新增和修改都保存到 D1。点击「立即备份到 GitHub」才会用 D1 的当前数据更新 GitHub。换设备时，登录任一账号都会打开同一份 D1 票库。'
    : !bound && state.config ? firstBindingHelp
    : !bound ? '部署行迹 Worker 后，填写 Worker 地址和访问凭证。' : '';
  const exit = bothClouds() ? '' : '<div class="button-row"><button class="text-button" type="button" data-action="disconnect-d1">退出 D1</button></div>';
  const controls = d1Token()
    ? `<p class="body-copy">${e(state.d1?.url)}</p>${exit}`
    : `<form id="d1-form"><label class="field"><span>Worker 地址</span><input type="url" name="url" placeholder="https://your-archive.workers.dev" value="${e(state.d1?.url ?? draft?.url)}" ${bound ? 'readonly' : ''} required autocomplete="off" /></label><label class="field"><span>访问凭证</span><input type="password" name="token" value="${e(draft?.token)}" required autocomplete="off" /></label><p class="form-error" role="alert">${e(state.d1Error)}</p><div class="button-row"><button class="button primary" type="submit" ${state.syncing || state.connecting ? 'disabled' : ''}>${bound ? '重新登录 D1' : '连接 D1'}</button></div></form>`;
  return `<section class="panel"><div class="panel-heading"><span class="panel-icon">${icon('database')}</span><div><h2>Cloudflare D1</h2><p data-d1-cloud-label>${bound ? e(syncLabel()) : '可作为主票库'}</p></div></div>${controls}<div class="setup-help">${help ? `<p>${help}</p>` : ''}<p><a href="https://github.com/YuanzeSun/Xingji/blob/main/docs/cloudflare-d1.md" target="_blank" rel="noopener noreferrer">D1 部署 ↗</a></p></div></section>`;
}
function githubBackupPair(d1, config) {
  return JSON.stringify([activeBinding({ d1 }), config.id, config.branch]);
}
function githubBackupLabel() {
  const receipt = githubBackupReceipt;
  if (!receipt || !state.d1 || !state.config || receipt.pair !== githubBackupPair(state.d1, state.config) ||
      receipt.generation !== (state.syncMeta.generation || '')) return '';
  const date = new Date(receipt.at).toLocaleString('zh-CN', { hour12: false });
  const updatedSinceBackup = state.lastSync > receipt.at && receipt.head !== state.syncMeta.head;
  return '本机上次确认备份 · ' + date + (updatedSinceBackup ? ' · D1 已更新，可再次备份' : '');
}
function githubExtras() {
  if (!state.d1 || !state.config) return '';
  return `<p data-github-backup-status class="import-status" role="status">${e(githubBackupLabel())}</p><div class="button-row"><button class="button secondary" data-action="backup-github" ${!canWrite() || state.syncMeta.pending || !token() || state.saving || state.githubBackingUp ? 'disabled' : ''}>${state.githubBackingUp ? '正在备份…' : '立即备份到 GitHub'}</button></div>`;
}
function cloudActions() {
  if (!hasCloud()) return '';
  const exit = bothClouds() ? '<button class="button danger" type="button" data-action="disconnect-all">退出登录</button>' : '';
  const help = exit ? '<p class="import-status">退出登录会同时退出两个账号并清除本机缓存，云端票据和关联仍会保留。要分开使用，请在「重置仓库」勾选「同时解除关联」。这会清空两边的票据，并让你选择本机继续使用哪边。</p>' : '';
  return `<div class="button-row">${exit}<button class="button danger" data-action="reset-repository">${state.archiveResetProgress ? '继续重置' : '重置仓库'}</button></div>${help}`;
}
function authorCredit(className) {
  return `<span class="author-credit ${className}"><a href="https://github.com/YuanzeSun" target="_blank" rel="noopener noreferrer">by @YuanzeSun</a></span>`;
}
function pageFooter(lead = '<span>行迹</span>') {
  return `<footer class="page-footer">${lead}${authorCredit('footer-credit')}</footer>`;
}
function demoToggle() {
  return `<label class="demo-toggle"><input type="checkbox" role="switch" id="demo-toggle" ${state.showDemo ? 'checked' : ''} />示例模式</label>`;
}
function guestDemoNotice() {
  if(!state.showDemo || (hasCloud() && state.syncMeta.verified))return '';
  return `<section class="guest-demo-notice" aria-label="示例模式提示"><div>${icon('info')}<p>正在体验<strong>示例模式</strong>，登录后即可开始记录自己的旅程。</p></div><button type="button" class="button primary" data-action="exit-demo">退出示例并登录${icon('arrow')}</button></section>`;
}
function connectionPage() {
  return `<main class="cloud-setup"><div class="cloud-setup-brand">${icon('ticket')} 行迹</div><section class="guest-demo-entry" aria-labelledby="guest-demo-title"><div class="guest-demo-heading">${icon('ticket')}<strong id="guest-demo-title">体验示例模式</strong></div><p>直接浏览示例票据与行程。</p><button type="button" class="button primary" data-action="enter-demo">进入示例模式${icon('arrow')}</button></section>${d1ConnectionPanel()}<section class="panel"><h1>连接 GitHub</h1><p class="cloud-setup-description">GitHub 和 D1 都可单独使用。若两个账号已绑定，登录任一账号即可恢复两个连接，并从 D1 读取主票库。</p>${connectionForm()}<p class="form-error" role="alert">${e(state.githubError || (!state.d1 && state.syncMessage) || '')}</p>${githubExtras()}${state.records.some(r => !r.deleted) ? '<button class="text-button" data-action="backup">导出本机票据</button>' : ''}</section>${cloudActions()}${pageFooter()}</main>`;
}
function connectionNotice() {
  if (!state.showDemo && state.archiveResetProgress) return '<div class="connection-notice" role="status"><div><strong>上次仓库重置尚未完成</strong></div><button class="button secondary small" data-action="resume-archive-reset">继续重置</button></div>';
  if (state.showDemo || canWrite() && !state.syncMeta.pending) return '';
  if (state.syncMeta.rejection && !state.d1Replacement && !state.resetRequest && state.connectionStatus !== 'conflict') {
    const disabled = state.syncing || state.saving ? 'disabled' : '';
    return `<div class="connection-notice rejected-change" role="status"><div><strong>云端拒绝了这次提交</strong>
    <span>${e(state.syncMeta.rejection)}</span><span>本机已保留修改，可修正后保存，或撤回待同步修改。</span></div>
    <div class="button-row"><button class="button secondary small" data-action="backup">导出当前备份</button>
    <button class="button secondary small" data-action="discard-rejected-change" ${disabled}>撤回待同步修改</button>
    <button class="button secondary small" data-action="sync" ${disabled}>重试同步</button></div></div>`;
  }
  const label = state.connectionStatus === 'conflict' ? '云端与本机有修改需要选择' : state.syncMeta.pending ? '本机修改等待云端确认，当前仅可查看缓存' : state.syncing ? '正在核对云端，当前仅可查看缓存' : '当前仅可查看本地缓存';
  const time = state.lastSync ? '上次同步：' + new Date(state.lastSync).toLocaleString('zh-CN', { hour12: false }) : '';
  const reset = state.d1Replacement ? '<button class="button danger small" data-action="adopt-d1">采用 D1 新票库</button>' : state.resetRequest ? '<button class="button danger small" data-action="reset-archive">重置票库</button>' : '';
  return `<div class="connection-notice" role="status"><div><strong>${label}</strong>${time ? `<span>${e(time)}</span>` : ''}${state.syncMessage ? `<span>${e(state.syncMessage)}</span>` : ''}</div>${reset}<button class="button secondary small" data-action="${state.connectionStatus === 'conflict' ? 'review-conflicts' : 'sync'}">${state.connectionStatus === 'conflict' ? '处理冲突' : '重新连接'}</button></div>`;
}
function applyAccessPolicy() {
  for (const button of document.querySelectorAll('[data-action="new"],[data-action="edit"],[data-action="delete"],[data-action="scan-ticket"]')) button.disabled = !canWrite() || state.saving || state.showDemo;
  for (const button of document.querySelectorAll('[data-action="import-json"]')) button.disabled = !canWrite() || state.saving || !!imports.task;
  const batchDelete = document.querySelector('[data-action="delete-selected"]'); if (batchDelete) batchDelete.disabled = !canWrite() || state.saving || state.showDemo;
  for (const input of document.querySelectorAll('[data-setting-control]')) input.disabled = !canWrite() || state.saving;
  const refresh = document.querySelector('[data-action="flight-refresh"]'); if (refresh) refresh.disabled = !flightKey() || imports.task?.kind === 'flight' || !navigator.onLine || (state.flightKeyDraft !== null && state.flightKeyDraft.trim() !== flightKey());
  const flightYear = document.querySelector('#flight-year'); if (flightYear) flightYear.disabled = imports.task?.kind === 'flight';
  if (!canWrite() && scannerCleanup) closeModal(true);
  const saveReview = modalRoot.querySelector('[data-candidate-review] [type="submit"]');
  if (saveReview) saveReview.disabled = !canWrite() || state.saving || !checkedCandidateIndices(saveReview.form).length;
  const form = document.querySelector('#editor-form');
  if (form) for (const input of form.querySelectorAll('input,select,textarea,button:not([data-action="close-modal"])')) {
    if (!canWrite()) { if (!input.hasAttribute('data-readonly-disabled')) input.dataset.readonlyDisabled = String(input.disabled); input.disabled = true; }
    else if (input.hasAttribute('data-readonly-disabled')) { input.disabled = input.dataset.readonlyDisabled === 'true'; delete input.dataset.readonlyDisabled; }
  }
}
function nav() {
  const items = [['archive', 'ticket', '我的票据'], ['map', 'map', '行程地图'], ['statistics', 'chart', '数据统计'], ['import', 'upload', '录入票据'], ['data', 'database', '数据与同步']].filter(([id])=>!state.showDemo || !['import','data'].includes(id));
  const count=live().length;
  return `<aside class="sidebar"><a class="brand" href="#archive" aria-label="行迹首页"><span class="brand-symbol">${icon('ticket')}</span><span class="brand-name">行迹<small>TICKET ARCHIVE</small></span></a><div class="nav-label">票据存档</div><nav aria-label="主要导航">${items.map(([id, i, text]) => `<button aria-label="${text}${id === 'archive' ? ' ' + count : ''}" data-action="navigate" data-page="${id}" class="nav-item ${state.page === id ? 'active' : ''}" ${state.page === id ? 'aria-current="page"' : ''}>${icon(i)}<span class="nav-desktop-text">${text}</span><span class="nav-mobile-text" aria-hidden="true">${({archive:'票夹',map:'地图',statistics:'统计',import:'录入',data:'同步'})[id]}</span>${id === 'archive' ? `<span class="nav-count">${count}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="private-note">${state.showDemo ? '' : icon('lock')+'<span>'+(state.d1?'D1':'GitHub')+' 云同步</span>'}</div>${authorCredit('sidebar-credit')}</div></aside>`;
}
function header(title, subtitle, actions = '') {
  const syncButton=className=>state.showDemo ? '' : `<button class="sync-button ${className}" data-action="sync" title="${e(syncLabel())}">${icon(state.syncing ? 'refresh' : 'cloud', state.syncing ? 'spin' : '')}<span>${e(syncLabel())}</span></button>`;
  return `<div class="mobile-brand"><a href="#archive">${icon('ticket')} 行迹</a>${syncButton('')}</div><header class="page-header"><div><h1>${title}</h1>${subtitle ? '<p class="subtitle">' + subtitle + '</p>' : ''}</div><div class="header-actions">${syncButton('desktop-sync')}${demoToggle()}${actions}</div></header>`;
}
const archiveSelected = new Set();
function selectedArchiveRecords() {
  const result = searchTickets(live(), state.filters);
  return reconcileSelection(archiveSelected, result.error ? [] : result.records);
}
function refreshArchiveSelection(result = searchTickets(live(), state.filters)) {
  const container = document.querySelector('#archive-selection');
  if (!container) return;
  if(archiveIsSpace()){container.replaceChildren();return;}
  container.innerHTML = archiveSelectionMarkup(result, archiveSelected, { canDelete:canWrite() && !state.showDemo && !state.saving });
  const all = container.querySelector('[data-archive-select-all]');
  all.indeterminate = archiveSelected.size > 0 && archiveSelected.size < result.records.length;
  for (const input of document.querySelectorAll('[data-archive-select]')) {
    input.checked = archiveSelected.has(input.dataset.archiveSelect);
    input.closest('.ticket-card,.timeline-ticket').classList.toggle('is-selected', input.checked);
  }
}
function exportScope() {
  return { context: archiveContext(), view: importView, demo: state.showDemo };
}
async function currentExport(scope) {
  const sameView = () => root.isConnected && scope.view === importView && scope.demo === state.showDemo;
  return sameView() && (scope.demo || await currentArchive(scope.context)) && sameView();
}
async function exportArchiveSelection(format) {
  const scope = exportScope();
  const records = clone(selectedArchiveRecords());
  if (!records.length) return;
  const { exportDialog, bindExportDialog } = await import('./export-dialog.js');
  if (!await currentExport(scope) || modalRoot.querySelector('dialog')) return;
  openModal(modalHead(format === 'pdf' ? '导出纪念册' : '逐个导出', '已选择 ' + records.length + ' 张票据') + exportDialog(records, { format }));
  const dialog = modalRoot.querySelector('dialog');
  exportCleanup = bindExportDialog(dialog, records, { async download(data, name, signal) {
    if (!await currentExport(scope) || !dialog.isConnected || signal?.aborted) return false;
    download(data, name);
    return true;
  } });
}
async function exportSingleTicket(button, format) {
  const scope = exportScope(), record = findRecord(button.dataset.id);
  if (!record) return;
  button.disabled = true;
  toast(format === 'svg' ? '正在准备包含字体的票面…' : '正在生成高清票面…');
  try {
    const data = await (format === 'svg' ? exportSVG(record) : exportPNG(record));
    if (await currentExport(scope) && button.isConnected) {
      download(data, fileName(record) + '.' + format, format === 'svg' ? 'image/svg+xml;charset=utf-8' : 'image/png');
    }
  } catch (error) {
    if (await currentExport(scope) && button.isConnected) throw error;
  } finally { button.disabled = false; }
}
function archivePage() {
  const rs = live(), cities = cityOverview(rs).cities;
  const years = [...new Set(rs.map(r => calendarDate(r.departureDate).slice(0, 4)).filter(Boolean))].sort().reverse();
  const result = searchTickets(rs, state.filters);
  reconcileSelection(archiveSelected,result.error ? [] : result.records);
  const railCount = rs.filter(r => isJourneyRecord(r) && r.type === 'rail').length, flightCount = rs.filter(r => isJourneyRecord(r) && r.type === 'flight').length;
  const intro = header('我的票据', '', state.showDemo ? '' : `<button class="button secondary" data-action="scan-ticket">${icon('image')}扫描票据</button><button class="button primary" data-action="new">${icon('plus')}手动录入</button>`);
  const demo = guestDemoNotice() || (state.showDemo ? `<div class="demo-banner">${icon('info')}<span><strong>示例数据</strong> · 虚构记录</span><button data-action="exit-demo">${hasCloud() && state.syncMeta.verified ? '返回我的票据' : '退出示例模式'} ${icon('arrow')}</button></div>` : '');
  const stats = `<section class="stats" aria-label="票夹概览"><div><span class="stat-label">${icon('ticket')}票据总数</span><strong>${rs.length}<small>张${state.showDemo ? '示例' : ''}</small></strong></div><div><span class="stat-label">${icon('train')}火车票</span><strong>${railCount}<small>程</small></strong></div><div><span class="stat-label">${icon('plane')}机票</span><strong>${flightCount}<small>程</small></strong></div><div><span class="stat-label">${icon('map')}涉及城市</span><strong>${cities.length}<small>城</small></strong></div></section>`;
  return intro + demo + stats + searchPanel(rs, state.filters, result, { open: state.filterOpen, routesOpen: state.routesOpen, demo: state.showDemo }) + ticketViewControls(ticketView) + '<div id="archive-selection">' + (archiveIsSpace() ? '' : archiveSelectionMarkup(result, archiveSelected, { canDelete:canWrite() && !state.showDemo && !state.saving })) + '</div><section id="search-results" aria-label="票据总数">' + searchResults(rs, result) + '</section>' + pageFooter('<span id="archive-match-count">' + (state.showDemo ? '示例' : '私人') + '票夹 · ' + result.records.length + ' 张票据</span>');
}
function searchResults(rs, result) {
  const visible = result.records;
  if (result.error) return '<div class="empty-state"><h2>请调整筛选条件</h2><p>检查上方日期或票价范围后，结果会自动更新。</p><button class="button secondary" data-action="reset-filters">清除筛选</button></div>';
  const view=ticketView,rows=archiveIsSpace() ? visible : visible.slice(0,state.limit);
  const collection=ticketCollection(rows,view,{icon,selected:archiveSelected,sort:state.filters.sort});
  return visible.length ? collection + (!archiveIsSpace() && visible.length>state.limit ? `<div class="load-more"><button class="button secondary" data-action="load-more">继续翻看 · 已显示 ${state.limit} / ${visible.length} 张</button></div>` : '') : `<div class="empty-state">${icon('ticket')}<h2>${rs.length ? '还没有匹配的票据' : '暂无票据'}</h2><p>${rs.length ? '试试减少条件，或查找其他路线、旅客与日期。' : '填写信息或扫描纸质票据。'}</p><button class="button primary" data-action="${rs.length ? 'reset-filters' : 'new'}">${icon(rs.length ? 'search' : 'plus')}${rs.length ? '清除筛选' : '录入票据'}</button></div>`;
}
function refreshSearch() {
  clearTimeout(searchTimer);
  searchTimer = null;
  if (state.page !== 'archive') return;
  ticketSpaceCleanup?.();ticketSpaceCleanup=null;
  const rs = live(), result = searchTickets(rs, state.filters);
  reconcileSelection(archiveSelected, result.error ? [] : result.records);
  document.querySelector('#search-results').innerHTML = searchResults(rs, result);
  document.querySelector('#search-chips').innerHTML = searchChips(state.filters);
  const cityContext = document.querySelector('#city-context'); if (cityContext) cityContext.innerHTML = cityContextHTML(rs, state.filters);
  document.querySelector('#search-result-count').textContent = resultSummary(result, rs.length);
  const error = document.querySelector('#search-error'); error.textContent = result.error; error.hidden = !result.error;
  refreshArchiveSelection(result);
  document.querySelector('#archive-match-count').textContent = (state.showDemo ? '示例' : '私人') + '票夹 · ' + result.records.length + ' 张票据';
  mountCollectionSpace();
}
function updateSearch(key, value, immediate = false) {
  if (!Object.hasOwn(DEFAULT_SEARCH, key)) return;
  state.filters = searchOptions({ ...state.filters, [key]: value }); state.limit = 48;
  const hasRoute = ['originCity', 'destinationCity', 'origin', 'destination'].some(key => state.filters[key]);
  if (!hasRoute) state.filters.bothDirections = false;
  const reverse = document.querySelector('#search-bothDirections'); if (reverse) { reverse.disabled = !hasRoute; reverse.checked = state.filters.bothDirections; }
  for (const field of ['minPrice', 'maxPrice', 'sort']) {
    if (field === key) continue;
    const control = document.querySelector('#search-' + field); if (control) control.value = state.filters[field];
  }
  clearTimeout(searchTimer); if (immediate) refreshSearch(); else searchTimer = setTimeout(refreshSearch, 140);
}

function importPage() {
  if (state.showDemo) return header('录入票据', '') + '<div class="empty-state"><h2>示例模式</h2><p>关闭示例模式后可录入自己的票据。</p></div>';
  if (!canWrite()) return header('录入票据', '') + '<div class="empty-state"><h2>当前仅可查看缓存</h2><button class="button secondary" data-action="sync">恢复连接</button></div>';
  const pending = imports.entries.length;
  return header('录入票据', '填写信息、识别票面或行程截图。') + '<div class="entry-layout">' + '<section class="panel manual-panel"><h2>手动录入</h2><p>填写旅程信息，同时查看票面效果。</p><button class="button primary" data-action="new">'+icon('plus')+'添加票据</button></section>' + '<aside class="entry-aside"><section class="scan-launch-panel"><div class="scan-launch-heading"><span class="scan-entry-symbol">' + icon('camera') + '</span><h2>扫描票据</h2></div><p>支持纸质车票、登机牌、12306购票详情及航旅纵横行程截图。</p><button class="button scan-launch-button" data-action="scan-ticket">打开相机扫描</button><label class="button scan-album-button">选择照片或行程截图<input id="camera-file" type="file" accept="image/*" hidden /></label></section>' + (pending ? '<button class="button secondary full" data-action="review">继续校对 ' + pending + ' 张票据</button>' : '') + queuedBackupButton() + '<details class="panel file-entry"><summary>图片与文件</summary><label class="dropzone" id="dropzone" tabindex="0"><input id="import-files" type="file" multiple accept="image/*,.pdf,.eml,.txt,.json" hidden /><span class="drop-icon">' + icon('upload') + '</span><strong>选择或拖入文件</strong><span>票面照片、12306截图、邮件、PDF或备份</span></label><div id="import-status" class="import-status" role="status">' + (imports.phase === 'reading' ? '正在识别资料…' : '') + '</div></details><details class="panel paste-entry"><summary>粘贴行程文字</summary><label class="field"><span>短信、订单或邮件正文</span><textarea id="import-text" rows="6" placeholder="日期：2026-11-15 车次：G103&#10;出发：北京南 到达：上海虹桥&#10;时间：08:00 姓名：…"></textarea></label><button class="button secondary full" data-action="parse-text" ' + (imports.phase === 'reading' ? 'disabled' : '') + '>识别并填写</button></details></aside></div>';
}
function newPersonalRecord(type = 'rail') {
  const values=applyProfileDefaults({type,template:type === 'flight' ? 'air-boarding-pass' : DEFAULT_RAIL_TEMPLATE},state.settings.profile);
  markFieldSources(values,['type','template'],'default');
  return createRecord(values);
}
function scanTicket() {
  const task = startImport('camera');
  if (!task) return;
  openModal(scannerMarkup('auto'), true);
  modalRoot.querySelector('dialog').classList.add('scanner-modal');
  const dispose = mountScanner(modalRoot.querySelector('#live-scanner'), { type: 'auto', onResult(record, blob) {
    finishCameraImport(task, record, blob).catch(fail);
  } });
  scannerCleanup = () => { dispose(); imports.finish(task); };
}

async function finishCameraImport(task, record, image) {
  const accepted = await acceptsImport(task);
  if (!imports.finish(task)) return;
  closeModal(true);
  if (accepted) reviewImportCandidates(record.boardingCandidates || [record], { image, task });
}

function journeyMapPage() {
  return header('行程地图', '') + (guestDemoNotice() || (state.showDemo ? '<div class="demo-banner">' + icon('info') + '<span><strong>示例数据</strong> · 虚构记录</span></div>' : '')) + '<div id="journey-map-root"><div class="map-loading" role="status">正在加载地图…</div></div>';
}
function statisticsPage() {
  return header('数据统计', '从票据中回看走过的旅程') + (guestDemoNotice() || (state.showDemo ? '<div class="demo-banner">' + icon('info') + '<span><strong>示例数据</strong> · 虚构记录</span></div>' : '')) + '<div id="statistics-root"><div class="map-loading" role="status">正在整理统计…</div></div>';
}
function flightSettingsPanel() {
  if (!supportsDesktopMcp()) return '';
  return `<section class="panel desktop-flight-settings"><div class="panel-heading"><span class="panel-icon">${icon('plane')}</span><div><h2>飞常准历史行程</h2><p>电脑端 · 按年手动查询</p></div></div><label class="field"><span>历史行程年份</span><input id="flight-year" type="number" inputmode="numeric" min="1900" max="${new Date().getFullYear()}" step="1" value="${e(state.flightYear)}" /></label><form id="flight-form"><label class="field"><span>个人MCP Key</span><input type="password" name="key" value="${e(state.flightKeyDraft ?? flightKey())}" autocomplete="off" data-setting-control /></label><p class="form-error" role="alert">${e(state.settingsError)}</p><div class="button-row flight-actions"><button class="button secondary" type="submit" data-setting-control>保存并同步</button><button class="button secondary" type="button" data-action="flight-refresh">${icon('refresh', imports.task?.kind === 'flight' ? 'spin' : '')}${imports.task?.kind === 'flight' ? '正在查询…' : '查询历史行程'}</button></div></form><p class="body-copy">电脑 Chrome 或 Edge 安装连接扩展后，可按年份查询历史行程。</p><a class="button secondary" href="./downloads/xingji-variflight-extension.zip" download="行迹-飞常准连接.zip">下载电脑连接扩展</a>${state.flightResult ? '<button class="text-button" data-action="flight-result">查看本次接口返回</button>' : ''}<a class="small-link" href="https://cmcp.variflight.com/tools/" target="_blank" rel="noopener noreferrer">平台文档与授权说明 ↗</a></section>`;
}
function dataPage() {
  const count = state.records.filter(r => !r.deleted).length;
  return header('数据与同步', '管理个人资料、同步与外部连接。') + `<div class="data-layout">${personalProfilePanel(state.profileDraft || state.settings.profile,state.profileError)}
    <div class="data-column">${d1ConnectionPanel()}<section class="panel"><div class="panel-heading"><span class="panel-icon">${icon('cloud')}</span><div><h2>GitHub 私有仓库</h2><p data-cloud-label>${state.d1 ? '手动备份' : e(syncLabel())}</p></div><span class="status-pill ${state.config && token() ? 'connected' : ''}">${state.config ? '已配置' : '未连接'}</span></div>${connectionForm()}<p class="form-error" role="alert">${e(state.githubError)}</p>${githubExtras()}</section></div>
    <aside class="data-column">${flightSettingsPanel()}
    <section class="panel quiet-panel"><h3>${icon('ticket')}随身票夹</h3><p>在手机浏览器中选择“添加到主屏幕”，即可像应用一样打开。已有票据可离线查看。</p>${installPrompt ? '<button class="button secondary" data-action="install">安装行迹</button>' : ''}</section></aside>
    <section class="panel backup-panel"><div class="panel-heading"><span class="panel-icon">${icon('download')}</span><div><h2>备份与迁移</h2><p>${count} 张票据</p></div></div><div class="backup-actions"><button data-action="backup"><span>${icon('database')}</span><strong>导出 JSON 备份</strong><small>包含票据、个人资料和访问凭证</small>${icon('download')}</button><button type="button" data-action="import-json"><span>${icon('database')}</span><strong>导入 JSON 备份</strong><small>先恢复票库，再选择是否连接账号</small>${icon('upload')}</button></div><input id="import-json-file" type="file" accept=".json,application/json" hidden /><div id="import-status" class="import-status" role="status"></div><div data-restore-followup>${backupRestoreMarkup()}</div>${queuedBackupButton()}${cloudActions()}</section>
  </div>`;
}
function render() {
  if (composing) { deferredRender = true; return; }
  const active = document.activeElement, focused = root.contains(active) ? { id: active.id, name: active.name, form: active.form?.id, start: active.selectionStart, end: active.selectionEnd } : null;
  mapCleanup?.(); mapCleanup = null; mapEpoch++;
  statisticsCleanup?.(); statisticsCleanup = null;
  ticketSpaceCleanup?.();ticketSpaceCleanup=null;
  clearTimeout(searchTimer);
  searchTimer = null;
  const scroll = window.scrollY;
  if(!['archive','map','statistics','import','data'].includes(state.page) || (state.showDemo && ['import','data'].includes(state.page))){state.page='archive';history.replaceState(null,'','#archive');}
  if (!state.showDemo && (!hasCloud() || !state.syncMeta.verified)) { root.innerHTML = connectionPage(); bindPage(); }
  else { root.innerHTML = `${nav()}<main id="main"><div id="connection-state">${connectionNotice()}</div>${({ archive: archivePage, map: journeyMapPage, statistics: statisticsPage, import: importPage, data: dataPage }[state.page] || archivePage)()}${state.page === 'archive' ? '' : pageFooter()}</main>`;
  bindPage(); applyAccessPolicy(); renderedRecords = JSON.stringify(state.records); renderedSettings = JSON.stringify(state.settings); renderedWritable = canWrite(); }
  if (focused) {
    const input = focused.id ? document.getElementById(focused.id) : [...root.querySelectorAll('[name]')].find(input => input.name === focused.name && input.form?.id === focused.form);
    input?.focus({ preventScroll: true }); if (input?.setSelectionRange && focused.start !== null && ['text', 'search', 'password', 'tel', 'url'].includes(input.type)) input.setSelectionRange(focused.start, focused.end);
  }
  window.scrollTo(0, scroll);
}
function renderSyncState() {
  if (!document.querySelector('#connection-state') || !hasCloud() || !state.syncMeta.verified || renderedRecords !== JSON.stringify(state.records) || (['data','import'].includes(state.page) && renderedSettings !== JSON.stringify(state.settings)) || (state.page === 'import' && renderedWritable !== canWrite())) { render(); return; }
  document.querySelector('#connection-state').innerHTML = connectionNotice();
  for (const button of document.querySelectorAll('.sync-button')) { button.innerHTML = icon(state.syncing ? 'refresh' : 'cloud', state.syncing ? 'spin' : '') + '<span>' + e(syncLabel()) + '</span>'; button.title = syncLabel(); }
  const cloudLabel = root.querySelector(state.d1 ? '[data-d1-cloud-label]' : '[data-cloud-label]'); if (cloudLabel) cloudLabel.textContent = syncLabel();
  for (const button of root.querySelectorAll('#github-form [type="submit"], #d1-form [type="submit"]')) button.disabled = state.syncing || state.connecting || state.saving || state.githubBackingUp;
  const backup = root.querySelector('[data-action="backup-github"]'); if (backup) backup.disabled = !canWrite() || state.syncMeta.pending || !token() || state.saving || state.githubBackingUp;
  const backupStatus = root.querySelector('[data-github-backup-status]');
  if (backupStatus) {
    const label = githubBackupLabel();
    if (backupStatus.textContent !== label) backupStatus.textContent = label;
  }
  const followup = root.querySelector('[data-restore-followup]');
  if (followup) {
    const markup = backupRestoreMarkup();
    if (followup.innerHTML !== markup) followup.innerHTML = markup;
  }
  applyAccessPolicy();
}
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { composing = false; if (deferredRender) { deferredRender = false; setTimeout(render, 0); } });
const pageScroll = new Map();
function visitPage(page, restoreScroll = false) {
  if (page !== state.page) {
    pageScroll.set(state.page, window.scrollY);
    importView++;
  }
  state.page = page;
  render();
  window.scrollTo(0, restoreScroll ? pageScroll.get(state.page) || 0 : 0);
  const title = root.querySelector('h1');
  if (title) {
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }
}
function navigate(page) {
  if (location.hash !== '#' + page) history.pushState(null, '', '#' + page);
  visitPage(page);
}
function followHistory() {
  const page = location.hash.slice(1) || 'archive';
  if (page !== state.page) visitPage(page, true);
}
function loadMoreTickets(button) {
  if (searchTimer) { refreshSearch(); return; }
  if (!button.isConnected || archiveIsSpace()) return;
  const container = root.querySelector('#search-results');
  const { records } = searchTickets(live(), state.filters);
  const next = records.slice(state.limit, state.limit + 48);
  if (!container || !next.length) return;
  const hadFocus = document.activeElement === button;
  appendTicketCollection(container, next, ticketView, { icon, selected: archiveSelected, sort: state.filters.sort });
  state.limit += next.length;
  if (state.limit >= records.length) button.closest('.load-more').remove();
  else button.textContent = `继续翻看 · 已显示 ${state.limit} / ${records.length} 张`;
  if (hadFocus) {
    [...container.querySelectorAll('[data-action="view"]')]
      .find(item => item.dataset.id === next[0].id)?.focus({ preventScroll: true });
  }
}
function mountCollectionSpace() {
  const container=root.querySelector('[data-ticket-space]');if(!container)return;
  const result=searchTickets(live(),state.filters);
  ticketSpaceCleanup=mountTicketSpace(container,result.records);
}
function bindPage() {
  if(state.page==='archive'){
    bindTicketViewControls(root,{value:ticketView,change:mode=>{ticketView.mode=mode;render();root.querySelector(`[data-ticket-view="${mode}"]`)?.focus({preventScroll:true});}});
    mountCollectionSpace();
  }
  const statisticsRoot = root.querySelector('#statistics-root');
  if (statisticsRoot) import('./statistics.js').then(({ mountStatistics }) => {
    if (statisticsRoot.isConnected) statisticsCleanup = mountStatistics(statisticsRoot, live(), { options: statisticsView });
  }).catch(error => { if (statisticsRoot.isConnected) statisticsRoot.innerHTML = '<p class="form-error">' + e(error.message) + '</p>'; });
  const mapRoot = root.querySelector('#journey-map-root'), epoch = mapEpoch;
  if (mapRoot) import('./journey-map.js').then(({ mountJourneyMap }) => {
    if (mapRoot.isConnected && epoch === mapEpoch) mapCleanup = mountJourneyMap(mapRoot, live(), { icon, options: state.mapView });
  }).catch(error => { if (mapRoot.isConnected) mapRoot.innerHTML = '<p class="form-error">' + e(error.message) + '</p>'; });
  if (state.page === 'archive') refreshArchiveSelection();
  bindSeatClassFields(root);
  bindPlaceFields(root);
  bindDatePickers(root);
  for (const input of document.querySelectorAll('[data-search-field]')) {
    const commit = event => { if (event.isComposing) return; updateSearch(input.dataset.searchField, input.type === 'checkbox' ? input.checked : input.value, input.tagName === 'SELECT' || input.type === 'checkbox'); };
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', commit);
    input.addEventListener('compositionend', commit);
  }
  document.querySelector('#advanced-search')?.addEventListener('toggle', event => { state.filterOpen = event.target.open; });
  const githubForm = root.querySelector('#github-form');
  if (githubForm) { githubForm.addEventListener('input', () => captureConnectionDraft(githubForm)); githubForm.addEventListener('change', () => captureConnectionDraft(githubForm)); githubForm.addEventListener('submit', connectGitHub); }
  const d1Form = root.querySelector('#d1-form');
  if (d1Form) {
    const capture = () => { state.d1Draft = { ...state.d1Draft, url: d1Form.elements.url.value, token: d1Form.elements.token.value }; };
    d1Form.addEventListener('input', capture);
    d1Form.addEventListener('change', capture);
    d1Form.addEventListener('submit', event => { event.preventDefault(); capture(); connectD1(d1Form); });
  }
  root.querySelector('#demo-toggle')?.addEventListener('change', async event => {
    event.target.disabled = true;
    try { await setDemoMode(event.target.checked); render(); }
    catch (error) { event.target.checked = state.showDemo; event.target.disabled = false; fail(error); }
  });
  root.querySelector('#flight-year')?.addEventListener('input', event => { state.flightYear = event.target.value; });
  const flightForm = document.querySelector('#flight-form');
  flightForm?.addEventListener('input', () => { state.flightKeyDraft = flightForm.elements.key.value; applyAccessPolicy(); });
  flightForm?.addEventListener('submit', saveFlightSettings);
  const updateProfileDraft = profile => {
    if (!state.profileDirty) state.profileBase = clone(state.settings);
    state.profileDraft = profile; state.profileDirty = true;
  };
  bindPersonalProfileForm(root.querySelector('#profile-form'), {
    documents: (state.profileDraft || state.settings.profile)?.documents,
    change: updateProfileDraft, restructure: profile => { updateProfileDraft(profile); render(); }, submit: savePersonalProfile
  });
  for (const id of ['import-files', 'camera-file']) document.querySelector('#' + id)?.addEventListener('change', event => handleFiles([...event.target.files]));
  const picker = root.querySelector('#import-json-file');
  if (picker) {
    root.querySelector('[data-action="import-json"]').addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => {
      const [file] = picker.files;
      picker.value = '';
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.json')) return importStatus('请选择 JSON 文件');
      handleFiles([file], { backupOnly: true });
    });
  }
  const drop = document.querySelector('#dropzone');
  if (drop) {
    drop.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.querySelector('#import-files').click(); } });
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('dragover'); handleFiles([...event.dataTransfer.files]); });
  }
}
let modalCancel=null;
function requireArithmetic(title, description = '', confirmLabel = '确认删除'){
  const challenge=createArithmeticChallenge();
  return new Promise(resolve=>{
    openModal(modalHead(title, e(description))+ '<form class="detail-body" data-delete-challenge>'+arithmeticField(challenge)+'<div class="reset-actions"><button type="button" class="button secondary" data-action="close-modal">取消</button><button type="submit" class="button danger">'+e(confirmLabel)+'</button></div></form>');
    const form=modalRoot.querySelector('[data-delete-challenge]');let finished=false;
    const finish=accepted=>{if(finished)return;finished=true;modalCancel=null;form.removeEventListener('submit',submit);if(accepted)closeModal(true);resolve(accepted);};
    const submit=event=>{event.preventDefault();if(!checkArithmeticAnswer(challenge,form.elements['arithmetic-answer'].value)){form.querySelector('[data-arithmetic-error]').textContent='答案不正确，请重新计算';return;}finish(true);};
    modalCancel=()=>finish(false);form.addEventListener('submit',submit);form.elements['arithmetic-answer'].focus();
  });
}
function disposeModalBindings() {
  modalCancel?.();
  flightLookupCleanup?.(); flightLookupCleanup = null;
  railLookupCleanup?.(); railLookupCleanup = null;
  railRouteCleanup?.(); railRouteCleanup = null;
  railJourneyCleanup?.(); railJourneyCleanup = null;
  exportCleanup?.(); exportCleanup = null;
  scannerCleanup?.(); scannerCleanup = null;
  codeCleanup?.(); codeCleanup = null;
}
function openModal(html, wide = false) {
  disposeModalBindings();
  modalFocus = document.activeElement;
  modalRoot.innerHTML = `<dialog class="modal ${wide ? 'wide' : ''}">${html}</dialog>`;
  const dialog = modalRoot.querySelector('dialog'); dialog.addEventListener('cancel', event => { event.preventDefault(); closeModal(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && !editor?.dirty) closeModal(); });
  dialog.showModal(); document.body.classList.add('modal-open');
  applyAccessPolicy();
}
function closeModal(force = false) {
  if ((state.resetting || modalRoot.querySelector('form[data-pending="true"]')) && !force) return false;
  if (editor?.dirty && !force) {
    if (!confirm('还没有保存这次修改，确定放弃吗？')) return false;
  }
  disposeModalBindings();
  modalRoot.querySelector('dialog')?.close(); modalRoot.innerHTML = ''; document.body.classList.remove('modal-open'); editor = null;
  setImportReference(null);
  imports.review = 'closed';
  modalFocus?.focus?.();
  if ((imports.entries.length || imports.backup) && !state.showDemo && ['import', 'data'].includes(state.page)) render();
  return true;
}
function setImportReference(image) {
  if (localFileURL) URL.revokeObjectURL(localFileURL);
  localFileURL = image ? URL.createObjectURL(image) : null;
}
const modalHead = (title, subtitle = '') => `<div class="modal-heading"><div><h2>${title}</h2>${subtitle ? `<p>${subtitle}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="关闭对话框">${icon('close')}</button></div>`;
function findRecord(id) { return live().find(r => r.id === id); }
function viewRecord(id) {
  const r = findRecord(id); if (!r) return;
  const demo = id.startsWith('demo-');
  const details = ticketDetails(r);
  openModal(modalHead(`<span class="heading-service">${e(r.service || (r.flightStatus === 'open' ? 'OPEN' : '班次待补充'))}</span><span class="heading-route">${e(r.origin || '出发地')} <span class="muted">→</span> ${e(r.destination || '到达地')}</span>`, demo ? '虚构示例' : '') + `<div class="detail-preview">${ticketSVG(r)}</div><div class="detail-body"><dl class="detail-grid">${details.map(([key, value]) => `<div><dt>${e(key === 'price' && isRefundReceipt(r) ? '退票费（元）' : key === 'seat' && r.type === 'flight' ? '座位 / 舱位' : key === 'gate' && r.type === 'flight' ? '登机口' : ticketFieldLabel(key,r.type,labels[key]))}</dt><dd>${e(value || '未收录')}</dd></div>`).join('')}</dl>${boardingJourneyMarkup(r,live())}${railJourneyMarkup(r,live())}${r.type === 'rail' ? '<section class="rail-route" data-rail-route hidden aria-label="铁路线路"></section>' : ''}<details class="source-details"><summary>数据来源 · ${r.sources.length} 条</summary>${r.sources.map(s => `<p>${e(s.label)}<span>${e(s.at.slice(0, 10))}</span></p>`).join('') || '<p>手动录入</p>'}</details></div><div class="modal-footer"><button class="button secondary" data-action="export-png" data-id="${e(id)}">${icon('download')}导出图片</button><button class="button secondary" data-action="export-svg" data-id="${e(id)}">SVG</button><div class="spacer"></div>${!demo ? `<button class="icon-button danger" data-action="delete" data-id="${e(id)}" aria-label="删除票据">${icon('trash')}</button><button class="button primary" data-action="edit" data-id="${e(id)}">${icon('edit')}编辑票据</button>` : ''}</div>`);
  const journeyContainer=modalRoot.querySelector('.rail-journey');
  if(journeyContainer)railJourneyCleanup=bindRailJourney(journeyContainer,()=>r);
  const routeContainer = modalRoot.querySelector('[data-rail-route]');
  if (routeContainer && isJourneyRecord(r)) import('./rail-route-map.js').then(({ mountRailRoute }) => { if (routeContainer.isConnected) railRouteCleanup = mountRailRoute(routeContainer, r); }).catch(() => {});
}
function field(key, r, options = {}) {
  if (key === 'seatClass') return seatClassField(r);
  if (key === 'seat' && r.type === 'rail') return seatField(r);
  const type = options.type || (['departureTime', 'arrivalTime', 'boardingTime', 'actualDepartureTime', 'actualArrivalTime', 'actualBoardingTime'].includes(key) ? 'time' : 'text');
  const airportField = r.type === 'flight' && ['origin', 'destination', 'originCode', 'destinationCode'].includes(key);
  const placeholders = { railBureau: '如：上海局', railModel: '如：25T、CR400BF-S', railPowerSupply:'如：DC600V、AC380V', railMileage:'如：1463', departureDate: '如 2026-11-15', arrivalDate: '如 2026-11-15', origin: r.type === 'rail' ? '如：北京南' : '如：PEK / 北京首都', destination: r.type === 'rail' ? '如：上海虹桥' : '如：HND / 东京羽田', service: r.type === 'rail' ? '如：G103' : '如：CA181', originCode: r.type === 'rail' ? '如：Beijingnan' : '如：PEK', destinationCode: r.type === 'rail' ? '如：Shanghaihongqiao' : '如：HND', identity: '请输入完整证件号', departureZone: '如：Asia/Shanghai', arrivalZone: '如：Asia/Tokyo' };
  const required = requiredTicketFields(r.type, r.template, r.flightStatus).includes(key) || ['type', 'template'].includes(key);
  const requiredAttrs = required ? 'required aria-required="true"' : '';
  if(JOURNEY_DATE_FIELDS.includes(key))return ticketDateField(key,r,{label:ticketFieldLabel(key,r.type,labels[key]),required});
  const control = options.options ? `<select name="${key}" ${requiredAttrs}>${options.options.map(([v, label]) => `<option value="${e(v)}" ${r[key] === v ? 'selected' : ''}>${e(label)}</option>`).join('')}</select>` : `<input name="${key}" ${requiredAttrs} type="${type}" value="${e(r[key])}" placeholder="${e(placeholders[key] || '')}" ${options.type === 'number' ? 'min="-30" max="30" step="1"' : ''} ${['price','railMileage','flightDistance'].includes(key) ? 'inputmode="decimal"' : ''} ${key === 'identity' ? 'autocomplete="off" spellcheck="false"' : ''} />`;
  const content = airportField || ['origin','destination','airline'].includes(key) ? `<span class="airport-picker">${control}<span class="airport-suggestions" role="listbox" hidden></span></span>` : control;
  const label = key === 'price' && isRefundReceipt(r) ? '退票费（元）' : ticketFieldLabel(key, r.type, labels[key]);
  return `<label class="field ${options.full ? 'full-field' : ''}"><span>${e(label)}${required ? '<b class="required-mark" aria-label="必填">*</b>' : r.type==='flight' && key==='pnr' ? barcodeRequiredMark : ''}${fieldSourceBadge(key,r)}</span>${content}</label>`;
}
function bindPlaceFields(container) {
  for (const input of container.querySelectorAll('[name="origin"], [name="destination"]')) {
    const form = input.closest('form'), side = input.name;
    let acceptedName = input.value, acceptedCode = form.elements[side + 'Code'].value;
    const refresh = canonical => {
      const type = form.elements.type.value;
      const place = resolvePlace({ type, [side]: input.value, [side + 'Code']: input.value === acceptedName ? acceptedCode : '' }, side);
      form.elements[side + 'Code'].value = place.status === 'matched' ? (type === 'flight' ? place.code : place.pinyin) : '';
      if (canonical && type === 'flight' && place.status === 'matched') input.value = place.chineseFullName || place.name;
      acceptedName = input.value; acceptedCode = form.elements[side + 'Code'].value;
    };
    const flight=form.elements.type.value==='flight';
    const bindPicker=flight?bindAirportPicker:bindStationPicker;
    bindPicker(input, place => {
      input.value = place.chineseFullName || place.name;
      acceptedName = input.value; acceptedCode = flight?place.code:place.pinyin;
      input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true }));
    });
    input.addEventListener('input', () => refresh(false));
    input.addEventListener('change', () => { refresh(true); input.dispatchEvent(new input.ownerDocument.defaultView.Event('input', { bubbles: true })); });
  }
}
function marksEditor(record) {
  return `<section class="editor-extra"><h3>票面标识${fieldSourceBadge('ticketMarks',record)}</h3><p class="fine-print">选择标识的文字与外框。</p><div id="mark-rows">${markRows(record.ticketMarks)}</div><button class="button small secondary" type="button" data-mark-add>＋ 添加标识</button></section>`;
}
function markRows(marks) {
  return marks.map((mark, i) => `<div class="ticket-mark-row" data-mark-index="${i}"><div class="mark-main"><label class="field"><span>标识文字</span><input name="markText-${i}" value="${e(mark.text)}" placeholder="如：网" maxlength="2" /></label><label class="field"><span>外框</span><select name="markShape-${i}">${Object.entries(MARK_SHAPES).map(([value, label]) => `<option value="${value}" ${mark.shape === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="icon-button danger" data-mark-remove="${i}" aria-label="删除第${i + 1}个标识">${icon('trash')}</button></div><div class="mark-adjust"><p class="fine-print">此标识的位置微调</p><div class="form-grid"><label class="field"><span>横向偏移</span><input type="number" name="markX-${i}" value="${Number(mark.offsetX) || 0}" min="-100" max="100" step="1" /></label><label class="field"><span>纵向偏移</span><input type="number" name="markY-${i}" value="${Number(mark.offsetY) || 0}" min="-100" max="100" step="1" /></label></div></div></div>`).join('');
}
function collectMarks(form) {
  return [...form.querySelectorAll('.ticket-mark-row')].map((row, i) => ({ text: form.elements[`markText-${i}`].value.trim(), shape: form.elements[`markShape-${i}`].value, offsetX: Number(form.elements[`markX-${i}`].value), offsetY: Number(form.elements[`markY-${i}`].value) }));
}
async function reviewBoardingLegs(code, current, image) {
  const sourceEditor = editor;
  if (!sourceEditor || !canWrite() || !await currentArchive(sourceEditor.context) || editor !== sourceEditor || !canWrite()) return;
  const records=parseScanText('', '登机牌联程条码', {boardingCodes:[code]});
  if(records.length<2)return;
  const matching=records.find(record=>record.service===current.service)||records[0];
  const candidates=records.map(record=>{
    const values=clone(record);
    if(record===matching){
      for(const key of FIELDS)if(!values[key]&&current[key]&&key!=='boardingLegIndex'){
        values[key]=clone(current[key]);
        if(current.fieldSources?.[key])values.fieldSources[key]=current.fieldSources[key];
        if(current.lockedFields?.includes(key))values.lockedFields.push(key);
      }
      const year=current.departureDate?.year;
      if(year&&values.departureDate?.dayOfYear<=daysInYear(year)){
        values.departureDate.year=year;
        if(current.fieldSources?.departureDateYear)values.fieldSources.departureDateYear=current.fieldSources.departureDateYear;
      }
    }
    return createRecord(applyProfileDefaults(values,state.settings.profile));
  });
  if(editor)editor.dirty=false;closeModal(true);
  reviewImportCandidates(candidates, { batch: true, image });
}
function editRecord(record = newPersonalRecord(), importIndex = null, preserve = false, originalOverride = null) {
  const entry = imports.entries[importIndex];
  const fromBatch = preserve ? editor?.fromBatch : imports.batch;
  const context = preserve && editor ? editor.context : archiveContext();
  setImportReference(entry?.image);
  if (entry) imports.review = 'reviewing';
  const original = clone(originalOverride || record), draft = normalizePlaces(clone(record));
  if (hasMaskedIdentity(draft.identity)) draft.identity = '';
  if(draft.type==='flight' && draft.boardingCodeSource==='original')draft.passenger=flightPassengerName(draft,readBoardingCode(draft.boardingCode,draft.boardingLegIndex) || {});
  const generatorSettings = preserve && draft.type==='flight' ? readBoardingGenerator(modalRoot) : undefined;
  draft.flightStatus = draft.type === 'flight' ? normalizeFlightStatus(draft.flightStatus) : '';
  const personalEdited = preserve ? new Set(editor?.personalEdited || []) : new Set(record.lockedFields || []);
  const typeFixed = importIndex !== null || state.records.some(record => record.id === draft.id);
  editor = { original, draft, importIndex, fromBatch, context, dirty: preserve, personalEdited };
  const flight = draft.type === 'flight';
  const basics = flight ? ['origin','destination','service','departureDate','departureTime','arrivalTime','arrivalDate','boardingTime','passenger','identity','airline','seat','seatClass','price','gate'] : ['origin','destination','service','departureDate','departureTime','passenger','identity','carriage','seatClass','seat','price','gate','railPlatform'];
  const extra = flight ? ['orderNumber', 'terminal', 'aircraft', 'aircraftRegistration', 'pnr', 'ticketNumber', 'flightDistance'] : ['arrivalDate','arrivalTime','railBureau','railRunner','railCarOwner','railModel','railPowerSupply','railMileage','orderNumber','ticketNumber','saleCode','issuer'];
  openModal(modalHead(importIndex !== null ? '核对这张票据' : state.records.some(r => r.id === draft.id) ? '编辑票据' : '添加一张票据', '红色<span class="required-mark">*</span> 为保存票据必填') + `<form id="editor-form" novalidate><input type="hidden" name="originCode" value="${e(draft.originCode)}" /><input type="hidden" name="destinationCode" value="${e(draft.destinationCode)}" /><div class="editor-layout ${flight ? 'flight-editor-layout' : ''}"><div class="editor-fields"><div class="form-grid">${field('type', draft, { options: [['rail', '火车票'], ['flight', '机票']] })}${flight ? '<input type="hidden" name="template" value="air-boarding-pass" />' : field('template', {...draft,template:isRefundReceipt(draft) ? 'rail-receipt' : draft.template}, { options: Object.entries(TEMPLATES).filter(([id]) => id !== 'rail-refund-receipt' && id.startsWith('rail-')).sort(([a],[b]) => Number(b === DEFAULT_RAIL_TEMPLATE) - Number(a === DEFAULT_RAIL_TEMPLATE)) })}${!flight && ['rail-receipt','rail-refund-receipt'].includes(draft.template) ? '<label class="checkbox-row receipt-refund-switch"><input type="checkbox" data-refund-receipt ' + (isRefundReceipt(draft) ? 'checked' : '') + ' />退票费凭证' + fieldSourceBadge('template',draft) + '</label>' : ''}${flight ? field('flightStatus', draft, { options: Object.entries(FLIGHT_STATUSES) }) + ticketCodeEditor(draft,!!localFileURL,'',{generator:false}) : ''}${basics.map(key => field(key,draft) + (key === 'departureDate' ? flight ? flightLookupMarkup() : !isRefundReceipt(draft) ? railLookupMarkup(draft) : '' : '')).join('')}${extra.map(key=>field(key,draft)+(key==='railModel' && !isRefundReceipt(draft) ? railTrainsetField(draft) : '')).join('')}</div>${flight ? '<details class="editor-extra boarding-metadata" '+(BOARDING_METADATA_FIELDS.some(key=>draft[key])?'open':'')+'><summary>行李、常旅客与代码共享</summary><div class="form-grid">'+BOARDING_METADATA_FIELDS.map(key=>field(key,draft)).join('')+'</div></details><div data-boarding-journey>'+boardingJourneyMarkup(draft)+'</div><section class="editor-extra actual-flight-times"><h3>实际登机与起降（仅存档）</h3><div class="form-grid">' + ACTUAL_FLIGHT_FIELDS.map(key=>field(key,draft)).join('') + '</div></section>' : marksEditor(draft)}${flight ? boardingGeneratorMarkup(draft,{profile:state.settings.profile,settings:generatorSettings}) : ticketCodeEditor(draft, !!localFileURL)}<section class="editor-extra"><h3>排版微调</h3><div class="form-grid">${field('offsetX', draft, { type: 'number' })}${field('offsetY', draft, { type: 'number' })}</div></section></div><aside class="editor-visual"><div class="preview-label"><span>票面预览</span></div><div id="editor-preview" class="editor-preview">${ticketSVG(draft)}</div><p class="fine-print"></p>${localFileURL ? `<details open class="scan-reference"><summary>扫描原图</summary><img src="${e(localFileURL)}" alt="本次录入票据，供校对使用" /></details>` : ''}</aside></div><div class="modal-footer editor-footer"><p class="editor-error" id="editor-error" role="alert" tabindex="-1" hidden></p><button class="button secondary" type="button" data-action="close-modal">取消</button><span class="save-note">${icon('database')}保存票据</span><div class="spacer"></div><button class="button primary" type="submit">${icon('check')}保存票据</button></div></form>`, true);
  // openModal replaces the DOM, but keeps the editor state deliberately.
  const form = document.querySelector('#editor-form');
  bindIdentityInput(form.elements.identity);
  bindTicketDates(form,()=>draft);
  form.elements.type.toggleAttribute('data-transport-fixed', typeFixed);
  form.elements.type.disabled = typeFixed;
  let lookupApplying=false;
  function updatePersonalFields(previousRecord) {
    if(importIndex===null && !state.records.some(record=>record.id===draft.id))Object.assign(draft,applyProfileDefaults(draft,state.settings.profile,{edited:[...editor.personalEdited],previousRecord}));
    if(draft.type==='flight' && draft.boardingCodeSource==='original'){
      const passenger=flightPassengerName(draft,readBoardingCode(draft.boardingCode,draft.boardingLegIndex) || {});
      if(passenger!==draft.passenger){draft.passenger=passenger;markFieldSources(draft,['passenger'],'barcode');}
    }
    for(const key of ['passenger','identity'])if(form.elements[key])form.elements[key].value=draft[key];
    if(draft.passenger!==previousRecord.passenger)refreshBoardingPassenger(form,draft,{profile:state.settings.profile,resetName:draft.boardingCodeSource!=='original'});
  }
  bindUppercaseNames(form, ['passenger'], () => form.elements.type.value === 'flight');
  bindSeatClassFields(form);
  bindSeatFields(form);
  bindDatePickers(form);
  bindPlaceFields(form);
  bindReferenceFields(form, state.records);
  form.addEventListener('change',event=>{
    const input=event.target;
    if(input.matches('[data-bcbp]') && !input.disabled)editor.dirty=true;
    if(input.matches('[data-refund-receipt]'))input.dispatchEvent(new window.Event('input',{bubbles:true}));
    if(input.tagName==='SELECT'&&FIELDS.includes(input.name)&&draft[input.name]!==input.value)input.dispatchEvent(new window.Event('input',{bubbles:true}));
  });
  codeCleanup = bindTicketCodeEditor(form, draft, ({filled=[],previousRecord={...draft},automatic=false}={}) => { if(automatic){refreshFieldSources(form,draft);document.querySelector('#editor-preview').innerHTML=ticketSVG(draft);return;}if(lookupContext(previousRecord)!==lookupContext(draft)){const cleared=clearLookupValues(draft);for(const key of Object.keys(cleared))if(form.elements[key])form.elements[key].value='';} normalizePlaces(draft); updatePersonalFields(previousRecord); for(const key of filled)if(form.elements[key])form.elements[key].value=draft[key]; editor.dirty = true; refreshFieldSources(form,draft); refreshBarcodeFieldLocks(form,draft);const metadata=form.querySelector('.boarding-metadata');if(metadata&&BOARDING_METADATA_FIELDS.some(key=>draft[key]))metadata.open=true;const journey=form.querySelector('[data-boarding-journey]');if(journey)journey.innerHTML=boardingJourneyMarkup(draft);document.querySelector('#editor-preview').innerHTML = ticketSVG(draft); }, { onMultiple:importIndex===null&&!state.records.some(record=>record.id===draft.id) ? (code,current,image)=>reviewBoardingLegs(code,{...draft,...current},image).catch(fail) : undefined, profile:state.settings.profile, preserveGenerator:!!generatorSettings, referenceURL: localFileURL, isCurrent: () => isArchiveContext(context), autoRead: draft.type === 'rail' && !!entry?.image && !draft.ticketCode });
  form.addEventListener('input', event => {
    if (event.target.matches('[data-rail-start]')) return;
    const changedKey=event.target.name || (event.target.matches('[data-seat-preset]') ? 'seatClass' : '');
    if (!lookupApplying && changedKey === 'type') {
      if (typeFixed || barcodeFieldLocked(draft,'type')) { form.elements.type.value=draft.type; return; }
      if (['rail','flight'].includes(event.target.value) && event.target.value !== draft.type) {
        editRecord(newPersonalRecord(event.target.value));
        editor.dirty=true;
        return;
      }
    }
    if(!lookupApplying && barcodeFieldLocked(draft,changedKey)){refreshBarcodeFieldLocks(form,draft);return;}
    const previousRecord={...draft}, previousTemplate = draft.template, previousStatus = draft.flightStatus, previousQuery=lookupContext(draft);
    if (!lookupApplying && ['passenger','identity'].includes(event.target.name)) editor.personalEdited.add(event.target.name);
    const data = new FormData(form); for (const [key, value] of data) if (FIELDS.includes(key) && !JOURNEY_DATE_FIELDS.includes(key) && !barcodeFieldLocked(draft,key)) draft[key] = value;
    for(const key of JOURNEY_DATE_FIELDS)if(form.elements[key+'Year'])draft[key]=readTicketDate(form,key,draft);
    if (!flight) { draft.ticketMarks = collectMarks(form).filter(mark => mark.text); if (data.get('template') === 'rail-receipt' && form.querySelector('[data-refund-receipt]')?.checked) draft.template = 'rail-refund-receipt'; }
    normalizePlaces(draft);
    if(!lookupApplying){
      const key=event.target.name || (event.target.matches('[data-seat-number],[data-berth]') ? 'seat' : event.target.matches('[data-seat-preset]') ? 'seatClass' : event.target.matches('[data-refund-receipt]') ? 'template' : '');
      if(event.target.closest('.ticket-mark-row'))markManualFields(draft,['ticketMarks']);
      const dateKey=event.target.closest('[data-journey-date]')?.dataset.journeyDate;
      if(dateKey){markManualFields(draft,[dateKey]);markFieldSources(draft,[dateKey+'Year'],'manual');if(barcodeDateDay(draft,dateKey))draft.fieldSources[dateKey]='barcode';}
      else if(FIELDS.includes(key))markManualFields(draft,[key,...(['origin','destination'].includes(key) ? [key+'Code'] : [])]);
      if(previousQuery!==lookupContext(draft)){
        const cleared=clearLookupValues(draft);
        for(const key of Object.keys(cleared))if(JOURNEY_DATE_FIELDS.includes(key))writeTicketDate(form,key,'');else if(form.elements[key])form.elements[key].value='';
      }
    }
    if (draft.railJourney && !railJourneyMatches(draft)) draft.railJourney='';
    editor.dirty = true;
    if (previousStatus !== draft.flightStatus || previousTemplate !== draft.template) { editRecord(draft, importIndex, true, original); return; }
    if(flight)updatePersonalFields(previousRecord);
    refreshFieldSources(form,draft);
    refreshBarcodeFieldLocks(form,draft);
    document.querySelector('#editor-preview').innerHTML = ticketSVG(draft);
  });
  form.addEventListener('click', event => {
    const add = event.target.closest('[data-mark-add]'), remove = event.target.closest('[data-mark-remove]');
    if (!add && !remove) return;
    const marks = collectMarks(form);
    if (add) {
      if (marks.length >= 4) return toast('每张票最多添加4个标识', true);
      marks.push({ text: '', shape: 'circle', offsetX: 0, offsetY: 0 });
    } else marks.splice(Number(remove.dataset.markRemove), 1);
    draft.ticketMarks = marks.filter(mark => mark.text);markManualFields(draft,['ticketMarks']); editor.dirty = true;
    form.querySelector('#mark-rows').innerHTML = markRows(marks);
    refreshFieldSources(form,draft);
    document.querySelector('#editor-preview').innerHTML = ticketSVG(draft);
    if (add) form.elements[`markText-${marks.length - 1}`].focus();
  });
  const showError = ticketFormFeedback(form, () => draft);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (form.dataset.pending) return;
    let release = () => {};
    try {
      if (!isArchiveContext(context)) throw new Error('票库已变化，请保留输入并重新打开票据。');
      for(const key of JOURNEY_DATE_FIELDS)if(form.elements[key+'Year']){
        try{draft[key]=readTicketDate(form,key,draft,{strict:true});}catch(error){error.fields=[key];throw error;}
      }
      validateTicketForm(draft);
    } catch (error) { showError(error); return; }
    release = freezeForm(form, '保存中…');
    try {
      const checked = validateRecord({ ...draft, updatedAt: now(), lockedFields: draft.lockedFields, sources: draft.sources.length ? draft.sources : [{ kind: 'manual', label: '手动录入', at: now() }] });
      if (importIndex !== null) {
        entry.record = checked;
        if (!fromBatch) await saveCandidates([importIndex]);
        else { editor.dirty = false; closeModal(true); reviewCandidates(); }
      } else {
        const records = clone(state.records); const index = records.findIndex(r => r.id === checked.id);
        if (index >= 0) {
          const merged=mergeThreeWay([original],[checked],[records[index]]);
          if(merged.conflicts.length)throw new Error('此票的同一字段已在同步时更新。请先复制你的修改，关闭并重新打开这张票后校对。');
          records[index]=merged.records[0];
          await persist(records);
        } else await persist([checked], { candidates: true });
        if (!isArchiveContext(context) || !form.isConnected) return;
        editor.dirty = false;
        closeModal(true);
        render();
        toast(savedMessage());
      }
    } catch (err) { release(); release = () => {}; applyAccessPolicy(); showError(err); } finally { release(); applyAccessPolicy(); }
  });
  if (flight) flightLookupCleanup = bindFlightLookup(form, {
    getRecord: () => draft, getKey: flightKey, canQuery: canWrite, desktop: supportsDesktopMcp,
    apply(changes, source) {
      lookupApplying=true;
      try {
      applyLookupValues(draft,changes,!!source,source);
      for (const [field, value] of Object.entries(changes)) if(JOURNEY_DATE_FIELDS.includes(field))writeTicketDate(form,field,draft[field]);else if (form.elements[field]) form.elements[field].value = value;
      for (const side of ['origin', 'destination']) if (changes[side] || changes[side + 'Code']) {
        const input = form.elements[side];
        input.value = draft[side + 'Code'] || draft[side];
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
        input.dispatchEvent(new window.Event('change', { bubbles: true }));
      }
      normalizePlaces(draft);
      if (!draft.sources.length) draft.sources.push({ kind: 'manual', label: '手动录入', at: now() });
      if (!draft.sources.some(item => item.kind === source.kind && item.label === source.label)) draft.sources.push(source);
      form.elements.service.dispatchEvent(new window.Event('input', { bubbles: true }));
      } finally {lookupApplying=false;}
    }
  });
  else railLookupCleanup = bindRailLookup(form, {
    getRecord: () => draft, canQuery: canWrite,
    apply(changes, source) {
      lookupApplying=true;
      try {
      applyLookupValues(draft,changes,!!source,source);
      for (const [key,value] of Object.entries(changes)) if(JOURNEY_DATE_FIELDS.includes(key))writeTicketDate(form,key,draft[key]);else if (form.elements[key]) form.elements[key].value=value;
      if (!draft.sources.length) draft.sources.push({ kind:'manual', label:'手动录入', at:now() });
      if (source && !draft.sources.some(item=>item.kind===source.kind && item.label===source.label)) draft.sources.push(source);
      form.elements.service.dispatchEvent(new window.Event('input', { bubbles:true }));
      } finally {lookupApplying=false;}
    }
  });
  applyAccessPolicy();
}
function importStatus(message) { const el = document.querySelector('#import-status'); if (el) el.textContent = message; }
function archiveContext() {
  return { binding: activeBinding(state), generation: state.syncMeta.generation || '', epoch: authEpoch };
}
function startImport(kind) {
  if (!canWrite()) { toast('当前仅可查看缓存', true); return null; }
  const task = imports.start(kind, archiveContext(), importView);
  if (!task) toast('上一批资料仍在读取，请稍候', true);
  return task;
}
function currentImport(task) {
  return root.isConnected && imports.task === task && isArchiveContext(task.context);
}
async function currentArchive(context) {
  const { github, d1, syncMeta, archiveResetProgress } = await db.atomic(['github', 'd1', 'syncMeta', 'archiveResetProgress']);
  return root.isConnected && !archiveResetProgress && isArchiveContext(context) &&
    activeBinding({ config: github, d1 }) === context.binding && (syncMeta?.generation || '') === context.generation;
}
async function acceptsImport(task) {
  return currentImport(task) && await currentArchive(task.context) && currentImport(task);
}
function mayOpenImport(task) {
  return canWrite() && (!task || task.view === importView) && !modalRoot.querySelector('dialog');
}
function clearImportedWork() {
  if (editor?.importIndex != null || modalRoot.querySelector('.scanner-modal,[data-candidate-review],[data-backup-restore]')) closeModal(true);
  imports.clear();
}
async function handleFiles(files, { backupOnly = false } = {}) {
  if (!files.length) return;
  if (files.length > 20) return toast('每批最多处理20个文件，可以分批导入', true);
  const task = startImport('files');
  if (!task) return;
  applyAccessPolicy();
  const found = [], failures = [];
  let fallbackText = '';
  const showStatus = message => {
    if (currentImport(task) && !state.showDemo && task.view === importView) importStatus(message);
  };
  try {
    for (let i = 0; i < files.length; i++) {
      if (!currentImport(task)) return;
      const file = files[i];
      showStatus(`正在处理 ${i + 1}/${files.length}：${file.name}`);
      try {
        if (file.size > 50 * 1024 * 1024) throw new Error('文件超过50MB，请拆分后导入');
        const name = file.name.toLowerCase();
        if (name.endsWith('.json')) {
          const content = JSON.parse(await file.text());
          if (!currentImport(task)) return;
          if (backupOnly || content?.format === 'xingji-backup') {
            if (!await acceptsImport(task)) return;
            if (files.length !== 1) throw new Error('请单独选择要恢复的 JSON 备份');
            if (imports.backup) throw new Error('已有一份备份等待确认，请先处理');
            imports.backup = { data: readFullBackup(content), context: task.context };
            if (mayOpenImport(task)) openQueuedBackup();
            else if (!state.showDemo && !modalRoot.querySelector('dialog')) render();
            return;
          }
          if (content.schemaVersion && Array.isArray(content.records)) content.records = await upgradeCodeRecords(content.records);
          const records = content.schemaVersion ? readArchive(content) : mapFlightResult(content);
          found.push(...records.map(record => ({ record })));
        } else if (file.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|heic)$/.test(name)) {
          const { recognize } = await import('./ocr.js');
          if (!currentImport(task)) return;
          const recognized = await recognize(file, status => showStatus(`${i + 1}/${files.length} · ${status}`), { details: true });
          if (!currentImport(task)) return;
          const result = parseScanText(recognized.text, file.name, recognized);
          if (!result.length) {
            fallbackText = recognized.text;
            throw new Error('没有识别到行程。可复制识别文字并手动修订');
          }
          found.push(...result.map(record => ({ record, image: file })));
        } else if (/\.(pdf|eml|txt)$/.test(name) || (!name.includes('.') && file.type === 'text/plain')) {
          const text = name.endsWith('.pdf') ? await extractPDF(file) : name.endsWith('.eml') ? decodeMail(await file.text()) : await file.text();
          const records = parseText(text, name.endsWith('.eml') ? 'email' : 'file', file.name);
          if (!records.length) throw new Error('没有识别到行程字段，请粘贴正文并手动补充');
          found.push(...records.map(record => ({ record })));
        } else throw new Error('请选择图片、JSON、PDF、邮件或文本文件');
      } catch (error) { failures.push(`${file.name}：${error.message}`); }
    }
    if (!await acceptsImport(task)) return;
    if (found.length) addCandidates(found, { task });
    if (task.view === importView && !state.showDemo) {
      if (failures.length) {
        importStatus(failures.join('\n'));
        toast(`${failures.length} 个文件需要手动处理，详情见导入状态`, true);
        const area = root.querySelector('#import-text');
        if (fallbackText && area) area.value = fallbackText;
      } else importStatus(`已识别 ${found.length} 条候选记录，请核对后保存。`);
    }
  } finally { if (imports.finish(task)) applyAccessPolicy(); }
}
function reviewImportCandidates(records, { batch = false, image, task } = {}) {
  addCandidates(records.map(record => ({ record, image })), { batch, task });
}
function addCandidates(entries, { batch = false, task } = {}) {
  const offset = imports.entries.length;
  imports.entries.push(...entries);
  imports.batch = imports.batch || batch || imports.entries.length > 1;
  entries.forEach(({ record }, index) => {
    if (hasMaskedIdentity(record.identity)) {
      record.identity = '';
      markFieldSources(record, ['identity'], 'ocr');
    }
    if (!missingTicketFields(record).length) imports.selected.add(offset + index);
  });
  if (mayOpenImport(task)) openCandidateReview();
  else if (!state.showDemo && !modalRoot.querySelector('dialog')) render();
}
function openCandidateReview() {
  if (!canWrite() || !imports.entries.length) return;
  if (imports.batch) reviewCandidates();
  else editRecord(imports.entries[0].record, 0);
}
function queuedBackupButton() {
  return imports.backup ? '<div class="button-row"><button class="button secondary" data-action="review-uploaded-backup">继续恢复已读取的备份</button></div>' : '';
}
function openQueuedBackup() {
  const queued = imports.backup;
  if (!queued || !isArchiveContext(queued.context) || !mayOpenImport()) return;
  reviewFullBackup(queued.data, queued.context);
}
function checkedCandidateIndices(form) {
  return [...form.querySelectorAll('.candidate-select:checked:not(:disabled)')].map(input => Number(input.dataset.index));
}
function reviewCandidates() {
  editor = null;
  imports.review = 'reviewing';
  const rows = imports.entries.map(({ record }, index) => {
    const missing = missingTicketFields(record);
    const fields = missing.map(key => key === 'price' && isRefundReceipt(record) ? '退票费' : ticketFieldLabel(key, record.type));
    return `<div class="review-row">
      <label><input type="checkbox" class="candidate-select" data-index="${index}" ${missing.length ? 'disabled' : imports.selected.has(index) ? 'checked' : ''} aria-label="选择第${index + 1}条" ${missing.length ? `aria-describedby="candidate-missing-${index}"` : ''} /></label>
      <div><strong>${e(record.origin || '出发地待补充')} → ${e(record.destination || '到达地待补充')}</strong>
      <p>${e(record.service || (record.flightStatus === 'open' ? 'OPEN' : '班次待补充'))} · ${e(formatDate(record.departureDate))} · ${e(record.passenger || '旅客待补充')}</p>
      ${fields.length ? `<p class="danger" id="candidate-missing-${index}">缺少 ${e(fields.join('、'))}</p>` : ''}</div>
      <button class="button small secondary" type="button" data-action="edit-candidate" data-index="${index}">${icon('edit')}校对</button></div>`;
  });
  openModal(modalHead(`核对 ${rows.length} 条候选票据`, '补齐必填项后即可勾选保存。') +
    `<form data-candidate-review><div class="review-list">${rows.join('')}</div>
    <div class="modal-footer"><button type="button" class="button secondary" data-action="close-modal">稍后处理</button>
    <button type="button" class="text-button danger" data-action="discard-candidates">放弃剩余</button><div class="spacer"></div>
    <button class="button primary" type="submit" data-action="save-candidates" ${imports.selected.size && canWrite() ? '' : 'disabled'}>${icon('check')}保存所选票据</button></div></form>`);
  const form = modalRoot.querySelector('[data-candidate-review]');
  form.addEventListener('change', event => {
    const input = event.target.closest('.candidate-select');
    if (!input || input.disabled) return;
    const index = Number(input.dataset.index);
    if (input.checked) imports.selected.add(index);
    else imports.selected.delete(index);
    form.querySelector('[type="submit"]').disabled = !checkedCandidateIndices(form).length || !canWrite();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    saveCandidates(checkedCandidateIndices(form)).catch(fail);
  });
}
function discardCandidates() {
  if (!imports.entries.length || !confirm('放弃剩余待校对票据？')) return;
  imports.entries = [];
  imports.selected.clear();
  imports.batch = false;
  closeModal(true);
  render();
}
async function saveCandidates(indices) {
  if (state.saving) return;
  if (!indices.length) return toast('请先选择要保存的票据', true);
  const records = indices.map(index => imports.entries[index].record);
  for (const record of records) validateTicketForm(record);
  const form = modalRoot.querySelector('[data-candidate-review]');
  const release = form ? freezeForm(form, '保存中…') : () => {};
  const context = archiveContext();
  imports.review = 'saving';
  try {
    const result = await persist(records, { candidates: true });
    if (!isArchiveContext(context)) return;
    const saved = new Set(indices);
    const remaining = [], selection = new Set();
    imports.entries.forEach((entry, index) => {
      if (saved.has(index)) return;
      if (imports.selected.has(index)) selection.add(remaining.length);
      remaining.push(entry);
    });
    imports.entries = remaining;
    imports.selected = selection;
    closeModal(true);
    if (remaining.length) {
      render();
      reviewCandidates();
    } else {
      imports.batch = false;
      navigate('archive');
    }
    toast(savedMessage(`已新增 ${result.added} 张，补充 ${result.enriched} 张票据`));
  } finally {
    if (imports.review === 'saving') imports.review = 'reviewing';
    release(); applyAccessPolicy();
  }
}
function reviewFullBackup(backup, context) {
  const count = backup.records.filter(record => !record.deleted).length;
  openModal(modalHead('导入 JSON 备份', '票据将合并到当前票库，个人资料和飞常准 MCP 设置将以备份为准。') +
    `<form class="detail-body" data-backup-restore><p>${count} 张票据</p><p class="form-error" role="alert"></p><div class="reset-actions"><button type="button" class="button secondary" data-action="discard-uploaded-backup">取消</button><button class="button primary" type="submit">恢复票库和设置</button></div></form>`);
  const form = modalRoot.querySelector('[data-backup-restore]');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.saving || !isArchiveContext(context)) return;
    const release = freezeForm(form, '正在恢复…');
    try {
      await persist(backup.records, { candidates: true, settings: backup.settings });
      if (!isArchiveContext(context)) return;
      imports.backup = null;
      state.profileDraft = null; state.profileBase = null; state.profileDirty = false; state.flightKeyDraft = null;
      closeModal(true);
      render();
      toast(savedMessage('已恢复票库和设置'));
      if (isArchiveContext(context)) {
        backupRestoreOffer = state.syncMeta.pending
          ? { ...context, revision: state.syncMeta.revision, connections: backup.connections } : null;
        if (!backupRestoreOffer) offerBackupConnection(backup.connections);
        renderSyncState();
      }
    } catch (error) { form.querySelector('.form-error').textContent = error.message; }
    finally { release(); }
  });
}
function isArchiveContext(context) {
  return context.epoch === authEpoch && context.binding === activeBinding(state) &&
    context.generation === (state.syncMeta.generation || '');
}
function missingBackupConnection(connections) {
  if (!state.d1 && state.config?.id && connections.d1) return 'd1';
  if (state.d1 && !state.config?.id && connections.github) return 'github';
  return '';
}
function backupRestoreMarkup() {
  if (!backupRestoreOffer) return '';
  const provider = missingBackupConnection(backupRestoreOffer.connections);
  if (state.syncMeta.pending) {
    return `<p class="import-status" role="status">备份已导入，等待同步。${provider ? '同步后可以添加备份中的连接。' : ''}</p>`;
  }
  if (!provider) return '';
  const name = provider === 'd1' ? 'Cloudflare D1' : 'GitHub';
  return `<div class="button-row"><button type="button" class="button secondary" data-action="continue-backup-restore">添加备份中的 ${name} 连接</button></div>`;
}
function continueBackupRestore() {
  const offer = backupRestoreOffer;
  if (!offer || state.syncMeta.pending || !isArchiveContext(offer)) return;
  backupRestoreOffer = null;
  offerBackupConnection(offer.connections);
  renderSyncState();
}
function offerBackupConnection(connections) {
  const missing = missingBackupConnection(connections);
  if (!missing) return;
  const name = missing === 'd1' ? 'Cloudflare D1' : 'GitHub';
  const target = connections[missing];
  const context = { binding: activeBinding(state), generation: state.syncMeta.generation || '', epoch: authEpoch };
  const label = missing === 'd1' ? target.url : target.owner + '/' + target.repo;
  openModal(modalHead('是否添加 ' + name + ' 连接', e(label)) +
    '<div class="detail-body"><div class="reset-actions"><button type="button" class="button secondary" data-action="close-modal">跳过</button><button type="button" class="button primary" data-connect-from-backup>继续连接</button></div></div>');
  modalRoot.querySelector('[data-connect-from-backup]').addEventListener('click', () => {
    if (!isArchiveContext(context) || state.syncMeta.pending || missingBackupConnection(connections) !== missing) { closeModal(true); return; }
    if (missing === 'd1') state.d1Draft = { ...target, target };
    else state.connectionDraft = { ...target, target };
    closeModal(true);
    navigate('data');
    const form = root.querySelector(missing === 'd1' ? '#d1-form' : '#github-form');
    form?.scrollIntoView?.({ block: 'center' });
    form?.querySelector(target.token ? '[type="submit"]' : '[name="token"]')?.focus();
  });
}
async function connectCloud(form, errorKey, action) {
  if (state.connecting || state.saving || state.githubBackingUp || state.resetting || state.archiveResetProgress) return false;
  state.connecting = true;
  state[errorKey] = '';
  const release = freezeForm(form, '连接中…');
  try {
    if (!navigator.onLine) throw new Error('请联网后连接云端票库');
    return await withCloudLock(action);
  } catch (error) { state[errorKey] = error.message; return false; }
  finally { state.connecting = false; release(); render(); }
}
async function chooseBindingSource(github, d1, d1Snapshot) {
  const [githubPreview, d1Preview] = await Promise.all([github.read(), d1Snapshot ?? d1.read()]);
  assertLinkTargets(github, d1, githubPreview, d1Preview);
  const previews = { githubSnapshot: githubPreview, d1Snapshot: d1Preview };
  if (hasCloudLink(github, d1, githubPreview, d1Preview)) return publishCloudLink(github, d1, previews);
  const count = snapshot => snapshot.records.filter(record => !record.deleted).length;
  const repo = github.config.owner + '/' + github.config.repo;
  const source = await new Promise(resolve => {
    openModal(modalHead('选择保留哪边的票库') +
      `<form id="archive-source-form" class="detail-body"><fieldset class="conflict"><legend>作为数据来源</legend>
        <label><input type="radio" name="archive-source" value="github" required /><span><strong>GitHub · ${count(githubPreview)} 张</strong><small>${e(repo)}</small></span></label>
        <label><input type="radio" name="archive-source" value="d1" required /><span><strong>Cloudflare D1 · ${count(d1Preview)} 张</strong><small>${e(d1.config.url)}</small></span></label>
      </fieldset><div class="reset-actions"><button type="button" class="button secondary" data-action="close-modal">取消</button><button type="submit" class="button primary">继续</button></div></form>`);
    const form = modalRoot.querySelector('#archive-source-form');
    modalCancel = () => resolve(null);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const choice = form.elements['archive-source'].value;
      if (!choice) return;
      modalCancel = null;
      closeModal(true);
      resolve(choice);
    });
  });
  if (!source) return null;
  const fromGitHub = source === 'github';
  const name = fromGitHub ? 'GitHub' : 'D1';
  const destination = fromGitHub ? 'D1' : 'GitHub';
  const details = fromGitHub ? d1.config.url : repo;
  if (!await requireArithmetic('确认覆盖 ' + destination,
    `用 ${name} 的票据、个人资料、MCP 和账号设置覆盖 ${details} 的行迹数据。两套连接凭证会保存在两边，并留在 Git 历史中。绑定后由 D1 日常同步，GitHub 可手动备份。`, '覆盖并绑定')) return null;
  return bindArchivePair(github, d1, source, previews);
}

async function restoreLinkedD1(captured, github, snapshot) {
  if (captured.d1 || !snapshot?.settings?.connections?.d1) return false;
  const link = pairedD1(snapshot, github.config);
  if (!link) throw new Error('GitHub 票库中的 D1 绑定与此仓库身份不符，请直接登录 D1。');
  if (captured.meta.pending) throw new Error('此 GitHub 仓库已绑定到 D1。请先导出本机待确认的修改，再重新登录。');
  const { token: credential, ...config } = link;
  let remote;
  try {
    if (!credential) throw new Error('缺少 D1 凭证');
    remote = await new D1Store(config, credential, fetch, { signal: github.signal }).read();
  } catch (error) {
    throw new Error('GitHub 已与 D1 绑定，但暂时无法连接 D1。' + error.message);
  }
  if (wasUnlinked(remote)) throw new Error('D1 关联已解除，请直接登录 D1。');
  assertLinkTargets(github, { config }, snapshot, remote);
  useSnapshot(await activateD1(captured, config, remote, {
    credential, github, cloudLinkReady: !!sameGitHubAccount(pairedGitHub(remote, config), github.config)
  }));
  state.connectionStatus = 'online';
  state.resetRequest = null;
  state.d1Replacement = null;
  state.pendingConflicts = [];
  announce();
  return true;
}

async function readPrimaryGitHub(captured, github) {
  const index = await github.readArchiveIndex();
  if (await restoreLinkedD1(captured, github, index.snapshot)) return null;
  return github.read(index);
}

async function restoreLinkedGitHub(d1, snapshot) {
  const link = pairedGitHub(snapshot, d1.config);
  if (!link) return null;
  const { token: secret, ...config } = link;
  const github = new GitHubStore(config, secret);
  try {
    if (!secret) throw new Error('缺少 GitHub 凭证');
    await github.verify();
    const { snapshot: repo } = await github.readArchiveIndex();
    assertLinkTargets(github, d1, repo, snapshot);
    return github;
  } catch (error) {
    state.githubError = 'D1 已连接，GitHub 备份需要重新登录。' + error.message;
    return { config, token: '' };
  }
}

async function recoverGitHubBackup(captured, d1, remote) {
  if (captured.config || state.config || !pairedGitHub(remote, d1.config)) return;
  const github = await restoreLinkedGitHub(d1, remote);
  useSnapshot(await bindRepository(github.config, captured.d1, github.token, true));
  announce();
}
async function completeExistingCloudLink() {
  if (!state.d1 || !state.config?.id || !d1Token() || !token() || state.syncMeta.pending || state.archiveResetProgress) return;
  try {
    const updated = await withCloudLock(async () => {
      const captured = await readSyncState();
      if (!state.d1 || !captured.d1 || !captured.config?.id || !token() || !d1Token() || captured.meta.pending || captured.archiveResetProgress ||
          state.saving || state.resetting || state.connecting || await db.get('cloudLinkReady', false)) return false;
      const github = new GitHubStore(clone(captured.config), token());
      const archive = await publishCloudLink(github, new D1Store(captured.d1, d1Token()));
      if (archive.head === captured.meta.head && archive.generation === (captured.meta.generation || '')) {
        await db.set('cloudLinkReady', true);
        return false;
      }
      useSnapshot(await activateD1(captured, captured.d1, archive, { cloudLinkReady: true }));
      state.connectionStatus = 'online';
      announce();
      return true;
    });
    if (updated) renderSyncState();
  } catch {
    // A device can keep using D1 when its backup cannot be reached.
  }
}
async function connectGitHub(event) {
  event.preventDefault();
  if (token()) return;
  const form = event.target;
  captureConnectionDraft(form);
  const { owner, repo, token: secretInput, target } = state.connectionDraft;
  const secret = secretInput.trim();
  const attached = await connectCloud(form, 'githubError', async () => {
    const captured = await readSyncState({ session: true });
    if (captured.credentials.github) return false;
    const verifiedTarget = target?.owner === owner.trim() && target?.repo === repo.trim() ? { id: target.id, branch: target.branch } : {};
    const config = { ...(captured.config || verifiedTarget), owner: owner.trim(), repo: repo.trim() };
    const github = new GitHubStore(config, secret);
    await github.verify();
    if (captured.d1 && !captured.config?.id) {
      if (!d1Token() || captured.meta.pending) throw new Error('请先连接并同步 D1 票库');
      const remote = await chooseBindingSource(github, new D1Store(captured.d1, d1Token()));
      if (!remote) return false;
      useSnapshot(await activateD1(captured, captured.d1, remote, { github, cloudLinkReady: true }));
      clearArchiveView();
      state.d1Replacement = null;
      state.connectionStatus = 'online';
      toast('已绑定两边票库，日常同步使用 D1');
    } else {
      if (!captured.d1) {
        const { snapshot } = await github.readArchiveIndex();
        if (await restoreLinkedD1(captured, github, snapshot)) {
          state.connectionDraft = null;
          toast('已连接 GitHub 和关联的 D1 票库');
          return true;
        }
      }
      useSnapshot(await bindRepository(config, captured.d1, secret, captured.d1 ? false : undefined));
    }
    state.connectionDraft = null;
    announce();
    return true;
  });
  if (attached && !state.d1) await doSync();
  else if (attached) await completeExistingCloudLink();
}
async function connectD1(form) {
  if (d1Token()) return;
  const { url, token: secretInput, target } = state.d1Draft;
  const secret = secretInput.trim();
  const attached = await connectCloud(form, 'd1Error', async () => {
    const captured = await readSyncState({ session: true });
    if (captured.credentials.d1) return false;
    const address = workerURL(url.trim());
    if (captured.d1 && captured.d1.url !== address) throw new Error('本机票库已绑定其他 D1 地址');
    if (!secret || /\s/.test(secret)) throw new Error('请填写部署 Worker 时设置的访问凭证');
    const config = { url: address, id: captured.d1?.id ?? (target?.url === address ? target.id : undefined) };
    const d1 = new D1Store(config, secret);
    let remote = await d1.read();
    config.id = remote.id;
    if (!captured.d1 && captured.config?.id) {
      if (captured.meta.pending) throw new Error('请先同步 GitHub 中的待提交修改，再切换到 D1');
      if (!token()) throw new Error('请先登录 GitHub，以读取要迁移的票库');
      const github = new GitHubStore(clone(captured.config), token());
      await github.verify();
      remote = await chooseBindingSource(github, d1, remote);
      if (!remote) return false;
    }
    if (captured.d1) {
      await db.setMany([['d1Token', secret], ['cloudLinkReady', false]]);
      credentials.d1 = secret;
    } else {
      const github = captured.config ? null : await restoreLinkedGitHub(d1, remote);
      const cloudLinkReady = !!(captured.config || github);
      useSnapshot(await activateD1(captured, config, remote, { credential: secret, github, cloudLinkReady }));
      clearArchiveView();
      state.d1Replacement = null;
    }
    state.d1Draft = null;
    state.resetRequest = null;
    state.pendingConflicts = [];
    state.connectionStatus = 'checking';
    announce();
    return true;
  });
  if (attached) { await doSync(); await completeExistingCloudLink(); render(); }
}
async function backupGitHub() {
  if (!state.d1 || !state.config?.id || !token() || !canWrite() || state.saving || state.githubBackingUp) return;
  const { d1, config } = state;
  state.githubBackingUp = true; render();
  try {
    const { changed } = await withCloudLock(async () => {
      const captured = await readSyncState();
      if (activeBinding(captured) !== activeBinding({ d1, config }) || !sameGitHubAccount(captured.config, config) || captured.meta.pending || captured.archiveResetProgress || !canWrite() || state.saving) throw new Error('云端状态已变化，请重新发起备份');
      const result = await backUpToGitHub(new D1Store(d1, d1Token()), new GitHubStore(clone(config), token()));
      githubBackupReceipt = { pair: githubBackupPair(d1, config), head: result.sourceHead, generation: result.generation || '', at: now() };
      try { await db.set('githubBackupReceipt', githubBackupReceipt); announce(); }
      catch { toast('备份已确认，本机未能记录备份时间', true); }
      return result;
    });
    toast(changed ? '已将 D1 票库备份到 GitHub' : 'GitHub 已有相同的备份');
  } catch (error) { fail(error); }
  finally { state.githubBackingUp = false; render(); }
}
function clearArchiveView() {
  pageScroll.clear();
  backupRestoreOffer = null;
  closeModal(true);
  imports.clear();
  archiveSelected.clear();
  Object.assign(state, {
    profileDraft: null, profileBase: null, profileDirty: false, profileError: '',
    flightKeyDraft: null, flightResult: null, flightResultYear: null, settingsError: '',
    filters: searchOptions(), syncMessage: '',
    pendingConflicts: [], resetRequest: null, d1Draft: null, d1Error: '', connectionStatus: 'auth'
  });
  resetPromptHead = '';
}
function invalidateCloudSession() {
  authEpoch++;
  clearImportedWork();
  syncAbort?.abort();
  clearTimeout(syncTimer);
  state.connectionStatus = 'auth';
  state.syncMessage = '';
}
function clearSignedOutArchive() {
  clearArchiveView();
  state.connectionDraft = null;
  state.githubError = '';
  state.showDemo = false;
  state.d1Replacement = null;
}
async function clearCloudSession() {
  useSnapshot(await signOutCloud());
  clearSignedOutArchive();
  announce({ clearView: true });
}
async function disconnectCloud() {
  if (state.connecting || state.saving || state.resetting || state.githubBackingUp) return;
  const paired = bothClouds();
  const pending = state.syncMeta.pending ? '待同步的修改也会从本机清除。' : '';
  if (!window.confirm((paired ? '退出 GitHub 和 D1？' : '退出登录？') + '本机会清除票库缓存。' + pending)) return;
  invalidateCloudSession();
  await withCloudLock(clearCloudSession);
  render();
  toast(paired ? '已退出两个账号并清除本机缓存' : '已退出，本机票库已清空');
}
async function doSync(resolutions = {}, { retryRejected = false } = {}) {
  if (state.resetting || state.archiveResetProgress) return false;
  if (syncPromise) return syncPromise;
  if (!hasCloud() || !cloudToken()) { state.connectionStatus = 'auth'; renderSyncState(); return false; }
  if (state.syncMeta.rejection && !retryRejected) {
    state.connectionStatus = 'rejected';
    renderSyncState();
    return false;
  }
  if (!navigator.onLine) {
    if (state.connectionStatus === 'checking') state.connectionStatus = state.syncMeta.verified ? 'online' : 'offline';
    renderSyncState();
    return false;
  }
  const epoch = authEpoch, binding = activeBinding(state);
  const run = async () => {
    state.syncing = true; state.syncMessage = ''; renderSyncState();
    let retryAt = 0, needsRetry = false, captured;
    try {
      if (epoch !== authEpoch) return false;
      syncAbort = new AbortController();
      captured = await readSyncState();
      if (captured.archiveResetProgress) { useSnapshot(captured); return false; }
      if (activeBinding(captured) !== binding) { useSnapshot(captured); needsRetry = true; return false; }
      if (captured.meta.rejection && !retryRejected) {
        useSnapshot(captured);
        state.connectionStatus = 'rejected';
        return false;
      }
      const { d1, meta } = captured;
      const signal = syncAbort.signal;
      const cached = meta.verified ? { id: d1?.id, records: captured.base, settings: captured.settingsBase, head: meta.head, generation: meta.generation || '' } : null;
      const store = d1 ? new D1Store(d1, d1Token(), fetch, { signal, cached }) : new GitHubStore(clone(captured.config), token(), fetch, { signal });
      const needsMerge = meta.pending || !meta.verified || Object.keys(resolutions).length > 0;
      let result;
      if (!d1) {
        await store.verify();
        if (!needsMerge && await store.head() === meta.head) {
          if (await restoreLinkedD1(captured, store, cached)) return true;
          result = { ...cached, conflicts: [] };
        }
      }
      if (!result) for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const remoteSnapshot = d1 ? await store.read() : await readPrimaryGitHub(captured, store);
          if (epoch !== authEpoch) return false;
          if (!remoteSnapshot) return true;
          if (d1) {
            const generationChanged = remoteSnapshot.generation !== (meta.generation || '');
            if (!generationChanged) await recoverGitHubBackup(captured, store, remoteSnapshot);
            if (!needsMerge) {
              if (generationChanged) throw new ArchiveResetError(remoteSnapshot, true);
              result = { ...remoteSnapshot, conflicts: [] };
              break;
            }
          }
          result = await synchronize(store, captured.base, captured.records, resolutions, {
            baseHead: meta.head, baseGeneration: meta.generation || '', baseSettings: captured.settingsBase,
            localSettings: captured.settings, remoteSnapshot
          });
          break;
        } catch (error) {
          if (attempt >= 2 || ![409, 422].includes(error.status)) throw error;
        }
      }
      if (result.conflicts.length) { state.pendingConflicts = result.conflicts; state.connectionStatus = 'conflict'; return false; }
      if (epoch !== authEpoch) return false;
      const accepted = await acknowledgeSync(captured, result); useSnapshot(accepted);
      needsRetry = !!accepted.retry; state.connectionStatus = accepted.retry ? 'checking' : navigator.onLine ? 'online' : 'offline'; state.pendingConflicts = []; state.resetRequest = null; state.d1Replacement = null; syncFailures = 0; if (accepted.changed) announce();
      return !accepted.retry;
    } catch (error) {
      if (epoch !== authEpoch) return false;
      if (captured?.meta.pending && (error.writeRejected || error.code === 'DUPLICATE_RAIL_TICKET')) {
        try {
          const rejected = await rejectPendingChange(captured, error.message);
          if (epoch !== authEpoch) return false;
          useSnapshot(rejected);
          if (rejected.meta.rejection) {
            state.connectionStatus = 'rejected';
            announce();
            return false;
          }
        } catch (storageError) { error = storageError; }
      }
      if (captured?.d1 && error.code === 'ARCHIVE_RESET') {
        if (captured.config && wasUnlinked(error.snapshot)) {
          if (captured.meta.pending || state.saving || editor?.dirty || state.profileDirty) {
            state.connectionStatus = 'auth';
            state.syncMessage = '两边的关联已解除。请先导出本机待确认的修改，再退出并重新登录。';
          } else {
            invalidateCloudSession();
            await clearCloudSession();
            toast('仓库关联已解除，请重新选择要登录的票库');
          }
          return false;
        }
        if (!captured.meta.pending) {
          try {
            await recoverGitHubBackup(captured, new D1Store(captured.d1, d1Token()), error.snapshot);
            useSnapshot(await activateD1(captured, captured.d1, error.snapshot));
            Object.assign(state, { connectionStatus: 'online', pendingConflicts: [], d1Replacement: null, syncMessage: '' });
            announce();
            return true;
          } catch (localError) { error = localError; }
        } else state.d1Replacement = error.snapshot.head;
      }
      state.connectionStatus = !cloudToken() || ([401, 403].includes(error.status) && !error.retryAt) ? 'auth' : 'offline';
      state.syncMessage = error.message; retryAt = error.retryAt || 0; syncFailures++;
      if (!captured?.d1 && ['ARCHIVE_FILES_MISSING', 'ARCHIVE_RESET'].includes(error.code)) { state.resetRequest = error; queueMicrotask(() => { if (!modalRoot.querySelector('dialog') && resetPromptHead !== error.snapshot.head) { resetPromptHead = error.snapshot.head; showArchiveReset().catch(fail); } }); }
      return false;
    } finally {
      state.syncing = false; renderSyncState();
      if (state.syncMeta.pending && !['conflict', 'auth'].includes(state.connectionStatus)) {
        const delay = needsRetry || state.connectionStatus === 'online' ? 250
          : Math.max(retryAt - Date.now(), Math.min(120000, 5000 * 2 ** Math.min(syncFailures, 5)));
        queueSync(delay);
      }
    }
  };
  syncPromise = withCloudLock(run);
  try { return await syncPromise; } finally { syncPromise = null; }
}
async function discardRejectedChanges() {
  if (!state.syncMeta.rejection || state.syncing || state.saving ||
      !confirm('撤回本机待同步的修改？票夹会恢复到上次确认的版本。')) return;
  const captured = { config: state.config, d1: state.d1, meta: state.syncMeta };
  await withCloudLock(async () => {
    const snapshot = await discardRejectedChange(captured);
    backupRestoreOffer = null;
    useSnapshot(snapshot);
    state.connectionStatus = 'checking';
    announce({ discardedChange: { binding: activeBinding(snapshot), revision: snapshot.meta.revision } });
  });
  render();
  await doSync();
}
let resetPromptHead = '';
async function showArchiveReset(manual = false) {
  if (state.archiveResetProgress) return showResetResume();
  if ((!manual && state.d1) || state.resetting || state.connecting || state.saving || state.githubBackingUp ||
      modalRoot.querySelector('[data-reset-preparing],[data-archive-reset]')) return;
  if (!navigator.onLine) return toast('请先恢复网络连接再重置', true);
  const title = manual ? '重置仓库' : '采用新票库';
  openModal(modalHead(title) + '<div class="detail-body" data-reset-preparing><p class="operation-status" role="status">' +
    icon('refresh', 'spin') + '正在读取仓库状态…</p><p class="form-error" role="alert" data-reset-prepare-error></p><button class="button secondary" data-action="close-modal">取消</button></div>');
  const preparing = modalRoot.querySelector('[data-reset-preparing]');
  let captured, request, github, d1;
  try {
    captured = await readResetState();
    if (captured.archiveResetProgress) {
      useSnapshot(captured);
      if (preparing.isConnected) showResetResume();
      return;
    }
    if (!captured.config?.id && !captured.d1) throw new Error('请先连接票库再重置');
    if (captured.config?.id) {
      const secret = captured.credentials.github;
      if (!secret) throw new Error('请先登录 GitHub，再重置已绑定的票库');
      github = new GitHubStore(clone(captured.config), secret);
    }
    if (captured.d1) {
      const secret = captured.credentials.d1;
      if (!secret) throw new Error('请先登录 D1，再重置已绑定的票库');
      d1 = new D1Store(captured.d1, secret);
    }
    request = manual ? await prepareArchiveReset(github, d1, captured.settings) : state.resetRequest;
    if (!preparing.isConnected) return;
    if (!request) { closeModal(true); return; }
  } catch (error) {
    if (preparing.isConnected) {
      preparing.querySelector('[role="status"]').textContent = '暂时无法读取票库';
      preparing.querySelector('[data-reset-prepare-error]').textContent = error.message;
    }
    return;
  }

  const challenge = createArithmeticChallenge(), remoteReset = request.code === 'ARCHIVE_RESET';
  openModal(modalHead(remoteReset ? '采用新票库' : title) + archiveResetMarkup(request, captured, challenge));
  const form = modalRoot.querySelector('[data-archive-reset]'), submit = form.querySelector('[type="submit"]');
  let d1ResetId;
  const unlinkOption = form.elements['unlink-clouds'], keepOptions = form.querySelector('[data-keep-cloud]');
  unlinkOption?.addEventListener('change', () => {
    keepOptions.hidden = keepOptions.disabled = !unlinkOption.checked;
  });
  form.elements['confirm-reset'].addEventListener('change', event => { submit.disabled = !event.target.checked; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.elements['confirm-reset'].checked || state.resetting || state.connecting || state.saving || state.githubBackingUp) return;
    if (!checkArithmeticAnswer(challenge, form.elements['arithmetic-answer'].value)) {
      form.querySelector('[data-arithmetic-error]').textContent = '答案不正确，请重新计算';
      return;
    }
    const prior = state.archiveResetProgress;
    const unlink = prior?.unlink ?? !!unlinkOption?.checked;
    const keep = prior?.keep ?? form.elements['keep-cloud']?.value;
    if (unlink && !['github', 'd1'].includes(keep)) return;
    await runArchiveReset(form, async () => {
      const current = await readResetState();
      if (!sameArchiveBaseline(current, captured) || github && current.credentials.github !== github.token ||
          d1 && current.credentials.d1 !== d1.token) {
        throw new Error('本机数据已变化，请关闭窗口后重新确认');
      }
      if (current.archiveResetProgress?.id !== prior?.id) throw new Error('另一标签页已开始重置，请关闭窗口后继续');
      if (github && d1) {
        const progress = current.archiveResetProgress || await createPairedReset(request, captured, unlink, keep);
        if (!prior) await recordResetProgress(progress, null, captured);
        return finishPairedReset(progress, current);
      }
      let accepted;
      if (remoteReset) {
        await github.verify();
        const remote = await github.read();
        if (remote.head !== request.snapshot.head) throw new Error('新票库已有变化，请重新确认');
        accepted = await replaceWithRemote(captured, remote);
      } else if (d1) {
        let latest = await d1.read();
        const before = request.d1Snapshot;
        if (latest.head === before.head) {
          d1ResetId ||= crypto.randomUUID();
          latest = await d1.replace(before, [], before.settings, { resetId: d1ResetId });
        } else if (!d1ResetId || latest.head !== d1ResetId || latest.generation !== d1ResetId ||
            latest.records.length || !sameSettings(latest.settings, before.settings)) {
          throw new Error('D1 票库已有变化，请关闭窗口后重新确认');
        }
        accepted = await activateD1(captured, captured.d1, latest);
      } else {
        const reset = await github.resetRepository(request.snapshot.head, captured.settings);
        accepted = await replaceWithRemote(captured, reset);
      }
      return { accepted, remoteReset };
    });
    const progress = state.archiveResetProgress;
    if (progress && unlinkOption) {
      unlinkOption.checked = progress.unlink;
      unlinkOption.disabled = true;
      if (keepOptions) keepOptions.disabled = true;
    }
  });
}

async function recordResetProgress(progress, previous, captured) {
  await saveArchiveResetProgress(progress, previous, captured);
  state.archiveResetProgress = progress;
  announce();
}

async function finishPairedReset(progress, captured) {
  if (!matchesResetPair(progress, captured) || !captured.credentials.github || !captured.credentials.d1) {
    throw new Error('无法核对原来的两个仓库，请放弃续接后重新连接。');
  }
  const github = new GitHubStore(clone(captured.config), captured.credentials.github);
  const d1 = new D1Store(captured.d1, captured.credentials.d1);
  const result = await continuePairedReset(github, d1, progress, recordResetProgress);
  const { unlink, keep, id } = progress;
  const accepted = unlink
    ? await keepUnlinkedArchive(captured, keep, result[keep], (keep === 'd1' ? d1 : github).token, id)
    : await activateD1(captured, captured.d1, result.d1, { resetId: id });
  return { accepted, unlink, keep };
}

async function runArchiveReset(form, execute) {
  if (state.resetting || state.connecting || state.saving || state.githubBackingUp) return;
  if (!navigator.onLine) return toast('请先恢复网络连接再重置', true);
  state.resetting = true;
  invalidateCloudSession();
  const error = form.querySelector('[data-reset-error]');
  error.textContent = '';
  const release = freezeForm(form, '重置中…');
  try {
    if (syncPromise) await syncPromise;
    const { accepted, unlink, keep, remoteReset } = await withCloudLock(execute);
    useSnapshot(accepted);
    clearArchiveView();
    state.connectionDraft = null;
    state.githubError = '';
    Object.assign(state, {
      mapView: { layers: ['airway', 'railway'], year: 'all' }, limit: 48,
      connectionStatus: 'online', showDemo: false, d1Replacement: null
    });
    announce({ clearView: true });
    navigate('archive');
    toast(unlink ? '已完成重置和解除关联，继续使用 ' + (keep === 'd1' ? 'D1' : 'GitHub')
      : remoteReset ? '已采用新票库并清理旧数据' : '仓库已重置，个人资料和 MCP 设置已保留');
  } catch (failure) {
    if (form.isConnected) {
      const step = state.archiveResetProgress?.step;
      const status = step && step !== 'github' && step !== 'adopt' ? 'GitHub 已重置，D1 重置尚未确认。' : '';
      error.textContent = status + failure.message;
    }
  } finally {
    state.resetting = false;
    release();
    render();
  }
}

function showResetResume() {
  const progress = state.archiveResetProgress;
  if (!progress || state.resetting || state.showDemo) return;
  const keep = progress.keep === 'd1' ? 'Cloudflare D1' : 'GitHub';
  const description = progress.unlink ? '重置并解除关联，继续使用 ' + keep + '。' : '重置 GitHub 和 D1，保留关联。';
  openModal(modalHead('继续重置', description) + `<form class="detail-body" data-reset-resume>
    <p class="form-error" role="alert" data-reset-error></p><div class="reset-actions">
    <button class="text-button" type="button" data-action="abandon-archive-reset">放弃续接</button>
    <button class="button secondary" type="button" data-action="close-modal">关闭</button>
    <button class="button danger" type="submit">继续重置</button></div></form>`);
  const form = modalRoot.querySelector('[data-reset-resume]');
  form.addEventListener('submit', event => {
    event.preventDefault();
    runArchiveReset(form, async () => {
      const current = await readResetState();
      if (current.archiveResetProgress?.id !== progress.id) throw new Error('重置进度已变化，请关闭窗口后重新核对');
      return finishPairedReset(current.archiveResetProgress, current);
    });
  });
}

async function abandonArchiveReset() {
  const progress = state.archiveResetProgress;
  if (!progress || state.resetting || !confirm('放弃续接？已经完成的云端重置会保留。')) return;
  await withCloudLock(() => recordResetProgress(null, progress));
  closeModal(true);
  render();
  await doSync();
}

async function adoptD1Replacement() {
  const head = state.d1Replacement;
  if (!head || !d1Token() || !navigator.onLine || state.connecting || state.resetting) return;
  if (!await requireArithmetic('采用 D1 新票库', 'D1 票库已被替换。采用后会清除本机尚未同步的旧修改。', '采用新票库')) return;
  await withCloudLock(async () => {
    const captured = await readSyncState();
    if (!captured.d1) throw new Error('D1 连接已变化，请重新核对');
    const remote = await new D1Store(captured.d1, d1Token()).read();
    if (remote.head !== head) throw new Error('D1 票库已变化，请重新核对');
    useSnapshot(await activateD1(captured, captured.d1, remote));
  });
  state.d1Replacement = null;
  announce();
  await doSync();
  render();
}
function showConflicts(conflicts) {
  state.pendingConflicts = conflicts;
  const valueText = (value, field) => field === 'railJourney' ? value ? `${value.query?.startDate || ''} 始发 · ${value.stops?.length || 0} 个全程站点 · ${(value.trainsets || []).map(stock=>stock.id).join(' / ') || '具体车组未收录'}` : '未收录' : field === 'ticketMarks' ? describeMarks(value) : field === 'deleted' ? value ? '删除票据' : '保留票据' : String(value || '（空白）');
  const conflictValue = (value, field) => field === 'connections' ? (value ? '访问凭证已隐藏' : '未收录') : field === 'flightMcpKey' ? e(maskedKey(value)) : field === 'profile' ? `<span class="profile-conflict">${e(personalProfileSummary(value))}</span>` : ['ticketCode', 'boardingCode'].includes(field) ? value ? renderCodeData(value, { className: 'conflict-code' }) : '未收录' : e(valueText(value, field));
  const settingLabels = { profile: '个人常用资料', flightMcpKey: '飞常准 MCP Key', connections: '云端账号设置' };
  openModal(modalHead('两台设备修改了同一处', '选择你要保留的内容。未选择之前，不会覆盖远端票库。') + `<form id="conflict-form"><div class="conflicts">${conflicts.map((c, i) => { const r = c.context ? (c.local ? c.context.remote : c.context.local) : state.records.find(r => r.id === c.id); return `<fieldset class="conflict"><legend>${c.kind === 'settings' ? settingLabels[c.field] : e(r?.service) + ' ' + e(r?.origin) + ' → ' + e(r?.destination) + ' · ' + e(labels[c.field])}</legend><label><input type="radio" name="conflict-${i}" value="local" required /><span><small>本机</small>${conflictValue(c.local, c.field)}</span></label><label><input type="radio" name="conflict-${i}" value="remote" required /><span><small>私有仓库</small>${conflictValue(c.remote, c.field)}</span></label></fieldset>`; }).join('')}</div><div class="modal-footer"><button class="button secondary" type="button" data-action="close-modal">稍后处理</button><div class="spacer"></div><button class="button primary" type="submit">保留所选并同步</button></div></form>`);
  document.querySelector('#conflict-form').addEventListener('submit', event => {
    event.preventDefault(); const data = new FormData(event.target); const resolutions = {};
    conflicts.forEach((c, i) => { resolutions[`${c.id}:${c.field}`] = { choice: data.get(`conflict-${i}`), local: c.local, remote: c.remote, context: c.context }; });
    closeModal(true); doSync(resolutions);
  });
}
async function saveFlightSettings(event) {
  event.preventDefault(); state.settingsError = '';
  if (!canWrite() || state.saving) { state.settingsError = '请先恢复云端连接再保存设置'; render(); return; }
  const form = event.target, secret = String(new FormData(form).get('key') || '').trim(), expected = clone(state.settings);
  const { config, d1 } = state;
  state.flightKeyDraft = secret; state.saving = true;
  const release = freezeForm(form);
  try {
    const proposed = sharedSettings({ ...expected, flightMcpKey: secret });
    await verifyBeforeWrite('云端核对未完成，Key 尚未提交');
    useSnapshot(await withCloudLock(() => stageSettings(expected, proposed, config, d1))); announce();
    await doSync(); state.flightKeyDraft = null; toast(savedMessage('连接设置已同步'));
  } catch (error) { state.settingsError = error.message; }
  finally { state.saving = false; release(); render(); }
}
async function savePersonalProfile(event) {
  event.preventDefault(); state.profileError = '';
  if (!canWrite() || state.saving) { state.profileError = '请先恢复云端连接再保存资料'; render(); return; }
  const form = event.target, expected = clone(state.profileBase || state.settings);
  const { config, d1 } = state;
  state.profileDraft = collectPersonalProfile(form); state.profileDirty = true;
  state.saving = true; const release = freezeForm(form);
  try {
    const proposed = sharedSettings({ ...expected, profile:personalProfile(state.profileDraft) });
    await verifyBeforeWrite('云端核对未完成，个人资料尚未提交');
    useSnapshot(await withCloudLock(() => stageSettings(expected, proposed, config, d1))); announce();
    await doSync(); state.profileDraft = null; state.profileBase = null; state.profileDirty = false;
    toast(savedMessage('个人资料已同步'));
  } catch (error) { state.profileError = error.message; }
  finally { state.saving = false; release(); render(); }
}
async function checkFlights() {
  if (!supportsDesktopMcp()) return toast('请在电脑浏览器查询飞常准行程');
  if (!flightKey()) return;
  if (!navigator.onLine) return toast('请联网后查询历史行程', true);
  const task = startImport('flight');
  if (!task) return;
  const year = state.flightYear, key = flightKey();
  state.flightResult = null;
  if (state.page === 'data') render();
  try {
    const { FlightConnector } = await import('./mcp.js');
    if (!currentImport(task)) return;
    const result = await new FlightConnector(key).historyTrips(year);
    if (!await acceptsImport(task)) return;
    state.flightResult = result; state.flightResultYear = year;
    let payload = result.structuredContent;
    if (!payload) {
      const text = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
      try { payload = JSON.parse(text); } catch {}
    }
    if (payload?.kind === 'collection' && Array.isArray(payload.items) && !payload.items.length) {
      toast(`${year} 年未返回历史行程`);
    } else if (payload && (Array.isArray(payload) || Array.isArray(payload.flights))) {
      try {
        const candidates = mapFlightResult(payload);
        if (candidates.length) reviewImportCandidates(candidates, { batch: true, task });
        else toast(`${year} 年未返回历史行程`);
      } catch { toast('接口已返回内容，请查看并校对字段'); }
    } else toast('已取得接口返回；尚需核对结构，请在数据页查看');
  } catch (error) { if (currentImport(task) && !state.showDemo) fail(error); }
  finally { if (imports.finish(task) && root.isConnected && state.page === 'data' && !state.showDemo) render(); }
}
function showFlightResult() {
  const raw = JSON.stringify(state.flightResult, null, 2);
  openModal(modalHead(`${state.flightResultYear} 年历史行程返回`, '仅供本人校对，关闭后不会保存到票库。') + `<div class="detail-body"><pre class="raw-result">${e(raw)}</pre><p class="fine-print">查询结果不会自动入库。请核对后，在导入页识别并修订。</p></div><div class="modal-footer"><button class="button secondary" data-action="close-modal">关闭</button><button class="button primary" data-action="flight-to-import">将文字送往导入页</button></div>`);
}
const actions = {
  'profile-reload': () => { state.profileDraft = null; state.profileBase = null; state.profileDirty = false; state.profileError = ''; render(); },
  navigate: button => navigate(button.dataset.page),
  'toggle-routes': button => { state.routesOpen = !state.routesOpen; button.closest('.route-shortcuts-section').dataset.expanded = String(state.routesOpen); button.setAttribute('aria-expanded', String(state.routesOpen)); },
  filter: button => { state.filters.type = button.dataset.type; state.limit = 48; render(); },
  'load-more': loadMoreTickets,
  'reset-archive': () => showArchiveReset(),
  'reset-repository': () => showArchiveReset(true),
  'resume-archive-reset': showResetResume,
  'abandon-archive-reset': abandonArchiveReset,
  'continue-backup-restore': continueBackupRestore,
  'reset-filters': () => { state.filters = searchOptions(); state.limit = 48; render(); },
  'clear-search-field': button => { state.filters = clearSearchField(state.filters, button.dataset.field); state.limit = 48; render(); },
  'swap-route': () => { const f = state.filters; [f.originCity, f.destinationCity] = [f.destinationCity, f.originCity]; [f.origin, f.destination] = [f.destination, f.origin]; state.limit = 48; render(); },
  'quick-route': button => { state.filters = searchOptions({ ...state.filters, city: '', originCity: button.dataset.from, destinationCity: button.dataset.to, origin: '', destination: '', bothDirections: true }); state.limit = 48; render(); },
  'export-album': () => exportArchiveSelection('pdf'),
  'export-images': () => exportArchiveSelection('zip'),
  'delete-selected': async () => {
    const selected = selectedArchiveRecords();
    if (!selected.length || state.showDemo || !canWrite() || state.saving) return;
    if (!confirm('删除所选的 ' + selected.length + ' 张票据？删除后无法恢复。')) return;
    if (!await requireArithmetic('删除所选 '+selected.length+' 张票据') || !canWrite() || state.saving) return;
    const ids = new Set(selected.map(record => record.id)), records = clone(state.records), updatedAt = now();
    for (const record of records) if (ids.has(record.id) && !record.deleted) { record.deleted = true; record.updatedAt = updatedAt; }
    await persist(records); archiveSelected.clear(); render(); toast(savedMessage('所选票据已删除并同步'));
  },
  'enter-demo': async button => { button.disabled=true; try { await setDemoMode(true); navigate('archive'); } finally { button.disabled=false; } },
  'exit-demo': async () => { await setDemoMode(false); render(); },
  'scan-ticket': scanTicket,
  new: () => { if (!state.showDemo && closeModal() !== false) editRecord(); },
  view: button => viewRecord(button.dataset.id),
  edit: button => { const r = findRecord(button.dataset.id); if (r) editRecord(r); },
  'close-modal': () => closeModal(),
  'edit-candidate': button => {
    const index = Number(button.dataset.index), entry = imports.entries[index];
    if (entry) editRecord(entry.record, index);
  },
  'discard-candidates': discardCandidates,
  review: openCandidateReview,
  'review-uploaded-backup': openQueuedBackup,
  'discard-uploaded-backup': () => { imports.backup = null; closeModal(true); render(); },
  'parse-text': () => {
    const text = document.querySelector('#import-text').value.trim();
    if (!text) return toast('请先粘贴一段行程信息', true);
    const candidates = parseText(text);
    if (!candidates.length) return toast('没有识别到行程，请补充日期、车次或起终点，也可直接手动添加', true);
    reviewImportCandidates(candidates);
  },
  backup: () => download(JSON.stringify(fullBackup(state.records, state.settings, {
    github: state.config?.id ? { ...state.config, token: token() } : null,
    d1: state.d1?.id ? { ...state.d1, token: d1Token() } : null
  }), null, 2), `行迹备份_${now().slice(0, 10)}.json`),
  'export-svg': button => exportSingleTicket(button, 'svg'),
  'export-png': button => exportSingleTicket(button, 'png'),
  delete: async button => {
    if (!confirm('删除这张票据？删除后无法恢复。')) return;
    const id=button.dataset.id;
    if (!await requireArithmetic('删除票据') || !canWrite() || state.saving) return;
    const records = clone(state.records), r = records.find(r => r.id === id); if (!r) return;
    r.deleted = true; r.updatedAt = now(); await persist(records); closeModal(true); render(); toast(savedMessage('删除已同步'));
  },
  sync: async () => {
    if (!cloudToken()) { navigate('data'); return; }
    if (await doSync({}, { retryRejected: true })) await completeExistingCloudLink();
  },
  'backup-github': backupGitHub,
  'discard-rejected-change': discardRejectedChanges,
  'adopt-d1': adoptD1Replacement,
  'review-conflicts': () => { if (modalRoot.querySelector('dialog') && !closeModal()) return; showConflicts(state.pendingConflicts || []); },
  disconnect: disconnectCloud,
  'disconnect-d1': disconnectCloud,
  'disconnect-all': disconnectCloud,
  'flight-refresh': checkFlights,
  'flight-result': showFlightResult,
  'flight-to-import': () => { const text = state.flightResult?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || JSON.stringify(state.flightResult); closeModal(true); navigate('import'); document.querySelector('#import-text').value = text; },
  install: async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; render(); } }
};
document.addEventListener('change', event => {
  const input = event.target;
  if (input.matches('[data-archive-select]')) {
    if (input.checked) archiveSelected.add(input.dataset.archiveSelect); else archiveSelected.delete(input.dataset.archiveSelect);
    refreshArchiveSelection();
  } else if (input.matches('[data-archive-select-all]')) {
    const result = searchTickets(live(), state.filters);
    if (input.checked && !result.error) for (const record of result.records) archiveSelected.add(record.id); else archiveSelected.clear();
    refreshArchiveSelection(result); document.querySelector('[data-archive-select-all]')?.focus();
  }
});
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  if (['new', 'edit', 'delete', 'delete-selected', 'scan-ticket', 'edit-candidate', 'save-candidates', 'parse-text', 'flight-to-import'].includes(button.dataset.action) && !canWrite()) return toast('当前仅可查看缓存，请恢复云端连接', true);
  const fn = actions[button.dataset.action]; if (fn) Promise.resolve().then(() => fn(button)).catch(fail);
});
history.scrollRestoration = 'manual';
window.addEventListener('hashchange', followHistory);
window.addEventListener('popstate', followHistory);
window.addEventListener('online', () => {
  if (state.syncMeta.pending || state.connectionStatus === 'offline') doSync();
  else renderSyncState();
});
window.addEventListener('offline', renderSyncState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') clearTimeout(syncTimer);
  else if (state.syncMeta.pending) doSync();
  else renderSyncState();
});
channel?.addEventListener('message', async event => {
  try {
    const snapshot = await readSyncState({ session: true });
    const previous = { binding: activeBinding(state), github: state.config, token: token(), d1Token: d1Token() };
    const clearView = event.data?.clearView;
    const discarded = event.data?.discardedChange;
    if (backupRestoreOffer && discarded?.binding === backupRestoreOffer.binding &&
        backupRestoreOffer.revision < discarded.revision) backupRestoreOffer = null;
    const resetChanged = state.archiveResetProgress?.id !== snapshot.archiveResetProgress?.id;
    const rejectionChanged = state.syncMeta.rejection !== snapshot.meta.rejection;
    if (clearView) {
      invalidateCloudSession();
      clearSignedOutArchive();
    }
    useSnapshot(snapshot);
    const primaryChanged = previous.binding !== activeBinding(state) || (state.d1 ? previous.d1Token !== d1Token() : previous.token !== token());
    const githubChanged = previous.github?.id !== state.config?.id || previous.github?.branch !== state.config?.branch || previous.token !== token();
    if (clearView || primaryChanged || resetChanged || rejectionChanged || state.connectionStatus === 'checking') {
      state.connectionStatus = !cloudToken() ? 'auth' : snapshot.meta.rejection ? 'rejected'
        : snapshot.meta.verified && !snapshot.meta.pending && navigator.onLine ? 'online' : 'checking';
    }
    if (clearView || primaryChanged || resetChanged || (githubChanged && state.page === 'data')) render();
    else renderSyncState();
    queueSync(100);
  } catch (error) { fail(error); }
});
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; if (state.page === 'data') render(); });
window.addEventListener('beforeunload', event => { if (state.profileDirty || editor?.dirty) { event.preventDefault(); event.returnValue = ''; } });
async function boot() {
  try {
    sessionStorage.removeItem('xingji-github-token');
    sessionStorage.removeItem('xingji-d1-token');
    const snapshot = await readSyncState({ session: true });
    useSnapshot(snapshot);
    state.showDemo = snapshot.showDemo;
    state.page = location.hash.slice(1) || 'archive';
    render();
    doSync().then(completeExistingCloudLink);
  } catch (error) {
    root.innerHTML = `<main class="boot-error"><h1>本机档案暂时无法打开</h1><p>${e(error.message)}</p><p>请保留当前浏览器数据，不要清空缓存。可以刷新重试，或从已有备份恢复。</p><button class="button primary" id="rescue-data">导出原始本机数据</button><button class="button danger" data-action="reset-repository">重置仓库</button></main>`;
    document.querySelector('#rescue-data').onclick = async () => { try { download(JSON.stringify(await db.get('records', []), null, 2), 'xingji-rescue.json'); } catch (err) { fail(err); } };
  }
}
watchAppUpdates({
  canReload: () => {
    if (state.saving || state.syncing || imports.task || state.connecting || state.githubBackingUp || state.resetting) return '请等待当前操作完成后再更新';
    if (state.profileDirty || editor?.dirty || imports.entries.length || imports.backup || (state.flightKeyDraft !== null && state.flightKeyDraft.trim() !== flightKey())) return '请先保存或关闭正在编辑的内容，再更新';
    return true;
  },
  notify: message => toast(message, true),
  onError: () => toast('离线缓存未启用，当前仍可正常使用', true)
});
boot();
