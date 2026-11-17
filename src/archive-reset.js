import {escape as e} from './html.js';
import {arithmeticField} from './arithmetic-confirm.js';
export function archiveResetMarkup(request,captured,challenge){
  const remote=request.code==='ARCHIVE_RESET',repo=captured.config.owner+'/'+captured.config.repo;
  return `<div class="detail-body archive-reset-body"><p>${remote ? '云端票库已在其他设备重置，继续使用前需清理本机旧数据。' : '重置将清空此仓库当前分支的所有文件，仅保留已保存的个人资料和 MCP 设置。'}</p><p><strong>${e(repo)}</strong> · 本机 ${captured.records.filter(record=>!record.deleted).length} 张票据</p><p>${remote ? '采用新票库中的个人资料与 MCP 设置。' : '票据、线路、时刻表、删除标记及其他文件都会移除。'}Git 历史保留。</p><button type="button" class="text-button" data-action="backup">导出本机票据</button><form data-archive-reset><label class="checkbox-row"><input type="checkbox" name="confirm-reset" required />我确认${remote ? '清理本机旧数据并使用新票库' : '重置此仓库，保留个人资料和 MCP 设置'}</label>${arithmeticField(challenge)}<p class="form-error" role="alert" data-reset-error></p><div class="reset-actions"><button type="button" class="button secondary" data-action="close-modal">取消</button><button type="submit" class="button danger" disabled>${remote ? '使用新票库' : '重置仓库'}</button></div></form></div>`;
}
