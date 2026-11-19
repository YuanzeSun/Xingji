import 'package:cupertino_ui/cupertino_ui.dart' show CupertinoIcons;
import 'package:file_selector/file_selector.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'editor.dart';
import 'import_review.dart';
import 'platform_services.dart';
import 'ticket_file_import.dart';
import 'sync_review.dart';

enum TicketEntry { camera, upload, write, paste }

Future<void> openTicketEntry(
  BuildContext context,
  AppStore store, {
  TicketEntry? choice,
}) async {
  if (!await checkArchiveWrite(context, store) || !context.mounted) return;
  final archiveSession = store.archiveSession;
  final entry = choice ?? await _chooseEntry(context);
  if (entry == null ||
      !context.mounted ||
      archiveSession != store.archiveSession) {
    return;
  }
  try {
    final List<TicketRecord>? records;
    switch (entry) {
      case TicketEntry.camera:
        records = await _scan(context, store.catalog);
      case TicketEntry.upload:
        records = await _upload(context, store.catalog);
      case TicketEntry.paste:
        records = await _paste(context, store.catalog);
      case TicketEntry.write:
        await openEditor(context, store);
        return;
    }
    if (!context.mounted ||
        records == null ||
        archiveSession != store.archiveSession) {
      return;
    }
    final ticket = records.length == 1 ? records.single : null;
    if (records.isEmpty ||
        ticket != null &&
            [
              'service',
              'origin',
              'destination',
            ].every((key) => ticket.text(key).isEmpty)) {
      throw const FormatException('未识别到车次、航班号或起讫地点');
    }
    if (ticket == null) {
      await reviewImport(context, store, records);
    } else {
      await openEditor(context, store, recognized: ticket);
    }
  } catch (error) {
    if (context.mounted && archiveSession == store.archiveSession) {
      showError(
        context,
        error is PlatformException ? error.message ?? error : error,
      );
    }
  }
}

Future<TicketEntry?> _chooseEntry(
  BuildContext context,
) => showModalBottomSheet<TicketEntry>(
  context: context,
  showDragHandle: true,
  builder: (context) => SafeArea(
    child: SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final (choice, title, icon) in const [
            (TicketEntry.camera, '扫描', CupertinoIcons.camera),
            (TicketEntry.upload, '上传', CupertinoIcons.arrow_up_doc),
            (TicketEntry.write, '手动填写', CupertinoIcons.pencil),
            (TicketEntry.paste, '粘贴', CupertinoIcons.doc_on_clipboard),
          ])
            ListTile(
              leading: Icon(icon, color: ink),
              title: Text(title),
              enabled: choice != TicketEntry.camera || AppleServices.available,
              onTap: choice == TicketEntry.camera && !AppleServices.available
                  ? null
                  : () => Navigator.pop(context, choice),
            ),
        ],
      ),
    ),
  ),
);

Future<List<TicketRecord>?> _scan(
  BuildContext context,
  ReferenceCatalog catalog,
) async {
  final provider = SystemRecognition();
  if (await provider.supports('liveBoarding')) {
    if (!context.mounted) return null;
    final capture = await provider.scanLiveBoarding();
    if (capture == null || !context.mounted) return null;
    final hasBoarding = capture.reading.barcodes.any(
      (code) => decodeBoardingBytes(code) != null,
    );
    final image = capture.retryWithDocumentCamera && !hasBoarding
        ? await AppleServices.scanDocument()
        : capture.image;
    if (!context.mounted || (image == null && !hasBoarding)) return null;
    return _recognizing(
      context,
      () => recognizeTicketImage(image, catalog, live: capture.reading),
    );
  }
  if (!context.mounted) return null;
  final image = await AppleServices.scanDocument();
  if (image == null || !context.mounted) return null;
  return _recognizing(context, () => recognizeTicketImage(image, catalog));
}

Future<List<TicketRecord>?> _upload(
  BuildContext context,
  ReferenceCatalog catalog,
) async {
  final source = AppleServices.available
      ? await AppleServices.chooseUploadSource()
      : await showModalBottomSheet<String>(
          context: context,
          builder: (context) => SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                ListTile(
                  title: const Text('上传图片'),
                  onTap: () => Navigator.pop(context, 'photos'),
                ),
                ListTile(
                  title: const Text('上传文件'),
                  onTap: () => Navigator.pop(context, 'files'),
                ),
              ],
            ),
          ),
        );
  if (source == null || !context.mounted) return null;
  if (source == 'photos' && AppleServices.available) {
    final image = await AppleServices.pickPhoto();
    if (image == null || !context.mounted) return null;
    return _recognizing(context, () => recognizeTicketImage(image, catalog));
  }
  const imageExtensions = [
    'jpg',
    'jpeg',
    'png',
    'heic',
    'heif',
    'webp',
    'tiff',
  ];
  final file = await openFile(
    acceptedTypeGroups: [
      if (source == 'photos')
        const XTypeGroup(
          label: '票据图片',
          extensions: imageExtensions,
          uniformTypeIdentifiers: ['public.image'],
        )
      else
        const XTypeGroup(
          label: '票据文件',
          extensions: ['pdf', 'pkpass', ...imageExtensions],
          uniformTypeIdentifiers: [
            'public.image',
            'com.adobe.pdf',
            'com.apple.pkpass',
          ],
        ),
    ],
  );
  if (file == null || !context.mounted) return null;
  if (await file.length() > 40_000_000) {
    throw const FormatException('请选择 40 MB 以内的票据文件');
  }
  if (!context.mounted) return null;
  return _recognizing(context, () async {
    final bytes = await file.readAsBytes();
    return readLocalImport(file.name, bytes, catalog);
  });
}

Future<List<TicketRecord>?> _paste(
  BuildContext context,
  ReferenceCatalog catalog,
) async {
  final data = AppleServices.available
      ? await AppleServices.pasteTicket()
      : {'text': (await Clipboard.getData(Clipboard.kTextPlain))?.text};
  if (!context.mounted) return null;
  if (data?['text'] case final String text when text.trim().isNotEmpty) {
    return _recognizing(context, () => recognizeTicketText(text, catalog));
  }
  if (data?['image'] case final Uint8List bytes) {
    return _recognizing(context, () => recognizeTicketImage(bytes, catalog));
  }
  throw const FormatException('剪贴板中没有可识别的票据文字或图片');
}

Future<List<TicketRecord>> _recognizing(
  BuildContext context,
  Future<List<TicketRecord>> Function() recognize,
) async {
  final navigator = Navigator.of(context, rootNavigator: true);
  final route = DialogRoute<void>(
    context: context,
    barrierDismissible: false,
    builder: (context) => const PopScope(
      canPop: false,
      child: AlertDialog.adaptive(title: Text('正在识别票据…')),
    ),
  );
  navigator.push(route);
  try {
    return await recognize();
  } finally {
    if (route.isActive) navigator.removeRoute(route);
  }
}
