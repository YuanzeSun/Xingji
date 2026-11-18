import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:xingji/platform_services.dart';
import 'package:xingji/ticket_file_import.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final catalog = ReferenceCatalog.fromJson(
    jsonDecode(File('assets/reference.json').readAsStringSync()),
  );

  test(
    'a boarding barcode still sends the image to Intelligence and stays locked',
    () async {
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      final date = JourneyDate.calendar(2026, 11, 18);
      final barcode = encodeBoardingPass(
        passenger: 'TEST/TRAVELER',
        pnr: 'ABC123',
        origin: 'PEK',
        destination: 'HND',
        carrier: 'CA',
        flightNumber: '181',
        date: date,
        cabin: 'Y',
        seat: '08A',
        sequence: '104',
        status: '1',
      );
      final methods = <String>[];
      final input = Uint8List.fromList([0x89, 0x50, 0x4e, 0x47]);
      messenger.setMockMethodCallHandler(SystemRecognition.channel, (
        call,
      ) async {
        methods.add(call.method);
        expect(call.arguments['bytes'], orderedEquals(input));
        if (call.method == 'recognizeImage') {
          return {
            'barcodes': [
              {'rawBytes': base64Encode(utf8.encode(barcode))},
            ],
            'lines': [
              {
                'text': 'GATE A12',
                'x': 0.1,
                'y': 0.3,
                'width': 0.2,
                'height': 0.04,
                'confidence': 0.99,
              },
            ],
          };
        }
        expect(call.method, 'extractTicketImage');
        expect(call.arguments['text'], contains('GATE A12'));
        return {
          'type': 'flight',
          'service': 'CA999',
          'seat': '36C',
          'gate': 'A12',
          'departureDate': '2026-11-18',
        };
      });
      addTearDown(
        () =>
            messenger.setMockMethodCallHandler(SystemRecognition.channel, null),
      );

      final record = (await recognizeTicketImage(
        input,
        catalog,
        flight: true,
      )).single;
      expect(methods, ['recognizeImage', 'extractTicketImage']);
      expect(record.text('service'), 'CA181');
      expect(record.text('seat'), '8A');
      expect(record.barcodeLocked('seat'), isTrue);
      expect(record.text('gate'), 'A12');
      expect(record.departure?.calendarText, '2026-11-18');
    },
  );

  test('a PDF can carry train and flight pages in the same import', () async {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemRecognition.channel, (call) async {
      expect(call.method, 'recognizePDF');
      expect(call.arguments['bytes'], isA<Uint8List>());
      return [
        {
          'lines': [
            {
              'text': '车次 G21\n北京南站 南京南站\n出发日期 2026-11-18\n15:00开',
              'x': 0.0,
              'y': 0.0,
              'width': 1.0,
              'height': 1.0,
              'confidence': 1.0,
            },
          ],
        },
        {
          'lines': [
            {
              'text': 'FLIGHT CA181\nPEK HND\n计划起飞时间 2026-11-19 08:30',
              'x': 0.0,
              'y': 0.0,
              'width': 1.0,
              'height': 1.0,
              'confidence': 1.0,
            },
          ],
        },
      ];
    });
    addTearDown(
      () => messenger.setMockMethodCallHandler(SystemRecognition.channel, null),
    );

    final rows = await readTicketAttachment(
      Uint8List.fromList([37, 80, 68, 70]),
      'pdf',
      catalog,
    );
    expect(
      rows.map((row) => row.text('service')),
      unorderedEquals(['G21', 'CA181']),
    );
    expect(
      rows.singleWhere((row) => row.isFlight).text('departureTime'),
      '08:30',
    );
    for (final row in rows) {
      expect(row.fieldSources['service'], 'pdf');
    }
  });
}
