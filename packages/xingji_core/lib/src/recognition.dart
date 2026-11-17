import 'dart:convert';
import 'dart:typed_data';

import 'ticket_record.dart';
import 'reference_catalog.dart';
import 'journey_date.dart';
import 'boarding_decoder.dart';

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
  RecognitionResult({this.lines = const [], this.barcodes = const []});
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
  final lines = [...result.lines]..sort((a, b) => a.y.compareTo(b.y));
  final text = lines.map((line) => line.text).join('\n');
  final values = <String, dynamic>{
    'type': flight ? 'flight' : 'rail',
    'template': flight ? 'air-boarding-pass' : 'rail-receipt',
  };
  final service = RegExp(
    flight
        ? r'\b[A-Z0-9]{2}\s?\d{2,4}\b'
        : r'\b(?:[GDCZTKLSY]\d{1,5}|\d{3,5})\b',
  ).firstMatch(text);
  if (service != null) values['service'] = service[0]!.replaceAll(' ', '');
  final date = RegExp(r'(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})')
      .firstMatch(text);
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
  for (final (key, pattern) in [
    ('departureTime', r'(?:计划起飞|起飞时间|出发时间|DEPARTURE)\s*[:：]?\s*(\d{2}:\d{2})'),
    ('arrivalTime', r'(?:计划到达|到达时间|ARRIVAL)\s*[:：]?\s*(\d{2}:\d{2})'),
    ('boardingTime', r'(?:登机时间|BOARDING\s*TIME)\s*[:：]?\s*(\d{2}:\d{2})'),
    ('actualBoardingTime', r'(?:实际登机时间)\s*[:：]?\s*(\d{2}:\d{2})'),
    ('passenger', r'(?:姓名|NAME)\s*[:：]?\s*([^\n]+)'),
    ('gate', r'(?:检票口|登机口|GATE)\s*[:：]?\s*([A-Z0-9-]+)'),
  ]) {
    final match = RegExp(pattern, caseSensitive: false).firstMatch(text);
    if (match != null) values[key] = match[1]!.trim();
  }
  if (flight) {
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
  if (decoded.length == 1)
    return boardingRecords(decoded.single, catalog, supplement: values);
  if (decoded.length > 1) throw const FormatException('图片中有多个不同登机牌条码，请分别导入');
  return [catalog.normalize(TicketRecord.create(values))];
}
