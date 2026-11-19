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
        const SectionTitle('Cloudflare D1'),
        _CloudConnectionCard(
          title: store.d1Connection == null
              ? '连接 Worker 票库'
              : Uri.parse(store.d1Connection!.url).host,
          description: '填写 Worker 根地址及部署时设置的访问凭证。',
          connectLabel: store.d1Connection == null ? '连接 D1' : '重新连接 D1',
          connected: store.d1Connected,
          enabled:
              !store.busy &&
              (!store.hasResetProgress || store.d1Connection != null),
          connect: () => connectD1Dialog(context, store),
        ),
        SectionTitle(
          'GitHub 私有仓库',
          trailing: TextButton(
            onPressed: () => _showGitHubSetup(context),
            child: const Text('连接说明'),
          ),
        ),
        _CloudConnectionCard(
          title: store.connection?.label ?? '连接私有仓库',
          description: '填写仓库所有者、名称和拥有写入权限的访问令牌。',
          connectLabel: store.connection == null ? '连接 GitHub' : '重新登录 GitHub',
          connected: store.githubConnected,
          enabled:
              !store.busy &&
              (!store.hasResetProgress || store.connection != null),
          connect: () => connectDialog(context, store),
        ),
        if (store.hasCloud) ...[
          const SizedBox(height: 16),
          Text(store.readOnlyReason ?? store.status),
          if (store.syncError case final error?)
            Text(
              error,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          if (store.isPaired)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text(
                '变更保存在 D1。需要更新 GitHub 时，点「立即备份到 GitHub」。换设备时登录任一账号即可继续使用 D1。两个账号一起退出。如需解除关联，可在重置仓库时选择保留一个账号。',
              ),
            ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              OutlinedButton.icon(
                onPressed:
                    store.busy || !store.connected || store.hasResetProgress
                    ? null
                    : () => action(store.sync),
                icon: const Icon(Icons.sync),
                label: const Text('立即同步'),
              ),
              if (store.isPaired)
                OutlinedButton(
                  onPressed: !store.canWrite || !store.githubConnected
                      ? null
                      : () => action(store.backupToGitHub),
                  child: const Text('立即备份到 GitHub'),
                ),
              OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Theme.of(context).colorScheme.error,
                  side: BorderSide(color: Theme.of(context).colorScheme.error),
                ),
                onPressed: store.busy
                    ? null
                    : () => action(() async {
                        if (await _confirmAction(
                              context,
                              '退出登录？',
                              store.isPaired
                                  ? '两个账号将一起退出，本机票库缓存将清空。再次登录时会恢复关联。'
                                  : '此设备的票库缓存将清空。重新登录后可读取云端票库。',
                              '退出登录',
                            ) &&
                            context.mounted) {
                          await store.clearLocalArchive(signOut: true);
                        }
                      }),
                child: const Text('退出登录'),
              ),
            ],
          ),
        ],
        if (store.busy)
          const Padding(
            padding: EdgeInsets.only(top: 16),
            child: LinearProgressIndicator(),
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
                      final archiveSession = store.archiveSession;
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
                      if (file != null &&
                          archiveSession == store.archiveSession) {
                        if (await file.length() > 40_000_000) {
                          throw const FormatException('请选择 40 MB 以内的文件');
                        }
                        final bytes = await file.readAsBytes();
                        if (file.name.toLowerCase().endsWith('.json')) {
                          final backup = FullArchiveBackup.fromJson(
                            jsonDecode(utf8.decode(bytes)),
                          );
                          if (!context.mounted ||
                              archiveSession != store.archiveSession) {
                            return;
                          }
                          final restored = await reviewImport(
                            context,
                            store,
                            backup.archive.records,
                            backupSettings: backup.settings,
                          );
                          if (restored &&
                              context.mounted &&
                              archiveSession == store.archiveSession) {
                            await _offerBackupConnection(
                              context,
                              store,
                              backup,
                            );
                          }
                          return;
                        }
                        final records = await readLocalImport(
                          file.name,
                          bytes,
                          store.catalog,
                        );
                        if (context.mounted &&
                            archiveSession == store.archiveSession) {
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
            if (store.hasResetProgress) ...[
              OutlinedButton(
                onPressed:
                    store.busy || !store.d1Connected || !store.githubConnected
                    ? null
                    : () => action(store.continueCloudReset),
                child: const Text('继续重置'),
              ),
              TextButton(
                onPressed: store.busy
                    ? null
                    : () => action(() async {
                        if (await _confirmAction(
                          context,
                          '放弃续接？',
                          '已经完成的云端重置会保留。',
                          '放弃续接',
                        )) {
                          await store.abandonCloudReset();
                        }
                      }),
                child: const Text('放弃续接'),
              ),
            ] else
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(foregroundColor: ticketRed),
                onPressed:
                    store.busy ||
                        !store.connected ||
                        store.isPaired && !store.githubConnected
                    ? null
                    : () => action(() => _resetCloud(context, store)),
                icon: const Icon(Icons.restart_alt),
                label: Text(store.hasCloud ? '重置仓库' : '重置 GitHub 仓库'),
              ),
            OutlinedButton(
              onPressed: store.busy || store.hasCloud
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
          '本机票库可离线编辑。连接云端后，在线保存修改，离线可查看和导出。',
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

class _CloudConnectionCard extends StatelessWidget {
  const _CloudConnectionCard({
    required this.title,
    required this.description,
    required this.connectLabel,
    required this.connected,
    required this.enabled,
    required this.connect,
  });
  final String title, description, connectLabel;
  final bool connected, enabled;
  final VoidCallback connect;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(20),
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(20),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(description, style: const TextStyle(color: muted)),
        const SizedBox(height: 12),
        if (connected)
          const Text('已授权')
        else
          OutlinedButton.icon(
            onPressed: enabled ? connect : null,
            icon: const Icon(Icons.link),
            label: Text(connectLabel),
          ),
      ],
    ),
  );
}

Future<bool> _confirmAction(
  BuildContext context,
  String title,
  String body,
  String label,
) async =>
    await showAdaptiveDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog.adaptive(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialog, true),
            child: Text(label),
          ),
        ],
      ),
    ) ==
    true;

Future<void> _resetCloud(BuildContext context, AppStore store) async {
  final primary = store.d1Connection;
  if (primary == null) {
    if (await confirmGitHubReset(
      context,
      store.connection!,
      clearLocal: true,
    )) {
      await store.resetRepository();
      if (context.mounted) _showResetComplete(context);
    }
    return;
  }
  final preview = await store.prepareD1Reset();
  if (!context.mounted) return;
  CloudSource? keep;
  if (preview.github != null) {
    final unlinkStarted = unlinkedArchive(preview.github!);
    var unlink = unlinkStarted;
    final selection = await showDialog<({CloudSource? keep})>(
      context: context,
      builder: (dialog) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('重置关联票库'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('两边的票据都会清空，各自的个人资料和飞常准设置会保留。'),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: unlink,
                title: const Text('同时解除关联'),
                onChanged: unlinkStarted
                    ? null
                    : (value) => update(() {
                        unlink = value;
                        keep = null;
                      }),
              ),
              if (unlink)
                Wrap(
                  spacing: 8,
                  children: [
                    for (final source in CloudSource.values)
                      ChoiceChip(
                        label: Text(
                          source == CloudSource.d1 ? '继续使用 D1' : '继续使用 GitHub',
                        ),
                        selected: keep == source,
                        onSelected: (_) => update(() => keep = source),
                      ),
                  ],
                ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialog),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: unlink && keep == null
                  ? null
                  : () => Navigator.pop(dialog, (keep: unlink ? keep : null)),
              child: const Text('继续'),
            ),
          ],
        ),
      ),
    );
    if (selection == null || !context.mounted) return;
    keep = selection.keep;
  }
  if (await confirmDeletion(
    context,
    title: '重置仓库？',
    description: preview.github != null
        ? '清空 D1 和 GitHub 当前票据。个人资料、飞常准设置和 Git 历史会保留。'
        : '清空 D1 当前票据，保留个人资料和飞常准设置。',
    confirmLabel: '确认重置',
  )) {
    await store.resetD1Archive(preview, keep: keep);
    if (context.mounted) _showResetComplete(context);
  }
}

Future<CloudSource?> chooseCloudAuthority(
  BuildContext context,
  int githubCount,
  int d1Count,
) async {
  if (!context.mounted) return null;
  final selected = await showDialog<CloudSource>(
    context: context,
    builder: (dialog) => AlertDialog(
      title: const Text('选择以哪边的票库为准'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'GitHub 有 $githubCount 张票据，D1 有 $d1Count 张。票据和设置将按所选一边覆盖。绑定后日常同步使用 D1。',
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => Navigator.pop(dialog, CloudSource.d1),
            child: const Text('以 D1 为准'),
          ),
          OutlinedButton(
            onPressed: () => Navigator.pop(dialog, CloudSource.github),
            child: const Text('以 GitHub 为准'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialog),
          child: const Text('取消'),
        ),
      ],
    ),
  );
  if (selected == null || !context.mounted) return null;
  return await _confirmAction(
        context,
        '确认覆盖票库？',
        selected == CloudSource.d1
            ? '用 D1 的票据、个人资料和飞常准设置覆盖 GitHub。'
            : '用 GitHub 的票据、个人资料和飞常准设置覆盖 D1。',
        '确认绑定',
      )
      ? selected
      : null;
}

Future<void> _offerBackupConnection(
  BuildContext context,
  AppStore store,
  FullArchiveBackup backup,
) async {
  final github =
      store.connection == null && backup.github?.token.isNotEmpty == true
      ? backup.github
      : null;
  final d1 = store.d1Connection == null && backup.d1?.token.isNotEmpty == true
      ? backup.d1
      : null;
  if (github == null && d1 == null) return;
  final session = store.archiveSession;
  final selected = await showDialog<CloudSource>(
    context: context,
    builder: (dialog) => AlertDialog(
      title: const Text('连接备份中的账号？'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (d1 != null)
            OutlinedButton(
              onPressed: () => Navigator.pop(dialog, CloudSource.d1),
              child: const Text('连接 D1'),
            ),
          if (github != null)
            OutlinedButton(
              onPressed: () => Navigator.pop(dialog, CloudSource.github),
              child: const Text('连接 GitHub'),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialog),
          child: const Text('跳过'),
        ),
      ],
    ),
  );
  if (selected == null || !context.mounted) return;
  Future<BindingChoice?> choose(int local, int cloud) => chooseBinding(
    context,
    local,
    cloud,
    cloudName: selected == CloudSource.d1 ? 'D1' : 'GitHub',
  );
  Future<CloudSource?> chooseSource(int github, int d1) =>
      chooseCloudAuthority(context, github, d1);
  final pick = pickSyncConflicts(context);
  if (selected == CloudSource.d1 &&
      d1 != null &&
      store.d1Connection == null &&
      session == store.archiveSession) {
    await store.connectD1(
      d1.target,
      d1.token,
      choose: choose,
      pick: pick,
      chooseSource: chooseSource,
    );
  } else if (selected == CloudSource.github &&
      github != null &&
      store.connection == null &&
      session == store.archiveSession) {
    await store.connect(
      github.target,
      github.token,
      choose: choose,
      pick: pick,
      chooseSource: chooseSource,
    );
  }
}

Future<void> connectD1Dialog(BuildContext context, AppStore store) async {
  final url = TextEditingController(text: store.d1Connection?.url),
      token = TextEditingController();
  final form = GlobalKey<FormState>();
  var working = false, error = '';
  try {
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialog) => StatefulBuilder(
        builder: (dialog, update) => PopScope(
          canPop: !working,
          child: AlertDialog(
            title: const Text('连接 Cloudflare D1'),
            content: SizedBox(
              width: 440,
              child: SingleChildScrollView(
                child: Form(
                  key: form,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('填写已部署的 Worker 根地址和配置的 ARCHIVE_TOKEN。'),
                      const SizedBox(height: 12),
                      ArchiveTextField(
                        controller: url,
                        enabled: !working && store.d1Connection == null,
                        autocorrect: false,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'Worker 地址',
                          hintText: 'https://example.workers.dev',
                        ),
                        validator: (value) {
                          try {
                            d1WorkerOrigin(value ?? '');
                            return null;
                          } on FormatException catch (e) {
                            return e.message;
                          }
                        },
                      ),
                      const SizedBox(height: 12),
                      ArchiveTextField(
                        controller: token,
                        enabled: !working,
                        obscureText: true,
                        autocorrect: false,
                        enableSuggestions: false,
                        decoration: const InputDecoration(labelText: '访问凭证'),
                        validator: (value) =>
                            (value ?? '').trim().isEmpty ? '请填写访问凭证' : null,
                      ),
                      if (error.isNotEmpty)
                        Text(
                          error,
                          style: TextStyle(
                            color: Theme.of(dialog).colorScheme.error,
                          ),
                        ),
                      if (working) const LinearProgressIndicator(),
                    ],
                  ),
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: working ? null : () => Navigator.pop(dialog),
                child: const Text('取消'),
              ),
              FilledButton(
                onPressed: working
                    ? null
                    : () async {
                        if (!form.currentState!.validate()) return;
                        update(() {
                          working = true;
                          error = '';
                        });
                        try {
                          final bound = await store.connectD1(
                            D1Connection(url.text),
                            token.text.trim(),
                            choose: (local, cloud) => chooseBinding(
                              dialog,
                              local,
                              cloud,
                              cloudName: 'D1',
                            ),
                            chooseSource: (github, d1) =>
                                chooseCloudAuthority(dialog, github, d1),
                            pick: pickSyncConflicts(dialog, newEdit: false),
                          );
                          if (bound && dialog.mounted) Navigator.pop(dialog);
                        } catch (failure) {
                          if (dialog.mounted) {
                            update(
                              () => error = failure.toString().replaceFirst(
                                'FormatException: ',
                                '',
                              ),
                            );
                          }
                        } finally {
                          if (dialog.mounted) update(() => working = false);
                        }
                      },
                child: Text(working ? '正在连接…' : '连接'),
              ),
            ],
          ),
        ),
      ),
    );
  } finally {
    url.dispose();
    token.dispose();
  }
}

void _showResetComplete(BuildContext context) {
  ScaffoldMessenger.of(context)
      .showSnackBar(const SnackBar(content: Text('云端票库已重置')));
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
  int cloudCount, {
  String cloudName = 'GitHub',
}) async {
  if (!context.mounted) return null;
  final choice = await showDialog<BindingChoice>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('选择首次同步方式'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('本机有 $localCount 张票据，$cloudName 有 $cloudCount 张票据。'),
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
                          chooseSource: (github, d1) =>
                              chooseCloudAuthority(context, github, d1),
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
