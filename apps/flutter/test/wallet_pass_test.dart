import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xingji/wallet_pass.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final catalog = ReferenceCatalog.fromJson(
    jsonDecode(File('assets/reference.json').readAsStringSync()),
  );

  Uint8List pack(Object value) {
    final data = utf8.encode(jsonEncode(value));
    return Uint8List.fromList(
      ZipEncoder().encode(
        Archive()..addFile(ArchiveFile('pass.json', data.length, data)),
      ),
    );
  }

  test('reads boarding fields without semantic tags or a BCBP', () {
    final row = readWalletBoardingPass(
      pack({
        'boardingPass': {
          'transitType': 'PKTransitTypeAir',
          'headerFields': [
            {'key': 'flight', 'label': '航班', 'value': 'CA181'},
            {'key': 'gate', 'label': '登机口', 'value': 'A03'},
          ],
          'primaryFields': [
            {'key': 'depart', 'label': '首都 T3', 'value': 'PEK '},
            {'key': 'arrive', 'label': '羽田 T2', 'value': 'HND'},
          ],
          'auxiliaryFields': [
            {'key': 'flightDate', 'label': '航班日期', 'value': '2026-11-18'},
            {'key': 'boardingTime', 'label': '登机时间', 'value': '08:30'},
            {'key': 'seat', 'label': '座位号', 'value': '08A'},
            {'key': 'cabin', 'label': '舱位等级', 'value': 'Y'},
          ],
        },
        'barcodes': [
          {'format': 'PKBarcodeFormatQR', 'message': 'opaque-provider-token'},
        ],
        'relevantDate': '2026-11-18T00:00:00Z',
      }),
      catalog,
    ).single;
    expect(row.text('service'), 'CA181');
    expect(row.text('originCode'), 'PEK');
    expect(row.text('destinationCode'), 'HND');
    expect(row.departure?.calendarText, '2026-11-18');
    expect(row.text('boardingTime'), '08:30');
    expect(row.text('departureTime'), isEmpty);
    expect(row.text('terminal'), 'T3');
    expect(row.text('seat'), '08A');
    expect(row['boardingCode'], isNot(isA<Map>()));
  });

  test(
    'uses the declared UTF-8 encoding for BCBP with a Chinese extension',
    () {
      final standard = encodeBoardingPass(
        passenger: 'TEST/TRAVELER',
        pnr: 'ABC123',
        origin: 'PEK',
        destination: 'HND',
        carrier: 'CA',
        flightNumber: '181',
        date: JourneyDate.calendar(2026, 11, 18),
        cabin: 'Y',
        seat: '08A',
        sequence: '104',
        status: '1',
      );
      final message = '$standard#90示例旅客#91北京首都#92东京羽田';
      final row = readWalletBoardingPass(
        pack({
          'boardingPass': {'transitType': 'PKTransitTypeAir'},
          'barcodes': [
            {
              'format': 'PKBarcodeFormatQR',
              'message': message,
              'messageEncoding': 'UTF-8',
            },
          ],
        }),
        catalog,
      ).single;
      expect(row.barcodeLocked('service'), isTrue);
      expect(
        row['boardingCode']['rawBytes'],
        base64Encode(utf8.encode(message)),
      );
    },
  );

  test('rejects a pass of an unrelated style', () {
    expect(
      () => readWalletBoardingPass(
        pack({
          'eventTicket': {'headerFields': []},
        }),
        catalog,
      ),
      throwsFormatException,
    );
  });

  // Optional local smoke test for an explicitly supplied Wallet sample.
  final samples = (Platform.environment['XINGJI_PKPASS_SAMPLE'] ?? '')
      .split('\n')
      .where((path) => path.isNotEmpty);
  for (final (index, sample) in samples.indexed) {
    test(
      'imports supplied Wallet pass ${index + 1} without logging its contents',
      () {
        final row = readWalletBoardingPass(
          File(sample).readAsBytesSync(),
          catalog,
        ).single;
        expect(row.isFlight, isTrue);
        expect(row.text('service').isNotEmpty, isTrue);
        expect(row.text('originCode').length, 3);
        expect(row.text('destinationCode').length, 3);
        expect(row.departure?.complete, isTrue);
        expect(row.text('seat').isNotEmpty, isTrue);
        expect(row.text('boardingTime').isNotEmpty, isTrue);
        expect(row.barcodeLocked('service'), isTrue);
      },
    );
  }
}
