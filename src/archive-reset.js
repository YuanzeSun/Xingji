import { escape as e } from './html.js';
import { arithmeticField } from './arithmetic-confirm.js';
import { assertLinkTargets, sameD1Account, sameGitHubAccount } from './archive-migration.js';
import { sharedSettings, unlinkedSettings, wasUnlinked } from './shared-settings.js';

export async function prepareArchiveReset(github, d1, settings) {
  const [snapshot, d1Snapshot] = await Promise.all([github?.resetTarget(d1 ? {} : settings), d1?.read()]);
  if (github && d1) {
    if (wasUnlinked(d1Snapshot)) throw new Error('仓库关联已解除，请先重新登录。');
    assertLinkTargets(github, d1, snapshot, d1Snapshot);
  } else if (d1Snapshot?.settings.connections?.github || snapshot?.settings.connections?.d1) {
    throw new Error('票库已关联另一边，请先重新登录以恢复两边的连接。');
  }
  return { snapshot, d1Snapshot, unlinkStarted: wasUnlinked(snapshot) && !!d1 };
}

function settingsAfterReset(settings, unlink) {
  return unlink ? unlinkedSettings(settings) : settings;
}

async function settingsDigest(settings) {
  const bytes = new TextEncoder().encode(JSON.stringify(sharedSettings(settings)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPairedReset(request, captured, unlink, keep) {
  const github = request.snapshot, d1 = request.d1Snapshot;
  return {
    id: crypto.randomUUID(), step: 'github', unlink, keep: unlink ? keep : 'd1',
    github: { id: captured.config.id, branch: captured.config.branch },
    d1: { id: captured.d1.id, url: captured.d1.url },
    beforeGitHub: github.head,
    beforeD1: d1.head,
    githubSettings: await settingsDigest(settingsAfterReset(github.settings, unlink)),
    d1Settings: await settingsDigest(settingsAfterReset(d1.settings, unlink))
  };
}

export function matchesResetPair(progress, captured) {
  return sameGitHubAccount(progress.github, captured.config) && sameD1Account(progress.d1, captured.d1);
}

export async function continuePairedReset(github, d1, progress, save) {
  let [githubResult, d1Result] = await Promise.all([github.resetTarget(), d1.read()]);
  const githubCompleted = githubResult.generation === progress.id && githubResult.recordCount === 0 &&
    githubResult.paths.length === 1 && githubResult.paths[0] === 'archive/index.json' &&
    await settingsDigest(githubResult.settings) === progress.githubSettings;
  if (progress.githubHead ? githubResult.head !== progress.githubHead || !githubCompleted
    : githubResult.head !== progress.beforeGitHub && !githubCompleted) {
    throw new Error('GitHub 仓库已有变化，请放弃续接后重新核对。');
  }

  async function advance(step, evidence = {}) {
    const next = { ...progress, ...evidence, step };
    await save(next, progress);
    progress = next;
  }

  if (progress.step === 'github') {
    if (d1Result.head !== progress.beforeD1) throw new Error('D1 票库已有变化，请放弃续接后重新核对。');
    if (!githubCompleted) {
      githubResult = await github.resetRepository(progress.beforeGitHub, {}, { unlink: progress.unlink, generation: progress.id });
    }
    await advance('check-d1', { githubHead: githubResult.head });
    d1Result = await d1.read();
  }

  if (progress.step === 'check-d1') {
    if (d1Result.head !== progress.beforeD1) throw new Error('D1 票库已有变化，请放弃续接后重新核对。');
    await advance('d1');
  }

  if (progress.step === 'd1') {
    if (d1Result.head === progress.beforeD1) {
      if (await github.head() !== progress.githubHead) throw new Error('GitHub 仓库已有变化，请放弃续接后重新核对。');
      d1Result = await d1.replace(d1Result, [], settingsAfterReset(d1Result.settings, progress.unlink), { resetId: progress.id });
    } else {
      // Both markers must match so later writes cannot look like the lost reset.
      const confirmed = d1Result.head === progress.id && d1Result.generation === progress.id && d1Result.records.length === 0 &&
        await settingsDigest(d1Result.settings) === progress.d1Settings;
      if (!confirmed) throw new Error('D1 票库已有变化，请放弃续接后重新核对。');
    }
    await advance('adopt', { d1Head: d1Result.head });
  }

  if (d1Result.head !== progress.d1Head) throw new Error('D1 票库已有变化，请放弃续接后重新核对。');
  return { github: { ...githubResult, records: [] }, d1: d1Result };
}

export function archiveResetMarkup(request, captured, challenge) {
  const remote = request.code === 'ARCHIVE_RESET';
  const github = captured.config ? captured.config.owner + '/' + captured.config.repo : '';
  const d1 = captured.d1?.url;
  const targets = [
    ...(github ? [`<li>GitHub · <strong>${e(github)}</strong></li>`] : []),
    ...(d1 ? [`<li>D1 · <strong>${e(d1)}</strong></li>`] : [])
  ].join('');
  const description = remote ? '采用新票库会清理本机的旧票据和设置。'
    : '重置会清空所列票库的票据、删除标记和相关资料，保留个人资料、MCP 和账号设置。';
  const history = !remote && github ? '<p>GitHub 当前分支的其他文件也会清除，Git 历史保留。</p>' : '';
  const unlink = !remote && github && d1 ? `<label class="checkbox-row"><input type="checkbox" name="unlink-clouds" ${request.unlinkStarted ? 'checked disabled' : ''} />同时解除关联</label><fieldset class="conflict" data-keep-cloud ${request.unlinkStarted ? '' : 'hidden disabled'}><legend>重置后继续使用</legend><label><input type="radio" name="keep-cloud" value="github" required />GitHub</label><label><input type="radio" name="keep-cloud" value="d1" required />Cloudflare D1</label></fieldset>` : '';
  const action = remote ? '使用新票库' : '重置仓库';
  return `<div class="detail-body archive-reset-body"><p>${description}</p><ul class="reset-targets">${targets}</ul>${history}<button type="button" class="text-button" data-action="backup">导出本机票据</button><form data-archive-reset>${unlink}<label class="checkbox-row"><input type="checkbox" name="confirm-reset" required />我确认${action}</label>${arithmeticField(challenge)}<p class="form-error" role="alert" data-reset-error></p><div class="reset-actions"><button type="button" class="button secondary" data-action="close-modal">取消</button><button type="submit" class="button danger" disabled>${action}</button></div></form></div>`;
}
