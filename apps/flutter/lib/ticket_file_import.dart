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
    _isFlightText(result.lines.map((line) => line.text).join('\n'));

bool _isFlightText(String text) => RegExp(
  r'航班|登机|出发机场|到达机场|乘机|\b(?:FLIGHT|BOARDING PASS|AIRPORT)\b|\b[A-Z]{2}\s*\d{2,5}[A-Z]?\b',
  caseSensitive: false,
).hasMatch(text);

bool _hasJourney(TicketRecord record) =>
    record.text('service').isNotEmpty ||
    ['origin', 'destination'].every((key) => record.text(key).isNotEmpty);

Future<List<TicketRecord>> recognizeTicketImage(
  Uint8List? bytes,
  ReferenceCatalog catalog, {
  bool? flight,
  RecognitionResult? live,
  bool scanPhotoBarcode = false,
}) async {
  final provider = SystemRecognition();
  final liveCodes =
      live?.barcodes
          .where((code) => decodeBoardingBytes(code) != null)
          .toList() ??
      [];
  var photo = RecognitionResult();
  if (bytes != null) {
    try {
      photo = await provider.recognize(
        bytes,
        flight: flight ?? true,
        barcodes: scanPhotoBarcode || liveCodes.isEmpty,
      );
    } on PlatformException catch (error) {
      if (error.code != 'vision_failed') rethrow;
    }
  }
  final photoCodes = photo.barcodes
      .where((code) => decodeBoardingBytes(code) != null)
      .toList();
  final livePayloads = liveCodes.map(base64Encode).toSet();
  final anotherBarcode =
      livePayloads.isNotEmpty &&
      photoCodes.any((code) => !livePayloads.contains(base64Encode(code)));
  final liveLines = anotherBarcode
      ? const <RecognitionLine>[]
      : live?.lines ?? const <RecognitionLine>[];
  final liveText = recognizedTicketText(liveLines);
  final reading = RecognitionResult(
    lines: photo.lines,
    barcodes: photoCodes.isNotEmpty || liveCodes.isEmpty
        ? photo.barcodes
        : liveCodes,
    symbolData: photo.symbolData,
  );
  final hasBarcode = reading.barcodes.any(
    (code) => decodeBoardingBytes(code) != null,
  );
  final fallback = parseRecognition(
    reading,
    catalog,
    flight:
        hasBarcode || (flight ?? _isFlight(reading) || _isFlightText(liveText)),
    supplementalText: liveText,
  ).where(_hasJourney).toList();
  // An image model extracts one ticket, so its fields cannot be assigned to
  // individual coupons from a multi-leg barcode.
  if (fallback.length > 1) return fallback;

  final photoText = recognizedTicketText(photo.lines);
  final text = [
    if (photoText.isNotEmpty) photoText,
    if (liveText.isNotEmpty) liveText,
  ].join('\n');
  try {
    final capabilities = await provider.capabilities();
    final fields =
        bytes != null && capabilities['appleIntelligenceImage'] == true
        ? await provider.extractTicketImage(
            bytes,
            text,
            flight: hasBarcode ? true : flight,
          )
        : text.isNotEmpty && capabilities['appleIntelligence'] == true
        ? _groundedFields(await provider.extractTicketText(text), text)
        : null;
    if (_recognizedTicket(fields, fallback.firstOrNull, catalog, flight: flight)
        case final ticket? when _hasJourney(ticket)) {
      return [ticket];
    }
  } on PlatformException {
    // Availability can change after the capabilities check.
  } on MissingPluginException {
    // The local result is usable on hosts without a model channel.
  }
  return fallback;
}

Future<List<TicketRecord>> recognizeTicketText(
  String text,
  ReferenceCatalog catalog,
) async {
  final barcode = boardingRecords(utf8.encode(text), catalog);
  if (barcode.isNotEmpty) return barcode;
  final fallback = parseTicketText(text, catalog, flight: _isFlightText(text));
  final provider = SystemRecognition();
  if (fallback.length > 1) return fallback;
  try {
    if (!await provider.supports('appleIntelligence')) return fallback;
    final fields = _groundedFields(
      await provider.extractTicketText(text),
      text,
    );
    if (_recognizedTicket(fields, fallback.firstOrNull, catalog)
        case final ticket? when _hasJourney(ticket)) {
      return [ticket];
    }
  } on PlatformException {
    // Keep the deterministic text result when the model cannot process it.
  } on MissingPluginException {
    // Text parsing works on platforms without a native model.
  }
  return fallback;
}

Map<String, dynamic>? _groundedFields(
  Map<String, dynamic>? fields,
  String text,
) {
  if (fields == null) return null;
  String compact(String value) =>
      value.toUpperCase().replaceAll(RegExp(r'[\s·]'), '');
  final source = compact(text);
  final dates = RegExp(r'(?:19|20)\d{2}[年./-]\d{1,2}[月./-]\d{1,2}日?')
      .allMatches(source)
      .map((match) => parsePrintedJourneyDate(match[0])?.calendarText)
      .toSet();
  return {
    for (final MapEntry(:key, :value) in fields.entries)
      if (value is String &&
          value.trim().isNotEmpty &&
          (key == 'type' ||
              (key.endsWith('Date')
                  ? dates.contains(value)
                  : source.contains(compact(value)))))
        key: value,
  };
}

TicketRecord? _recognizedTicket(
  Map<String, dynamic>? fields,
  TicketRecord? fallback,
  ReferenceCatalog catalog, {
  bool? flight,
}) {
  if (fields == null) return fallback;
  final type = switch (fields['type']) {
    'rail' => 'rail',
    'flight' => 'flight',
    _ when flight != null => flight ? 'flight' : 'rail',
    _ => null,
  };
  if (type == null && fallback == null) return null;
  if (fallback != null && type != null && fallback.text('type') != type) {
    return fallback;
  }
  return _mergeTicketFields(
    fallback ?? TicketRecord.create({'type': type}),
    fields,
    catalog,
  );
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
    } else if (key == 'gate' && record.isFlight) {
      if (isPrintedFlightGate(value)) changes[key] = value.toUpperCase();
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
  return tickets;
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
    'txt' => recognizeTicketText(text, catalog),
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
  final archiveSession = store.archiveSession;
  final data = await AppleServices.sharedTicketData(file.id);
  final records = await readTicketAttachment(data, file.kind, store.catalog);
  if (context.mounted &&
      archiveSession == store.archiveSession &&
      await reviewImport(context, store, records)) {
    await AppleServices.removeSharedTicket(file.id);
  }
}
