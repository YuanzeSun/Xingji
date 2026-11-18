import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'archive_text_field.dart';
import 'sync_review.dart';
import 'design.dart';

Future<bool> reviewImport(
  BuildContext context,
  AppStore store,
  List<TicketRecord> records, {
  Map<String, dynamic>? backupSettings,
}) async {
  if (records.isEmpty && backupSettings == null) {
    showError(context, '没有识别到可导入的票据');
    return false;
  }
  final selected = records.map((record) => record.id).toSet();
  var saving = false;
  String error = '';
  return await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (context) => StatefulBuilder(
          builder: (context, update) => PopScope(
            canPop: !saving,
            child: AlertDialog(
              title: Text('核对 ${records.length} 张票据'),
              content: SizedBox(
                width: 600,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (backupSettings != null)
                      const Padding(
                        padding: EdgeInsets.only(bottom: 12),
                        child: Text('个人资料和飞常准 MCP 设置将以备份为准。'),
                      ),
                    if (records.isNotEmpty)
                      Flexible(
                        child: ListView(
                          shrinkWrap: true,
                          children: [
                            for (final record in records)
                              CheckboxListTile(
                                value: selected.contains(record.id),
                                onChanged: saving
                                    ? null
                                    : (value) => update(() {
                                        if (value == true) {
                                          selected.add(record.id);
                                        } else {
                                          selected.remove(record.id);
                                        }
                                      }),
                                title: Text(
                                  '${record.text('service')}  ${record.text('origin')} → ${record.text('destination')}',
                                ),
                                subtitle: Text(
                                  '${record.departure?.complete == true ? record.departure!.label : '日期未知'}${record.missingFields.isEmpty ? '' : '\n部分信息待补全，可导入后编辑'}',
                                ),
                              ),
                          ],
                        ),
                      ),
                    if (error.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 12),
                        child: Text(
                          error,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    if (saving) const LinearProgressIndicator(),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: saving
                      ? null
                      : () => Navigator.pop(context, false),
                  child: const Text('取消'),
                ),
                FilledButton(
                  onPressed:
                      saving || (selected.isEmpty && backupSettings == null)
                      ? null
                      : () async {
                          update(() {
                            saving = true;
                            error = '';
                          });
                          try {
                            await store.importArchive(
                              TicketArchive(
                                records
                                    .where(
                                      (record) => selected.contains(record.id),
                                    )
                                    .toList(),
                              ),
                              backupSettings: backupSettings,
                              pick: pickSyncConflicts(context),
                            );
                            if (context.mounted) Navigator.pop(context, true);
                          } catch (failure) {
                            if (context.mounted) {
                              update(() {
                                saving = false;
                                error = failure.toString();
                              });
                            }
                          }
                        },
                  child: Text(
                    saving
                        ? '正在导入…'
                        : backupSettings == null
                        ? '导入 ${selected.length} 张'
                        : '恢复票库和设置',
                  ),
                ),
              ],
            ),
          ),
        ),
      ) ??
      false;
}

Future<bool> importTextDialog(
  BuildContext context,
  AppStore store, {
  String initialText = '',
}) async {
  final text = TextEditingController(text: initialText);
  var flight = RegExp(
    r'航班|登机|乘机|机场|FLIGHT',
    caseSensitive: false,
  ).hasMatch(initialText);
  final result = await showDialog<List<TicketRecord>>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => AlertDialog(
        title: const Text('粘贴行程文字'),
        content: SizedBox(
          width: 560,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(value: false, label: Text('火车票')),
                    ButtonSegment(value: true, label: Text('机票')),
                  ],
                  selected: {flight},
                  onSelectionChanged: (value) =>
                      update(() => flight = value.single),
                ),
                const SizedBox(height: 16),
                ArchiveTextField(
                  controller: text,
                  minLines: 6,
                  maxLines: 12,
                  decoration: const InputDecoration(labelText: '行程、订单或邮件正文'),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () {
              try {
                Navigator.pop(
                  context,
                  parseTicketText(text.text, store.catalog, flight: flight),
                );
              } catch (error) {
                showError(context, error);
              }
            },
            child: const Text('识别并核对'),
          ),
        ],
      ),
    ),
  );
  text.dispose();
  if (result != null && context.mounted) {
    return reviewImport(context, store, result);
  }
  return false;
}
