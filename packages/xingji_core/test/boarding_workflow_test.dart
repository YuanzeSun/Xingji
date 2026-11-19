import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:test/test.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final catalog = ReferenceCatalog.fromJson(
    jsonDecode(
      File('../../apps/flutter/assets/reference.json').readAsStringSync(),
    ),
  );
  String payload() => encodeBoardingPass(
    passenger: 'SUN/YUANZE',
    pnr: 'ABC123',
    origin: 'LXA',
    destination: 'CTU',
    carrier: 'TV',
    flightNumber: '9824',
    date: JourneyDate(null, 179),
    cabin: 'Z',
    seat: '51L',
    sequence: '104',
    status: '1',
  );
  test(
    'generated Format M has exact field offsets and preserves cabin code',
    () {
      final encoded = payload(),
          read = decodeBoardingBytes(ascii.encode(encoded))!;
      expect(encoded.length, 60);
      expect(encoded[22], ' ');
      expect(read['legs'][0]['dayOfYear'], 179);
      expect(read['legs'][0]['cabin'], 'Z');
      expect(read['legs'][0]['seat'], '51L');
    },
  );
  test('OCR supplements blanks while barcode source and unknown-year date remain locked', () {
    final result = boardingRecords(
      ascii.encode(payload()),
      catalog,
      supplement: {
        'passenger': 'OTHER NAME',
        'departureDate': JourneyDate.calendar(2026, 6, 28).toJson(),
        'gate': 'A101',
        'departureTime': '12:40',
      },
    ).single;
    expect(result.text('passenger'), 'SUN/YUANZE');
    expect(result.fieldSources['passenger'], 'barcode');
    expect(result.fieldSources['departureDate'], 'barcode');
    expect(result.barcodeLocked('seat'), true);
    expect(result.barcodeLocked('departureDate'), false);
    expect(result.departure!.year, 2026);
    expect(result.text('gate'), 'A101');
    expect(result.fieldSources['gate'], 'ocr');
  });
  test('OCR agreeing with an optional barcode field keeps it locked', () {
    final record = boardingRecords(
      utf8.encode('${payload()}#90示例旅客#91拉萨#92成都#93A101#9418:21'),
      catalog,
      supplement: {'gate': 'A101', 'actualBoardingTime': '18:21'},
    ).single;
    expect(record.text('gate'), 'A101');
    expect(record.barcodeLocked('gate'), true);
    expect(record.barcodeLocked('actualBoardingTime'), true);
  });
  test(
    'a printed boarding time stays separate from takeoff and recorded boarding',
    () {
      final record = parseRecognition(
        RecognitionResult(
          barcodes: [
            Uint8List.fromList(
              utf8.encode('${payload()}#90示例旅客#91拉萨#92成都#93A101#9418:21'),
            ),
          ],
          lines: [
            RecognitionLine('计划登机时间 BOARDING TIME', .1, .2, .24, .04, .99),
            RecognitionLine('18:15', .11, .26, .09, .04, .99),
            RecognitionLine('计划起飞时间 18:50', .58, .2, .36, .04, .99),
          ],
        ),
        catalog,
        flight: true,
      ).single;
      expect(record.text('boardingTime'), '18:15');
      expect(record.fieldSources['boardingTime'], 'ocr');
      expect(record.text('departureTime'), '18:50');
      expect(record.text('actualBoardingTime'), '18:21');
      expect(record.barcodeLocked('actualBoardingTime'), isTrue);
    },
  );
  test(
    'duplicate readings of the same symbol do not become a multi-ticket error',
    () {
      final bytes = Uint8List.fromList(ascii.encode(payload()));
      final records = parseRecognition(
        RecognitionResult(barcodes: [bytes, bytes]),
        catalog,
        flight: true,
      );
      expect(records, hasLength(1));
      expect(records.single.departure!.year, isNull);
      expect(records.single['boardingCode']['format'], 'PDF417');
      expect(base64Decode(records.single['boardingCode']['rawBytes'])[22], 32);
    },
  );
  test(
    'compact boarding time and gate are extracted beside a gate closure notice',
    () {
      final record = parseRecognition(
        RecognitionResult(
          barcodes: [Uint8List.fromList(utf8.encode(payload()))],
          lines: [
            RecognitionLine('登机时间', .333, .597, .092, .033, .99),
            RecognitionLine('登机口', .459, .593, .066, .032, .99),
            RecognitionLine('座位®', .582, .584, .071, .040, .99),
            RecognitionLine('BOARDING TIME', .331, .629, .099, .021, .99),
            RecognitionLine('GATE', .477, .628, .033, .018, .99),
            RecognitionLine('SEAT', .590, .624, .032, .016, .99),
            RecognitionLine('0730', .308, .661, .090, .039, .99),
            RecognitionLine('19', .424, .661, .044, .035, .99),
            RecognitionLine('6A', .536, .657, .047, .035, .99),
            RecognitionLine(
              'GATE CIOSED 20 MINUTES BEFORE DEPARTURE',
              .049,
              .705,
              .262,
              .027,
              .99,
            ),
          ],
        ),
        catalog,
        flight: true,
      ).single;
      expect(record.text('boardingTime'), '07:30');
      expect(record.text('gate'), '19');
      expect(record.text('departureTime'), isEmpty);
    },
  );

  test('explicit STD and departure time labels accept a compact clock', () {
    for (final label in ['计划起飞时间', 'DEPARTURE TIME', 'STD']) {
      final fields = readTravelFields(
        '$label 0840\nBOARDING TIME 0730\nGATE CLOSED',
        catalog,
        flight: true,
      );
      expect(fields['departureTime'], '08:40');
      expect(fields['boardingTime'], '07:30');
      expect(fields['gate'], isNull);
    }
    final fields = readTravelFields('出发日期 2026-11-20', catalog, flight: true);
    expect(fields['departureTime'], isNull);
  });
  test('airport search covers both named and physical cities', () {
    for (final name in ['西安', '咸阳', '西宁', '海东', '拉萨', '山南']) {
      expect(catalog.search(name, flight: true), isNotEmpty);
    }
    expect(catalog.search('beijingnan', flight: false).first.name, '北京南');
  });
}
