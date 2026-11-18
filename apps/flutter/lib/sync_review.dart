import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'field_labels.dart';

Future<bool> checkArchiveWrite(BuildContext context, AppStore store) async {
  try {
    await store.checkWriteAccess();
    return context.mounted;
  } catch (error) {
    if (context.mounted) showError(context, error);
    return false;
  }
}

PickConflicts pickSyncConflicts(BuildContext context, {bool newEdit = true}) =>
    (tickets, settings) {
      if (!context.mounted) return Future.value(null);
      return showDialog<Map<String, bool>>(
        context: context,
        builder: (_) => _SyncReviewDialog(tickets, settings, newEdit),
      );
    };

class _SyncReviewDialog extends StatefulWidget {
  final ArchiveMerge tickets;
  final SettingsMerge settings;
  final bool newEdit;
  const _SyncReviewDialog(this.tickets, this.settings, this.newEdit);

  @override
  State<_SyncReviewDialog> createState() => _SyncReviewDialogState();
}

class _SyncReviewDialogState extends State<_SyncReviewDialog> {
  final choices = <String, bool>{};

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('两端都有修改'),
    content: SizedBox(
      width: 520,
      child: SingleChildScrollView(
        child: SyncChoices(
          tickets: widget.tickets,
          settings: widget.settings,
          choices: choices,
          onChoose: (key, value) => setState(() => choices[key] = value),
          newEdit: widget.newEdit,
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('返回'),
      ),
      FilledButton(
        onPressed:
            choices.length !=
                widget.tickets.conflicts.length +
                    widget.settings.conflicts.length
            ? null
            : () => Navigator.pop(context, choices),
        child: const Text('按选择保存'),
      ),
    ],
  );
}

class SyncChoices extends StatelessWidget {
  final ArchiveMerge tickets;
  final SettingsMerge? settings;
  final Map<String, bool> choices;
  final void Function(String, bool) onChoose;
  final bool newEdit;
  const SyncChoices({
    super.key,
    required this.tickets,
    required this.settings,
    required this.choices,
    required this.onChoose,
    this.newEdit = false,
  });

  String ticketValue(ArchiveConflict conflict, Object? value) {
    if (conflict.field == 'deleted') return value == true ? '删除票据' : '保留票据';
    if (value == null || value == '') return '空白';
    return value.toString();
  }

  Widget _choice(String key, String label, String local, String cloud) =>
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label),
            RadioGroup<bool>(
              groupValue: choices[key],
              onChanged: (value) {
                if (value != null) onChoose(key, value);
              },
              child: Column(
                children: [
                  RadioListTile<bool>(
                    title: Text('${newEdit ? '本次修改' : '本机'}：$local'),
                    value: false,
                  ),
                  RadioListTile<bool>(title: Text('云端：$cloud'), value: true),
                ],
              ),
            ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      const Text('请选择每项要保留的内容。'),
      const SizedBox(height: 16),
      for (final conflict in tickets.conflicts)
        _choice(
          '${conflict.id}:${conflict.field}',
          '${conflict.localRecord.text('service')} · ${fieldLabels[conflict.field] ?? (conflict.field == 'deleted' ? '删除状态' : conflict.field)}',
          ticketValue(conflict, conflict.local),
          ticketValue(conflict, conflict.remote),
        ),
      for (final conflict in settings?.conflicts ?? <SettingsConflict>[])
        _choice(
          'settings:${conflict.field}',
          switch (conflict.field) {
            'profile' => '个人资料',
            'connections' => '云端账号设置',
            _ => '飞常准设置',
          },
          conflict.field == 'profile' ? jsonEncode(conflict.local) : '凭证已隐藏',
          conflict.field == 'profile' ? jsonEncode(conflict.remote) : '凭证已隐藏',
        ),
    ],
  );
}

class ArchiveEditControls extends StatelessWidget {
  final bool enabled;
  final bool busy;
  final Widget child;
  const ArchiveEditControls({
    super.key,
    required this.enabled,
    required this.busy,
    required this.child,
  });

  @override
  Widget build(BuildContext context) => ExcludeFocus(
    excluding: !enabled && !busy,
    child: AbsorbPointer(absorbing: busy || !enabled, child: child),
  );
}
