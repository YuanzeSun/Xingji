import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/services.dart';
import 'package:xingji/platform_services.dart';
import 'package:xingji/ticket_file_import.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final catalog = ReferenceCatalog.fromJson(
    jsonDecode(File('assets/reference.json').readAsStringSync()),
  );
  Uint8List boardingCode(String flightNumber) => Uint8List.fromList(
    utf8.encode(
      encodeBoardingPass(
        passenger: 'TEST/TRAVELER',
        pnr: 'ABC123',
        origin: 'PEK',
        destination: 'HND',
        carrier: 'CA',
        flightNumber: flightNumber,
        date: JourneyDate.calendar(2026, 11, 18),
        cabin: 'Y',
        seat: '08A',
        sequence: '104',
        status: '1',
      ),
    ),
  );

  test(
    'the flight form reads only the barcode even if Vision returns text',
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
        expect(call.arguments['readText'], isFalse);
        expect(call.method, 'recognizeImage');
        return {
          'barcodes': [
            {'rawBytes': base64Encode(utf8.encode(barcode))},
          ],
          'lines': [
            {
              'text':
                  'GATE A12\n日期 2026-11-18\n'
                  '实际登机时间 09:40\n登机时间 08:55\n起飞时间 09:25',
              'x': 0.1,
              'y': 0.3,
              'width': 0.2,
              'height': 0.04,
              'confidence': 0.99,
            },
          ],
        };
      });
      addTearDown(
        () =>
            messenger.setMockMethodCallHandler(SystemRecognition.channel, null),
      );

      final record = (await readBoardingPhoto(input, catalog)).single;
      expect(methods, ['recognizeImage']);
      expect(record.text('service'), 'CA181');
      expect(record.text('seat'), '8A');
      expect(record.barcodeLocked('seat'), isTrue);
      expect(record.text('gate'), isEmpty);
      expect(record.text('boardingTime'), isEmpty);
      expect(record.text('actualBoardingTime'), isEmpty);
      expect(record.text('departureTime'), isEmpty);
      expect(record.fieldSources['boardingTime'], isNull);
      expect(record.departure?.year, isNull);
      expect(record.departure?.dayOfYear, date.dayOfYear);
    },
  );

  test(
    'a barcode remains usable when the photo contains no readable text',
    () async {
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      messenger.setMockMethodCallHandler(SystemRecognition.channel, (
        call,
      ) async {
        return switch (call.method) {
          'recognizeImage' => {
            'barcodes': [
              {'rawBytes': base64Encode(boardingCode('181'))},
            ],
          },
          _ => fail('Unexpected method ${call.method}'),
        };
      });
      addTearDown(
        () =>
            messenger.setMockMethodCallHandler(SystemRecognition.channel, null),
      );
      final record = (await readBoardingPhoto(Uint8List(4), catalog)).single;
      expect(record.text('gate'), isEmpty);
      expect(record.text('boardingTime'), isEmpty);
    },
  );

  test('photos fall back to Vision and local parsing when the model is unavailable or fails', () async {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    addTearDown(
      () => messenger.setMockMethodCallHandler(SystemRecognition.channel, null),
    );
    for (final available in [false, true]) {
      var requestedModel = false;
      messenger.setMockMethodCallHandler(SystemRecognition.channel, (
        call,
      ) async {
        switch (call.method) {
          case 'capabilities':
            return {
              'appleIntelligence': available,
              'appleIntelligenceImage': available,
            };
          case 'recognizeImage':
            return {
              'lines': [
                {
                  'text': '车次 G21\n北京南站 南京南站\n出发日期 2026-11-18\n15:00开\n证件号 1101011990****1234',
                  'x': 0.0,
                  'y': 0.0,
                  'width': 1.0,
                  'height': 1.0,
                  'confidence': 1.0,
                },
              ],
            };
          case 'extractTicketImage':
            requestedModel = true;
            throw PlatformException(code: 'intelligence_unavailable');
        }
        fail('Unexpected method ${call.method}');
      });
      final record = (await recognizeTicketImage(Uint8List(4), catalog)).single;
      expect(requestedModel, available);
      expect(record.text('service'), 'G21');
      expect(record.text('origin'), '北京南');
      expect(record.text('identity'), isEmpty);
      expect(record.departure?.calendarText, '2026-11-18');
    }
  });

  test(
    'a text-only model can fill photo fields only when Vision saw their values',
    () async {
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      final methods = <String>[];
      messenger.setMockMethodCallHandler(SystemRecognition.channel, (
        call,
      ) async {
        methods.add(call.method);
        return switch (call.method) {
          'capabilities' => {
            'appleIntelligence': true,
            'appleIntelligenceImage': false,
          },
          'recognizeImage' => {
            'lines': [
              {
                'text': '车次 G21\n北京南站 南京南站\n示例旅客',
                'x': 0.0,
                'y': 0.0,
                'width': 1.0,
                'height': 1.0,
                'confidence': 1.0,
              },
            ],
          },
          'extractTicketText' => {
            'type': 'rail',
            'passenger': '示例旅客',
            'departureDate': '2026-11-18',
          },
          _ => fail('Unexpected method ${call.method}'),
        };
      });
      addTearDown(
        () =>
            messenger.setMockMethodCallHandler(SystemRecognition.channel, null),
      );
      final record = (await recognizeTicketImage(Uint8List(4), catalog)).single;
      expect(methods, ['recognizeImage', 'capabilities', 'extractTicketText']);
      expect(record.text('passenger'), '示例旅客');
      expect(record.departure, isNull);
    },
  );

  test('each new photo is decoded directly for its own barcode', () async {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemRecognition.channel, (call) async {
      expect(call.method, 'recognizeImage');
      expect(call.arguments['barcodes'], isTrue);
      return {
        'barcodes': [
          {'rawBytes': base64Encode(boardingCode('182'))},
        ],
        'lines': [
          {
            'text': 'BOARDING 12:20',
            'x': .2,
            'y': .7,
            'width': .28,
            'height': .04,
            'confidence': .99,
          },
        ],
      };
    });
    addTearDown(
      () => messenger.setMockMethodCallHandler(SystemRecognition.channel, null),
    );
    final record = (await readBoardingPhoto(Uint8List(4), catalog)).single;
    expect(record.text('service'), 'CA182');
    expect(record.text('boardingTime'), isEmpty);
    expect(record.text('gate'), isEmpty);
  });

  test('a PDF can carry train and flight pages in the same import', () async {
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(SystemRecognition.channel, (call) async {
      expect(call.method, 'recognizePDF');
      expect(call.arguments['bytes'], isA<Uint8List>());
      return [
        {
          'hasTextLayer': true,
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
          'hasTextLayer': true,
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
