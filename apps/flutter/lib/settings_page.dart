import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'archive_text_field.dart';
import 'design.dart';
import 'export_service.dart';
import 'ticket_detail.dart';
import 'profile_editor.dart';
import 'import_review.dart';
import 'sync_review.dart';
import 'platform_services.dart';
import 'travel_message_inbox.dart';
import 'variflight_import.dart';
import 'ticket_file_import.dart';

class SettingsPage extends StatefulWidget {
  final AppStore store;
  const SettingsPage(this.store, {super.key});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final choices = <String, bool>{};
  ArchiveMerge? reviewed;
  bool queryingFlights = false;
  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    if (!identical(reviewed, store.conflicts)) {
      choices.clear();
      reviewed = store.conflicts;
    }
    Future<void> action(Future<void> Function() run) async {
      try {
        await run();
      } catch (error) {
        if (context.mounted) showError(context, error);
      }
    }

    return ListView(
      padding: archivePagePadding(context),
      children: [
        Text('数据与同步', style: Theme.of(context).textTheme.headlineLarge),
        SectionTitle(
          'GitHub 同步（可选）',
          trailing: TextButton(
            onPressed: () => _showGitHubSetup(context),
            child: const Text('连接说明'),
          ),
        ),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
          ),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final summary = Row(
                children: [
                  const SizedBox.square(
                    dimension: 44,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: mist,
                        borderRadius: BorderRadius.all(Radius.circular(12)),
                      ),
                      child: Icon(Icons.cloud_outlined, color: ink, size: 24),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          store.connection?.label ?? '同步到其他设备',
                          style: Theme.of(context).textTheme.titleMedium,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          store.readOnlyReason ?? store.status,
                          style: const TextStyle(color: muted),
                        ),
                        if (store.syncError case final error?)
                          Text(
                            error,
                            style: TextStyle(
                              color: Theme.of(context).colorScheme.error,
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              );
              final controls = Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  if (store.connected)
                    OutlinedButton(
                      onPressed: store.busy
                          ? null
                          : () => action(
                              () => store.clearLocalArchive(signOut: true),
                            ),
                      child: const Text('退出 GitHub'),
                    )
                  else
                    FilledButton.icon(
                      onPressed: store.busy
                          ? null
                          : () => connectDialog(context, store),
                      icon: const Icon(Icons.link),
                      label: Text(
                        store.connection == null ? '连接 GitHub' : '重新登录 GitHub',
                      ),
                    ),
                  if (store.connected)
                    OutlinedButton.icon(
                      onPressed: store.busy ? null : () => action(store.sync),
                      icon: const Icon(Icons.sync),
                      label: Text(store.busy ? '正在同步…' : '立即同步'),
                    ),
                ],
              );
              final inline =
                  constraints.maxWidth >= 640 &&
                  MediaQuery.textScalerOf(context).scale(14) <= 18;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (inline)
                    Row(
                      children: [
                        Expanded(child: summary),
                        const SizedBox(width: 20),
                        controls,
                      ],
                    )
                  else ...[
                    summary,
                    const SizedBox(height: 16),
                    controls,
                  ],
                  if (store.busy)
                    const Padding(
                      padding: EdgeInsets.only(top: 16),
                      child: LinearProgressIndicator(),
                    ),
                ],
              );
            },
          ),
        ),
        if (store.resetDetected)
          Padding(
            padding: const EdgeInsets.only(top: 20),
            child: OutlinedButton(
              onPressed: store.busy
                  ? null
                  : () => action(() async {
                      if (await confirmDeletion(
                        context,
                        title: '采用云端重置后的票库？',
                        description: '清除本机旧票据，保留 Git 历史，并使用云端最新个人资料和设置。',
                        confirmLabel: '清理并采用',
                      )) {
                        await store.acceptRemoteReset();
                      }
                    }),
              child: const Text('采用云端重置后的票库'),
            ),
          ),
        const SectionTitle('个人资料'),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            onPressed: !store.canWrite
                ? null
                : () => openProfileEditor(context, store),
            icon: const Icon(Icons.person_outline),
            label: const Text('姓名与常用证件'),
          ),
        ),
        if (store.conflicts != null) ...[
          const SectionTitle('处理同步冲突'),
          SyncChoices(
            tickets: store.conflicts!,
            settings: store.settingsConflicts,
            choices: choices,
            onChoose: (key, value) => setState(() => choices[key] = value),
          ),
          FilledButton(
            onPressed:
                store.busy ||
                    choices.length !=
                        store.conflicts!.conflicts.length +
                            (store.settingsConflicts?.conflicts.length ?? 0)
                ? null
                : () => action(() => store.resolveConflicts(choices)),
            child: const Text('保留选择并同步'),
          ),
        ],
        if (AppleServices.available) ...[
          SectionTitle(
            '自动导入',
            trailing: TextButton(
              onPressed: () => _showSourceGuide(context),
              child: const Text('使用说明'),
            ),
          ),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              OutlinedButton.icon(
                onPressed: () =>
                    action(() => reviewSharedTickets(context, store)),
                icon: const Icon(Icons.inbox_outlined),
                label: const Text('分享收件箱'),
              ),
              OutlinedButton.icon(
                onPressed: () =>
                    action(() => showTravelMessageInbox(context, store)),
                icon: const Icon(Icons.sms_outlined),
                label: const Text('行程短信'),
              ),
              OutlinedButton.icon(
                onPressed: queryingFlights
                    ? null
                    : () => action(() async {
                        setState(() => queryingFlights = true);
                        try {
                          await openVariFlightImport(context, store);
                        } finally {
                          if (mounted) setState(() => queryingFlights = false);
                        }
                      }),
                icon: const Icon(Icons.flight_outlined),
                label: Text(queryingFlights ? '飞常准查询中…' : '飞常准行程'),
              ),
            ],
          ),
        ],
        const SectionTitle('导入与导出'),
        const Padding(
          padding: EdgeInsets.only(bottom: 12),
          child: Text('JSON 备份包含票据、个人资料和访问凭证。'),
        ),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            OutlinedButton.icon(
              onPressed: !store.canWrite
                  ? null
                  : () => action(() async {
                      if (!await checkArchiveWrite(context, store) ||
                          !context.mounted) {
                        return;
                      }
                      final file = await openFile(
                        acceptedTypeGroups: [
                          if (AppleServices.available)
                            const XTypeGroup(
                              label: '行迹票库与票据文件',
                              extensions: [
                                'json',
                                'txt',
                                'pdf',
                                'pkpass',
                                'jpg',
                                'jpeg',
                                'png',
                                'heic',
                                'heif',
                              ],
                              uniformTypeIdentifiers: [
                                'public.json',
                                'public.plain-text',
                                'com.adobe.pdf',
                                'com.apple.pkpass',
                                'public.image',
                              ],
                            )
                          else
                            const XTypeGroup(
                              label: '行迹票库',
                              extensions: ['json', 'txt', 'pkpass'],
                            ),
                        ],
                      );
                      if (file != null) {
                        if (await file.length() > 40_000_000) {
                          throw const FormatException('请选择 40 MB 以内的文件');
                        }
                        final bytes = await file.readAsBytes();
                        if (file.name.toLowerCase().endsWith('.json')) {
                          final backup = FullArchiveBackup.fromJson(
                            jsonDecode(utf8.decode(bytes)),
                          );
                          if (!context.mounted) return;
                          final restored = await reviewImport(
                            context,
                            store,
                            backup.archive.records,
                            backupSettings: backup.settings,
                          );
                          if (restored && context.mounted) {
                            await _offerGitHubBackupConnection(
                              context,
                              store,
                              backup.github,
                            );
                          }
                          return;
                        }
                        final records = await readLocalImport(
                          file.name,
                          bytes,
                          store.catalog,
                        );
                        if (context.mounted) {
                          await reviewImport(context, store, records);
                        }
                      }
                    }),
              icon: const Icon(Icons.file_open_outlined),
              label: const Text('导入票库'),
            ),
            OutlinedButton.icon(
              onPressed: () => action(
                () async => saveFile(
                  'xingji-backup.json',
                  utf8.encode(
                    const JsonEncoder.withIndent('  ')
                        .convert((await store.exportBackup()).toJson()),
                  ),
                  'application/json',
                ),
              ),
              icon: const Icon(Icons.save_alt),
              label: const Text('导出备份'),
            ),
          ],
        ),
        const SizedBox(height: 24),
        const SectionTitle('重置与清理'),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: ticketRed),
              onPressed:
                  store.busy || !store.connected || store.connection == null
                  ? null
                  : () => action(() async {
                      if (await confirmGitHubReset(
                        context,
                        store.connection!,
                        clearLocal: true,
                      )) {
                        await store.resetRepository();
                        if (context.mounted) _showResetComplete(context);
                      }
                    }),
              icon: const Icon(Icons.restart_alt),
              label: Text(store.busy ? '正在处理…' : '重置 GitHub 仓库'),
            ),
            OutlinedButton(
              onPressed: store.busy
                  ? null
                  : () => action(() async {
                      if (await confirmDeletion(
                        context,
                        title: '清空本机票库？',
                        description: '仅清除本机票据并断开仓库连接，保留本机个人资料和飞常准设置。云端文件保持不变。',
                        confirmLabel: '清空本机',
                      )) {
                        await store.clearLocalArchive();
                      }
                    }),
              child: const Text('清空本机票库'),
            ),
          ],
        ),
        const SizedBox(height: 24),
        const Text(
          '本机票库可离线编辑。绑定 GitHub 后，修改须在线保存，离线可查看和导出。GitHub 凭证仅在本次应用会话中使用。',
          style: TextStyle(color: muted),
        ),
        const SizedBox(height: 40),
        const Text(
          'by @YuanzeSun',
          style: TextStyle(color: muted, fontSize: 12),
        ),
      ],
    );
  }
}

Future<void> _offerGitHubBackupConnection(
  BuildContext context,
  AppStore store,
  GitHubBackupConnection? connection,
) async {
  if (connection == null ||
      connection.token.isEmpty ||
      store.connection != null) {
    return;
  }
  final add = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('是否添加 GitHub 连接'),
      content: Text(connection.target.label),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('跳过'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('继续连接'),
        ),
      ],
    ),
  );
  if (add != true || !context.mounted || store.connection != null) return;
  await store.connect(
    connection.target,
    connection.token,
    choose: (local, cloud) => chooseBinding(context, local, cloud),
    pick: pickSyncConflicts(context),
  );
}

void _showResetComplete(BuildContext context) {
  ScaffoldMessenger.of(context)
      .showSnackBar(const SnackBar(content: Text('GitHub 仓库已重置')));
}

Future<bool> confirmGitHubReset(
  BuildContext context,
  GitHubConnection target, {
  required bool clearLocal,
}) => confirmDeletion(
  context,
  title: '重置 GitHub 仓库？',
  description:
      '清空 ${target.label} 的 ${target.branch} 分支中的票据及其他文件'
      '${clearLocal ? '，同时清空当前设备中与该仓库绑定的票库' : ''}。'
      '保留仓库中的个人资料、飞常准设置和 Git 历史。',
  confirmLabel: '确认重置仓库',
);

Future<BindingChoice?> chooseBinding(
  BuildContext context,
  int localCount,
  int cloudCount,
) async {
  if (!context.mounted) return null;
  final choice = await showDialog<BindingChoice>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('选择首次同步方式'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('本机有 $localCount 张票据，GitHub 有 $cloudCount 张票据。'),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: () => Navigator.pop(context, BindingChoice.merge),
            child: const Text('合并两边的票据'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: () => Navigator.pop(context, BindingChoice.replaceCloud),
            child: const Text('用本机票据替换云端'),
          ),
          const SizedBox(height: 8),
          OutlinedButton(
            onPressed: () => Navigator.pop(context, BindingChoice.replaceLocal),
            child: const Text('用云端票据替换本机'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('取消'),
        ),
      ],
    ),
  );
  if (choice == null || choice == BindingChoice.merge) return choice;
  if (!context.mounted) return null;
  final replaceCloud = choice == BindingChoice.replaceCloud;
  return await confirmDeletion(
        context,
        title: replaceCloud ? '替换云端票库？' : '替换本机票库？',
        description: replaceCloud
            ? '用本机的 $localCount 张票据替换云端的 $cloudCount 张票据，保留 Git 历史。'
            : '本机的 $localCount 张票据将被云端的 $cloudCount 张票据替换。',
        confirmLabel: '确认替换',
      )
      ? choice
      : null;
}

Future<void> connectDialog(BuildContext context, AppStore store) async {
  final owner = TextEditingController(text: store.connection?.owner ?? ''),
      repo = TextEditingController(text: store.connection?.repository ?? ''),
      token = TextEditingController();
  final form = GlobalKey<FormState>();
  var busy = false, error = '';
  await showAdaptiveDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => PopScope(
        canPop: !busy,
        child: AlertDialog(
          title: const Text('连接 GitHub 私有仓库'),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: SingleChildScrollView(
              child: Form(
                key: form,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    TextButton.icon(
                      onPressed: busy ? null : () => _showGitHubSetup(context),
                      icon: const Icon(Icons.help_outline),
                      label: const Text('配置仓库与访问令牌'),
                    ),
                    for (final (controller, label, secret) in [
                      (owner, 'GitHub 用户名', false),
                      (repo, '私人仓库名称', false),
                      (token, '访问令牌', true),
                    ])
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: ArchiveTextField(
                          controller: controller,
                          native: true,
                          enabled: !busy,
                          obscureText: secret,
                          enableSuggestions: !secret,
                          autocorrect: !secret,
                          decoration: InputDecoration(labelText: label),
                          validator: (value) =>
                              (value ?? '').trim().isEmpty ? '请填写$label' : null,
                        ),
                      ),
                    if (error.isNotEmpty)
                      Text(
                        error,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    if (busy) const LinearProgressIndicator(),
                  ],
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: busy
                  ? null
                  : () async {
                      if (!form.currentState!.validate()) return;
                      final target = GitHubConnection(
                        owner.text.trim(),
                        repo.text.trim(),
                        branch: store.connection?.branch ?? 'main',
                      );
                      update(() {
                        busy = true;
                        error = '';
                      });
                      try {
                        final bound = await store.connect(
                          target,
                          token.text.trim(),
                          choose: (local, cloud) =>
                              chooseBinding(context, local, cloud),
                          pick: pickSyncConflicts(context, newEdit: false),
                        );
                        if (bound && context.mounted) Navigator.pop(context);
                      } catch (failure) {
                        if (context.mounted) {
                          update(
                            () => error = failure.toString().replaceFirst(
                              'FormatException: ',
                              '',
                            ),
                          );
                        }
                      } finally {
                        if (context.mounted) update(() => busy = false);
                      }
                    },
              child: Text(busy ? '正在连接…' : '连接'),
            ),
          ],
        ),
      ),
    ),
  );
  for (final controller in [owner, repo, token]) {
    controller.dispose();
  }
}

Future<void> _showGitHubSetup(BuildContext context) => showAdaptiveDialog<void>(
  context: context,
  builder: (context) => AlertDialog.adaptive(
    title: const Text('连接 GitHub'),
    content: SizedBox(
      width: 460,
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              '1. 新建私有仓库',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            const Text('在 GitHub 新建仓库，选 Private，勾选添加 README。确认仓库有 main 分支。'),
            _gitHubSetupLink(
              context,
              '新建仓库',
              'https://github.com/new?visibility=private',
            ),
            const SizedBox(height: 12),
            const Text(
              '2. 创建访问令牌',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            const Text(
              '选择 Fine-grained token，将 Repository access 限制为刚建的仓库，并把 Contents 权限设为 Read and write。生成后复制令牌。',
            ),
            _gitHubSetupLink(
              context,
              '创建令牌',
              'https://github.com/settings/personal-access-tokens/new',
            ),
            const SizedBox(height: 12),
            const Text(
              '3. 填写连接信息',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            const Text(
              '例如仓库地址为 github.com/octocat/xingji-data，用户名填写 octocat，仓库名称填写 xingji-data。粘贴访问令牌后点击连接。',
            ),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('完成'),
      ),
    ],
  ),
);

Widget _gitHubSetupLink(BuildContext context, String label, String url) =>
    TextButton.icon(
      onPressed: () async {
        if (AppleServices.available &&
            await AppleServices.openGitHubSetup(url)) {
          return;
        }
        await Clipboard.setData(ClipboardData(text: url));
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('已复制链接')));
        }
      },
      icon: Icon(AppleServices.available ? Icons.open_in_new : Icons.link),
      label: Text(AppleServices.available ? label : '复制$label链接'),
    );

Future<void> _showSourceGuide(BuildContext context) => showDialog<void>(
  context: context,
  builder: (context) => AlertDialog.adaptive(
    title: const Text('如何导入行程'),
    content: const SizedBox(
      width: 480,
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              '钱包登机牌、PDF 和图片',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            SizedBox(height: 6),
            Text(
              '可以先存到「文件」，再点「＋ → 上传」。想从钱包直接送进来，可在快捷指令中创建捷径，开启「在共享表单中显示」，把快捷指令输入传给行迹的「收集票据文件」动作。分享时选择这个捷径，再到「分享收件箱」核对。',
            ),
            SizedBox(height: 16),
            Text('12306 或航司短信', style: TextStyle(fontWeight: FontWeight.w700)),
            SizedBox(height: 6),
            Text(
              '在快捷指令的「自动化」中新建「信息」触发条件，按发件人或正文筛选。添加行迹的「导入行程短信」，将收到的信息正文传进去。打开行迹时，信息完整的订单会自动录入，其余在「行程短信」里核对。',
            ),
            SizedBox(height: 16),
            Text('飞常准行程', style: TextStyle(fontWeight: FontWeight.w700)),
            SizedBox(height: 6),
            Text(
              '在飞常准 MCP 平台开通个人行程授权并获取 MCP Key。点「飞常准行程」输入 Key，查询未来行程或选年份查历史行程，核对后导入。',
            ),
            SelectableText('cmcp.variflight.com'),
          ],
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('知道了'),
      ),
    ],
  ),
);
