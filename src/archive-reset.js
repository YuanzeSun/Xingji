import { escape as e } from './html.js';
import { arithmeticField } from './arithmetic-confirm.js';

export function archiveResetMarkup(request, captured, challenge) {
  const remote = request.code === 'ARCHIVE_RESET';
  const github = captured.config ? captured.config.owner + '/' + captured.config.repo : '';
  const d1 = captured.d1?.url;
  const targets = [
    ...(github ? [`<li>GitHub · <strong>${e(github)}</strong></li>`] : []),
    ...(d1 ? [`<li>D1 · <strong>${e(d1)}</strong></li>`] : [])
  ].join('');
  const description = remote ? '采用新票库会清理本机的旧票据和设置。'
    : '重置会清空所列票库的票据和相关资料，分别保留个人资料、MCP 和账号设置。';
  const history = !remote && github ? '<p>GitHub 当前分支的其他文件也会清除，Git 历史保留。</p>' : '';
  const unlink = !remote && github && d1 ? `<label class="checkbox-row"><input type="checkbox" name="unlink-clouds" ${request.unlinkStarted ? 'checked disabled' : ''} />同时解除关联</label><fieldset class="conflict" data-keep-cloud ${request.unlinkStarted ? '' : 'hidden disabled'}><legend>重置后继续使用</legend><label><input type="radio" name="keep-cloud" value="github" required />GitHub</label><label><input type="radio" name="keep-cloud" value="d1" required />Cloudflare D1</label></fieldset>` : '';
  const action = remote ? '使用新票库' : '重置仓库';
  return `<div class="detail-body archive-reset-body"><p>${description}</p><ul class="reset-targets">${targets}</ul>${history}<button type="button" class="text-button" data-action="backup">导出本机票据</button><form data-archive-reset>${unlink}<label class="checkbox-row"><input type="checkbox" name="confirm-reset" required />我确认${action}</label>${arithmeticField(challenge)}<p class="form-error" role="alert" data-reset-error></p><div class="reset-actions"><button type="button" class="button secondary" data-action="close-modal">取消</button><button type="submit" class="button danger" disabled>${action}</button></div></form></div>`;
}
