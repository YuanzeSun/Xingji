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
  test('airport search covers both named and physical cities', () {
    for (final name in ['西安', '咸阳', '西宁', '海东', '拉萨', '山南']) {
      expect(catalog.search(name, flight: true), isNotEmpty);
    }
    expect(catalog.search('beijingnan', flight: false).first.name, '北京南');
  });
}
