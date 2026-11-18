import 'dart:convert';
import 'dart:typed_data';

import 'ticket_record.dart';
import 'reference_catalog.dart';
import 'journey_date.dart';
import 'boarding_decoder.dart';
import 'code_data.dart';

class RecognitionLine {
  final String text;
  final double x, y, width, height, confidence;
  RecognitionLine(
    this.text,
    this.x,
    this.y,
    this.width,
    this.height,
    this.confidence,
  );
  factory RecognitionLine.fromJson(Map<String, dynamic> row) => RecognitionLine(
    row['text'] as String,
    (row['x'] as num).toDouble(),
    (row['y'] as num).toDouble(),
    (row['width'] as num).toDouble(),
    (row['height'] as num).toDouble(),
    (row['confidence'] as num).toDouble(),
  );
}

class RecognitionResult {
  final List<RecognitionLine> lines;
  final List<Uint8List> barcodes;
  final List<Map<String, dynamic>> symbolData;
  RecognitionResult({
    this.lines = const [],
    this.barcodes = const [],
    this.symbolData = const [],
  });
  factory RecognitionResult.fromJson(Map<String, dynamic> value) =>
      RecognitionResult(
        lines: (value['lines'] as List? ?? [])
            .map(
              (row) => RecognitionLine.fromJson(Map<String, dynamic>.from(row)),
            )
            .toList(),
        barcodes: (value['barcodes'] as List? ?? [])
            .map(
              (row) =>
                  Uint8List.fromList(base64Decode(row['rawBytes'] as String)),
            )
            .toList(),
        symbolData: (value['barcodes'] as List? ?? [])
            .where((row) => row['codeData'] is Map)
            .map((row) {
              final data = normalizeCodeData(row['codeData']);
              if (data['rawBytes'] != row['rawBytes']) {
                throw const FormatException('条码字节与重建数据不一致');
              }
              return data;
            })
            .toList(),
      );
}

abstract interface class RecognitionService {
  Future<bool> available();
  Future<RecognitionResult> recognize(Uint8List image);
}

List<TicketRecord> parseRecognition(
  RecognitionResult result,
  ReferenceCatalog catalog, {
  required bool flight,
}) {
  final lines = [...result.lines]
    ..sort((a, b) => a.y == b.y ? a.x.compareTo(b.x) : a.y.compareTo(b.y));
  final text = lines.map((line) => line.text).join('\n');
  final values = <String, dynamic>{
    'type': flight ? 'flight' : 'rail',
    'template': flight ? 'air-boarding-pass' : 'rail-receipt',
  };
  final clean = text.replaceAllMapped(
    RegExp(r'([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])'),
    (match) => match[1]!,
  );
  String capture(String pattern) =>
      RegExp(pattern, caseSensitive: false).firstMatch(text)?[1]?.trim() ?? '';
  final services =
      RegExp(
            flight
                ? r'\b[A-Z0-9]{2}\s?\d{2,4}\b'
                : r'\b[GDCZTKLSY]\d{1,5}\b|(?m:^\s*\d{3,4}\s*$)',
          )
          .allMatches(text)
          .where(
            (match) =>
                !flight ||
                !catalog.aircraftAliases.containsKey(
                  placeKey(match[0]!).toUpperCase(),
                ),
          );
  final service = services.firstOrNull;
  if (service != null) values['service'] = service[0]!.replaceAll(' ', '');
  final departureText = capture(r'(?:乘车日期|出发日期|计划起飞日期)\s*[:：]?\s*([^\n]+)');
  final date = RegExp(r'(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})')
      .firstMatch(departureText.isNotEmpty ? departureText : text);
  if (date != null) {
    try {
      values['departureDate'] = JourneyDate.calendar(
        int.parse(date[1]!),
        int.parse(date[2]!),
        int.parse(date[3]!),
      ).toJson();
    } on FormatException {
      /* Keep an ambiguous OCR date empty. */
    }
  }
  final labelledService = capture(
    flight
        ? r'(?:航班号?|FLIGHT(?:\s*NO)?)\s*[:：]?\s*([A-Z0-9]{2}\s*\d{1,5})'
        : r'(?:车次)\s*[:：]?\s*([A-Z]?\d{1,5})',
  );
  if (labelledService.isNotEmpty) {
    values['service'] = labelledService.replaceAll(' ', '').toUpperCase();
  }
  for (final (key, pattern) in [
    ('identity', r'(?:证件号|身份证号|IDENTITY)\s*[:：]?\s*([A-Z0-9*]{5,30})'),
    ('price', r'(?:￥|¥|票价[:：]?|FARE[:：]?)\s*(\d+(?:\.\d{1,2})?)'),
    ('pnr', r'(?:PNR|订座编号)\s*[:：]?\s*([A-Z0-9]{5,8})'),
    ('seat', r'(?:座位|SEAT)\s*[:：]?\s*(\d{1,3}[A-Z])'),
    ('seatClass', r'(?:舱位(?:代码)?|CLASS)\s*[:：]?\s*([A-Z])'),
    (
      'ticketNumber',
      r'(?:票号|客票号|TICKET(?:\s*NO)?)\s*[:：]?\s*([A-Z0-9-]{6,30})',
    ),
    ('orderNumber', r'(?:订单号|订单编号)\s*[:：]?\s*([A-Z0-9]{6,30})'),
  ]) {
    final value = capture(pattern);
    if (value.isNotEmpty) values[key] = value;
  }
  if (!flight) {
    if (clean.contains('退票费')) {
      values['template'] = 'rail-refund-receipt';
    } else if (clean.contains('仅供报销') || clean.contains('仅供报銷'))
      values['template'] = 'rail-receipt';
    final clock = capture(r'([0-2]?\d:[0-5]\d)\s*开');
    if (clock.isNotEmpty) values['departureTime'] = clock.padLeft(5, '0');
    final seat = RegExp(
      r'(\d{1,2})\s*车\s*(\d{1,3}[A-F]?)\s*(?:号)?\s*([上中下]铺)?',
      caseSensitive: false,
    ).firstMatch(clean);
    if (seat != null) {
      values['carriage'] = seat[1];
      values['seat'] = '${seat[2]}${seat[3] == null ? '' : '号${seat[3]}'}';
    }
    final seatClass = RegExp(r'商务座|特等座|二等座|一等座|高级软卧|硬卧|软卧|硬座|软座|动卧|无座')
        .firstMatch(clean);
    if (seatClass != null) values['seatClass'] = seatClass[0];
    final identity = RegExp(r'(\d{6}[\dX*]{9,12})\s*([\u3400-\u9fff·]{2,20})?')
        .firstMatch(clean);
    if (identity != null) {
      values['identity'] = identity[1];
      if (identity[2] != null) values['passenger'] = identity[2];
    }
    final candidates = <(int, int, String)>[];
    final compact = clean.replaceAll(RegExp(r'\s'), '');
    for (final station in catalog.stations) {
      final at = compact.indexOf(station.name);
      if (at >= 0 && station.name.length >= 2) {
        candidates.add((at, station.name.length, station.name));
      }
    }
    candidates.sort(
      (a, b) => a.$1 == b.$1 ? b.$2.compareTo(a.$2) : a.$1.compareTo(b.$1),
    );
    final names = <String>[], covered = <(int, int)>[];
    for (final candidate in candidates) {
      if (covered.any(
            (span) => candidate.$1 >= span.$1 && candidate.$1 < span.$2,
          ) ||
          names.contains(candidate.$3)) {
        continue;
      }
      covered.add((candidate.$1, candidate.$1 + candidate.$2));
      names.add(candidate.$3);
      if (names.length == 2) break;
    }
    if (names.length == 2) {
      values['origin'] = names[0];
      values['destination'] = names[1];
    }
    final codes = {
      for (final data in result.symbolData.where(
        (row) => ['QRCode', 'MicroQRCode'].contains(row['format']),
      ))
        canonicalJson(data): data,
    };
    if (codes.length > 1) throw const FormatException('图片包含多个不同二维码，请分别扫描');
    if (codes.length == 1) values['ticketCode'] = codes.values.single;
  }
  for (final (key, pattern) in [
    (
      'departureTime',
      r'(?:计划起飞|(?<!实际)起飞时间|(?<!实际)出发时间|(?<!ACTUAL )DEPARTURE)\s*[:：]?\s*(\d{2}:\d{2})',
    ),
    (
      'arrivalTime',
      r'(?:计划到达|(?<!实际)到达时间|(?<!ACTUAL )ARRIVAL)\s*[:：]?\s*(\d{2}:\d{2})',
    ),
    (
      'boardingTime',
      r'(?:(?<!实际)登机时间|(?<!ACTUAL )BOARDING\s*TIME)\s*[:：]?\s*(\d{2}:\d{2})',
    ),
    ('actualBoardingTime', r'(?:实际登机时间)\s*[:：]?\s*(\d{2}:\d{2})'),
    ('passenger', r'(?:姓名|NAME)\s*[:：]?\s*([^\n]+)'),
    ('gate', r'(?:检票口|登机口|GATE)\s*[:：]?\s*([A-Z0-9-]+)'),
  ]) {
    final match = RegExp(pattern, caseSensitive: false).firstMatch(text);
    if (match != null) values[key] = match[1]!.trim();
  }
  if (flight) {
    for (final (event, label) in [
      ('departure', '计划起飞|计划出发'),
      ('arrival', '计划到达|计划降落'),
      ('actualDeparture', '实际起飞|实际离地'),
      ('actualArrival', '实际到达|实际降落'),
    ]) {
      final match = RegExp(
        '(?:$label)(?:日期|时间|时刻)?\\s*[:：]?\\s*(?:(20\\d{2})[-/.年](\\d{1,2})[-/.月](\\d{1,2})日?[ T\\s]*)?([0-2]?\\d:[0-5]\\d)?',
      ).firstMatch(text);
      if (match == null) continue;
      if (match[1] != null) {
        try {
          values['${event}Date'] = JourneyDate.calendar(
            int.parse(match[1]!),
            int.parse(match[2]!),
            int.parse(match[3]!),
          ).toJson();
        } on FormatException {
          /* Leave ambiguous dates blank. */
        }
      }
      if (match[4] != null && int.parse(match[4]!.split(':').first) < 24) {
        values['${event}Time'] = match[4]!.padLeft(5, '0');
      }
    }
    final codes = RegExp(r'\b[A-Z]{3}\b')
        .allMatches(text)
        .map((match) => match[0]!)
        .where((code) => catalog.resolve(code, '', flight: true) != null)
        .toSet()
        .toList();
    if (codes.length == 2) {
      values['origin'] = codes[0];
      values['destination'] = codes[1];
    }
  }
  values['fieldSources'] = {
    for (final key in values.keys.where(
      (key) => !['type', 'template', 'fieldSources'].contains(key),
    ))
      key: 'ocr',
  };
  final unique = {
    for (final bytes in result.barcodes) base64Encode(bytes): bytes,
  };
  final decoded = unique.values
      .where((bytes) => decodeBoardingBytes(bytes) != null)
      .toList();
  if (decoded.length == 1) {
    return boardingRecords(decoded.single, catalog, supplement: values);
  }
  if (decoded.length > 1) throw const FormatException('图片中有多个不同登机牌条码，请分别导入');
  return [catalog.normalize(TicketRecord.create(values))];
}

List<TicketRecord> parseTicketText(
  String text,
  ReferenceCatalog catalog, {
  required bool flight,
  String source = 'text',
}) {
  final chunks = text
      .split(RegExp(r'\n\s*\n'))
      .where((chunk) => chunk.trim().isNotEmpty)
      .toList();
  List<TicketRecord> one(String chunk) {
    final lines = chunk.split('\n');
    final result = parseRecognition(
      RecognitionResult(
        lines: [
          for (var i = 0; i < lines.length; i++)
            RecognitionLine(
              lines[i],
              0,
              i / lines.length,
              1,
              1 / lines.length,
              1,
            ),
        ],
      ),
      catalog,
      flight: flight,
    );
    return result
        .where((row) => row.text('service').isNotEmpty)
        .map(
          (row) => row.withChanges({
            'fieldSources': {
              for (final entry in row.fieldSources.entries) entry.key: source,
            },
            'sources': [
              {'kind': source, 'label': '文字导入', 'at': utcNow()},
            ],
          }),
        )
        .toList();
  }

  final parsed = chunks.map(one).where((rows) => rows.isNotEmpty).toList();
  final services = parsed
      .expand((rows) => rows)
      .map((row) => row.text('service'))
      .toSet();
  // Blank paragraphs within one ticket are common in copied e-mails.
  return services.length <= 1
      ? one(text)
      : parsed.expand((rows) => rows).toList();
}
