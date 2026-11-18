import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'import_review.dart';
import 'platform_services.dart';

Future<void> importPendingTravelMessages(AppStore store) async {
  if (!AppleServices.available || !store.canWrite) return;
  for (final message in await AppleServices.travelMessages()) {
    if (!store.canWrite) return;
    final parsed = parseTravelMessage(
      message.text,
      store.catalog,
      receivedAt: message.receivedAt,
    );
    if (!parsed.automatic) continue;
    // A retry after the archive commits and before the inbox updates is idempotent.
    final ticket = parsed.records.single.withChanges({'id': message.id});
    if (!store.privateRecords.any((record) => record.ids.contains(ticket.id))) {
      await store.importArchive(TicketArchive([ticket]));
    }
    await AppleServices.acknowledgeTravelMessage(message.id);
  }
}

Future<void> showTravelMessageInbox(
  BuildContext context,
  AppStore store,
) async {
  final inbox = await AppleServices.travelMessages();
  if (!context.mounted) return;
  final selected = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('行程短信'),
      content: SizedBox(
        width: 540,
        child: ListView(
          shrinkWrap: true,
          children: [
            const Text(
              '在「快捷指令」创建收到信息时运行的自动化，筛选 12306 或订票服务的来信。'
              '添加「导入行程短信」，把收到的信息正文传给它。符合条件的行程将在行迹前台自动入库。',
            ),
            if (inbox.isEmpty)
              const Padding(
                padding: EdgeInsets.only(top: 12),
                child: Text('没有待处理的短信'),
              ),
            for (final message in inbox)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  message.text,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: () => Navigator.pop(context, message.id),
                trailing: IconButton(
                  tooltip: '忽略此短信',
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.pop(context, '-${message.id}'),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('关闭'),
        ),
      ],
    ),
  );
  if (selected == null || !context.mounted) return;
  if (selected.startsWith('-')) {
    await AppleServices.acknowledgeTravelMessage(selected.substring(1));
    return;
  }
  final message = inbox.firstWhere((row) => row.id == selected);
  final parsed = parseTravelMessage(
    message.text,
    store.catalog,
    receivedAt: message.receivedAt,
  );
  if (!store.canWrite) {
    showError(context, store.readOnlyReason ?? '票库暂时不可写');
    return;
  }
  final saved = parsed.records.isEmpty
      ? await importTextDialog(context, store, initialText: message.text)
      : await reviewImport(context, store, parsed.records);
  if (saved) await AppleServices.acknowledgeTravelMessage(message.id);
}
