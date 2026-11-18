import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'import_review.dart';
import 'platform_services.dart';
import 'wallet_pass.dart';

bool _isFlight(RecognitionResult result) =>
    result.barcodes.any((bytes) => decodeBoardingBytes(bytes) != null) ||
    RegExp(
      r'航班|登机|机场|乘机|\b(?:FLIGHT|BOARDING PASS|AIRPORT)\b',
      caseSensitive: false,
    ).hasMatch(result.lines.map((line) => line.text).join('\n'));

Future<List<TicketRecord>> recognizeTicketImage(
  Uint8List bytes,
  ReferenceCatalog catalog, {
  bool? flight,
  RecognitionResult? live,
}) async {
  final provider = SystemRecognition();
  RecognitionResult photo;
  try {
    photo = await provider.recognize(bytes, flight: flight ?? true);
  } on PlatformException catch (error) {
    if (error.code != 'vision_failed') rethrow;
    photo = RecognitionResult();
  }
  final liveCodes = live?.barcodes
      .where((code) => decodeBoardingBytes(code) != null)
      .toList();
  final encoded = liveCodes?.isNotEmpty == true ? liveCodes! : photo.barcodes;
  final hasBoarding = encoded.any((code) => decodeBoardingBytes(code) != null);
  final barcodeRecords = hasBoarding
      ? parseRecognition(
          RecognitionResult(barcodes: encoded),
          catalog,
          flight: true,
        )
      : const <TicketRecord>[];

  Map<String, dynamic>? fields;
  try {
    fields = await provider.extractTicketImage(
      bytes,
      recognizedTicketText([...photo.lines, ...?live?.lines]),
      flight: hasBoarding ? true : flight,
    );
  } catch (_) {
    if (barcodeRecords.isEmpty) rethrow;
  }
  if (barcodeRecords.length > 1) return barcodeRecords;
  if (fields == null && barcodeRecords.isNotEmpty) return barcodeRecords;
  if (fields == null) {
    throw const FormatException('Apple Intelligence 没有读出票据信息');
  }
  final record =
      barcodeRecords.firstOrNull ??
      _newRecognizedTicket(fields, flight: flight);
  return [_mergeTicketFields(record, fields, catalog)];
}

Future<List<TicketRecord>> recognizeTicketText(
  String text,
  ReferenceCatalog catalog,
) async {
  final barcode = boardingRecords(utf8.encode(text), catalog);
  if (barcode.isNotEmpty) return barcode;
  final fields = await SystemRecognition().extractTicketText(text);
  if (fields == null) {
    throw const FormatException('Apple Intelligence 没有读出行程文字');
  }
  return [_mergeTicketFields(_newRecognizedTicket(fields), fields, catalog)];
}

TicketRecord _newRecognizedTicket(Map<String, dynamic> fields, {bool? flight}) {
  final type = switch (fields['type']) {
    'rail' => 'rail',
    'flight' => 'flight',
    _ when flight != null => flight ? 'flight' : 'rail',
    _ => throw const FormatException('无法判断这是火车票还是机票'),
  };
  return TicketRecord.create({'type': type});
}

TicketRecord _mergeTicketFields(
  TicketRecord record,
  Map<String, dynamic> fields,
  ReferenceCatalog catalog,
) {
  final changes = <String, dynamic>{};
  for (final key in [
    'service',
    'origin',
    'destination',
    'departureDate',
    'departureTime',
    'arrivalDate',
    'arrivalTime',
    'boardingTime',
    'gate',
    'terminal',
    'passenger',
    'seat',
    'seatClass',
    'carriage',
    'price',
  ]) {
    if (record.barcodeLocked(key) ||
        (key != 'departureDate' && record.text(key).isNotEmpty)) {
      continue;
    }
    final input = fields[key];
    if (input is! String || input.trim().isEmpty || input.length > 120) {
      continue;
    }
    final value = input.trim();
    if (key.endsWith('Date')) {
      final date = parsePrintedJourneyDate(value);
      if (date == null) continue;
      final saved = JourneyDate.fromJson(record[key]);
      if (saved?.dayOfYear != null && saved!.dayOfYear != date.dayOfYear) {
        continue;
      }
      if (saved?.complete == true) continue;
      changes[key] = date.toJson();
    } else if (key.endsWith('Time')) {
      if (RegExp(r'^(?:[01]?\d|2[0-3]):[0-5]\d$').hasMatch(value)) {
        changes[key] = value.padLeft(5, '0');
      }
    } else if (key == 'service') {
      final code = value.toUpperCase().replaceAll(RegExp(r'\s+'), '');
      final pattern = record.isFlight
          ? r'^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{1,5}[A-Z]?$'
          : r'^[GDCZTKLSY]?\d{1,5}$';
      if (RegExp(pattern).hasMatch(code)) changes[key] = code;
    } else if (key == 'price') {
      if (RegExp(r'^\d+(?:\.\d{1,2})?$').hasMatch(value)) changes[key] = value;
    } else {
      changes[key] = value;
    }
  }
  final sources = {...record.fieldSources};
  for (final key in changes.keys) {
    if (key == 'departureDate' && record.departure?.dayOfYear != null) {
      sources['departureDateYear'] = 'ocr';
    } else {
      sources[key] = 'ocr';
    }
  }
  return catalog.normalize(
    record.withChanges({...changes, 'fieldSources': sources}),
  );
}

Future<List<TicketRecord>> readTicketAttachment(
  Uint8List bytes,
  String kind,
  ReferenceCatalog catalog,
) async {
  if (kind == 'pkpass') return readWalletBoardingPass(bytes, catalog);
  if (kind == 'image') return recognizeTicketImage(bytes, catalog);
  final provider = SystemRecognition();
  final pages = switch (kind) {
    'pdf' => await provider.recognizePdf(bytes),
    _ => throw const FormatException('请选择 PDF、图片或钱包登机牌'),
  };
  final tickets = <TicketRecord>[];
  for (final page in pages) {
    final flight = _isFlight(page);
    final records = parseRecognition(page, catalog, flight: flight);
    for (final ticket in records) {
      if (ticket.text('service').isEmpty &&
          ['origin', 'destination'].any((key) => ticket.text(key).isEmpty)) {
        continue;
      }
      tickets.add(
        ticket.withChanges({
          'sources': [
            {
              'kind': kind == 'pdf' ? 'pdf' : 'scan',
              'label': kind == 'pdf' ? 'PDF 导入' : '图片导入',
              'at': utcNow(),
            },
          ],
          if (kind == 'pdf')
            'fieldSources': {
              for (final entry in ticket.fieldSources.entries)
                entry.key: entry.value == 'ocr' ? 'pdf' : entry.value,
            },
        }),
      );
    }
  }
  return deduplicateTickets(tickets, catalog);
}

Future<List<TicketRecord>> readLocalImport(
  String name,
  Uint8List bytes,
  ReferenceCatalog catalog,
) async {
  final extension = name.split('.').last.toLowerCase();
  if (extension == 'pdf' || extension == 'pkpass') {
    return readTicketAttachment(bytes, extension, catalog);
  }
  if ([
    'jpg',
    'jpeg',
    'png',
    'heic',
    'heif',
    'webp',
    'tiff',
  ].contains(extension)) {
    return readTicketAttachment(bytes, 'image', catalog);
  }
  final text = utf8.decode(bytes);
  return switch (extension) {
    'csv' => parseTicketCsv(text),
    'txt' => parseTicketText(
      text,
      catalog,
      flight: RegExp(r'航班|登机|FLIGHT', caseSensitive: false).hasMatch(text),
    ),
    _ => throw const FormatException('不支持这个文件格式'),
  };
}

Future<void> reviewSharedTickets(BuildContext context, AppStore store) async {
  final files = await AppleServices.sharedTicketFiles();
  final directShare = await AppleServices.directShareAvailable();
  if (!context.mounted) return;
  final selected = await showDialog<({TicketImportFile file, bool discard})>(
    context: context,
    builder: (dialog) => AlertDialog(
      title: const Text('分享收件箱'),
      content: SizedBox(
        width: 500,
        child: ListView(
          shrinkWrap: true,
          children: [
            if (files.isEmpty)
              Text(
                directShare
                    ? '在系统分享菜单选择「行迹」，即可收集照片、PDF 或电子登机牌。'
                    : '可以用快捷指令「收集票据文件」，也可以先存到「文件」，再从「＋ → 上传」选择。',
              ),
            for (final file in files)
              ListTile(
                title: Text(
                  file.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                onTap: () =>
                    Navigator.pop(dialog, (file: file, discard: false)),
                trailing: IconButton(
                  tooltip: '移除此待导入文件',
                  icon: const Icon(Icons.close),
                  onPressed: () =>
                      Navigator.pop(dialog, (file: file, discard: true)),
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialog),
          child: const Text('关闭'),
        ),
      ],
    ),
  );
  if (!context.mounted || selected == null) return;
  final file = selected.file;
  if (selected.discard) {
    await AppleServices.removeSharedTicket(file.id);
    return;
  }
  if (!store.canWrite) {
    showError(context, store.readOnlyReason ?? '票库暂时不可写');
    return;
  }
  final data = await AppleServices.sharedTicketData(file.id);
  final records = await readTicketAttachment(data, file.kind, store.catalog);
  if (context.mounted && await reviewImport(context, store, records)) {
    await AppleServices.removeSharedTicket(file.id);
  }
}
