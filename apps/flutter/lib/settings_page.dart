import 'dart:convert';

import 'package:file_selector/file_selector.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'export_service.dart';
import 'ticket_detail.dart';
import 'profile_editor.dart';
import 'import_review.dart';

class SettingsPage extends StatefulWidget {
  final AppStore store;
  const SettingsPage(this.store, {super.key});
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  bool exporting = false;
  final choices = <String, bool>{};
  @override
  Widget build(BuildContext context) {
    final store = widget.store;
    Future<void> action(Future<void> Function() run) async {
      try {
        await run();
      } catch (error) {
        if (context.mounted) showError(context, error);
      }
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 48),
      children: [
        Text('数据与同步', style: Theme.of(context).textTheme.headlineLarge),
        const SectionTitle('私人票库'),
        Container(
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.cloud_outlined, color: ink, size: 32),
              const SizedBox(height: 16),
              Text(
                store.connection?.label ?? '尚未连接 GitHub',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 8),
              Text(store.status, style: const TextStyle(color: muted)),
              if (store.busy)
                const Padding(
                  padding: EdgeInsets.only(top: 16),
                  child: LinearProgressIndicator(),
                ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 12,
                runSpacing: 12,
                children: [
                  FilledButton.icon(
                    onPressed: store.busy
                        ? null
                        : () => connectDialog(context, store),
                    icon: const Icon(Icons.link),
                    label: Text(store.connected ? '更新连接凭证' : '连接私人票库'),
                  ),
                  if (store.connected)
                    OutlinedButton.icon(
                      onPressed: store.busy ? null : () => action(store.sync),
                      icon: const Icon(Icons.sync),
                      label: Text(store.busy ? '正在同步…' : '立即同步'),
                    ),
                ],
              ),
            ],
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
        OutlinedButton.icon(
          onPressed: store.busy
              ? null
              : () => openProfileEditor(context, store),
          icon: const Icon(Icons.person_outline),
          label: const Text('姓名与常用证件'),
        ),
        if (store.conflicts != null) ...[
          const SectionTitle('处理同步冲突'),
          const Text('同一字段在两端均有修改，请选择要保留的内容。'),
          const SizedBox(height: 16),
          for (final conflict in store.conflicts!.conflicts)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${conflict.localRecord.text('service')} · ${fieldLabels[conflict.field] ?? conflict.field}',
                  ),
                  RadioGroup<bool>(
                    groupValue: choices['${conflict.id}:${conflict.field}'],
                    onChanged: (value) => setState(
                      () =>
                          choices['${conflict.id}:${conflict.field}'] = value!,
                    ),
                    child: Column(
                      children: [
                        RadioListTile<bool>(
                          title: Text('本机：${conflict.local}'),
                          value: false,
                        ),
                        RadioListTile<bool>(
                          title: Text('云端：${conflict.remote}'),
                          value: true,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          for (final conflict
              in store.settingsConflicts?.conflicts ?? <SettingsConflict>[])
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(conflict.field == 'profile' ? '个人资料' : '飞常准设置'),
                  RadioGroup<bool>(
                    groupValue: choices['settings:${conflict.field}'],
                    onChanged: (value) => setState(
                      () => choices['settings:${conflict.field}'] = value!,
                    ),
                    child: Column(
                      children: [
                        for (final (remote, value) in [
                          (false, conflict.local),
                          (true, conflict.remote),
                        ])
                          RadioListTile<bool>(
                            value: remote,
                            title: Text(
                              '${remote ? '云端' : '本机'}：${conflict.field == 'flightMcpKey' ? '凭证已隐藏' : const JsonEncoder.withIndent('  ').convert(value)}',
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          FilledButton(
            onPressed: store.busy
                ? null
                : () => action(() => store.resolveConflicts(choices)),
            child: const Text('保留选择并同步'),
          ),
        ],
        const SectionTitle('导入与导出'),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            OutlinedButton.icon(
              onPressed: store.busy
                  ? null
                  : () => action(() async {
                      final file = await openFile(
                        acceptedTypeGroups: [
                          const XTypeGroup(
                            label: '行迹票库',
                            extensions: ['json', 'csv', 'txt'],
                          ),
                        ],
                      );
                      if (file != null) {
                        final text = await file.readAsString();
                        final extension = file.name
                            .split('.')
                            .last
                            .toLowerCase();
                        final records = extension == 'csv'
                            ? parseTicketCsv(text)
                            : extension == 'txt'
                            ? parseTicketText(
                                text,
                                store.catalog,
                                flight: RegExp(
                                  r'航班|登机|FLIGHT',
                                  caseSensitive: false,
                                ).hasMatch(text),
                              )
                            : TicketArchive.fromJson(jsonDecode(text)).records;
                        if (context.mounted) {
                          await reviewImport(context, store, records);
                        }
                      }
                    }),
              icon: const Icon(Icons.file_open_outlined),
              label: const Text('导入票库'),
            ),
            OutlinedButton.icon(
              onPressed: store.busy
                  ? null
                  : () => importTextDialog(context, store),
              icon: const Icon(Icons.text_snippet_outlined),
              label: const Text('粘贴行程文字'),
            ),
            OutlinedButton.icon(
              onPressed: () => action(
                () => saveFile(
                  'xingji-archive.json',
                  utf8.encode(
                    const JsonEncoder.withIndent('  ')
                        .convert(TicketArchive(store.privateRecords).toJson()),
                  ),
                  'application/json',
                ),
              ),
              icon: const Icon(Icons.save_alt),
              label: const Text('导出备份'),
            ),
            OutlinedButton.icon(
              onPressed: exporting || store.records.isEmpty
                  ? null
                  : () => action(() async {
                      setState(() => exporting = true);
                      try {
                        await saveFile(
                          '行迹旅行手册.pdf',
                          await travelBook(store.records, store.catalog),
                          'application/pdf',
                        );
                      } finally {
                        if (mounted) setState(() => exporting = false);
                      }
                    }),
              icon: const Icon(Icons.menu_book_outlined),
              label: Text(exporting ? '正在生成手册…' : '导出旅行手册'),
            ),
          ],
        ),
        const SizedBox(height: 24),
        const SectionTitle('重置与清理'),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            if (store.connected)
              OutlinedButton.icon(
                onPressed: store.busy
                    ? null
                    : () => action(() async {
                        if (await confirmDeletion(
                          context,
                          title: '重置私人仓库？',
                          description:
                              '清空 ${store.connection!.label} 当前分支的票据、线路、时刻表、删除标记和其他文件。保留个人资料、飞常准设置及 Git 历史。',
                          confirmLabel: '确认重置仓库',
                        )) {
                          await store.resetRepository();
                        }
                      }),
                icon: const Icon(Icons.restart_alt),
                label: Text(store.busy ? '正在处理…' : '重置仓库'),
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
          'GitHub 凭证仅在本次应用会话中使用。票据保存在本机，连接私人票库后可同步到其他设备。',
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

Future<void> connectDialog(BuildContext context, AppStore store) async {
  final owner = TextEditingController(text: store.connection?.owner ?? ''),
      repo = TextEditingController(text: store.connection?.repository ?? ''),
      token = TextEditingController(),
      branch = TextEditingController(text: store.connection?.branch ?? 'main');
  final form = GlobalKey<FormState>();
  var busy = false, error = '';
  await showDialog(
    context: context,
    barrierDismissible: false,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => PopScope(
        canPop: !busy,
        child: AlertDialog(
          title: const Text('连接私人票库'),
          content: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: SingleChildScrollView(
              child: Form(
                key: form,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final (controller, label, secret) in [
                      (owner, 'GitHub 用户名', false),
                      (repo, '私人仓库名称', false),
                      (branch, '分支', false),
                      (token, '访问令牌', true),
                    ])
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: TextFormField(
                          controller: controller,
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
                      update(() {
                        busy = true;
                        error = '';
                      });
                      try {
                        await store.connect(
                          GitHubConnection(
                            owner.text.trim(),
                            repo.text.trim(),
                            branch: branch.text.trim(),
                          ),
                          token.text.trim(),
                        );
                        if (context.mounted) Navigator.pop(context);
                      } catch (failure) {
                        update(
                          () => error = failure.toString().replaceFirst(
                            'FormatException: ',
                            '',
                          ),
                        );
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
  for (final controller in [owner, repo, token, branch]) {
    controller.dispose();
  }
}
