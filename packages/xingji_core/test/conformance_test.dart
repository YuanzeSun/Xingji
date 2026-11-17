import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final fixture = jsonDecode(
    File('../../specs/fixtures/conformance.json').readAsStringSync(),
  ) as Map<String, dynamic>;
  final catalog = ReferenceCatalog.fromJson(
    jsonDecode(
      File('../../apps/flutter/assets/reference.json').readAsStringSync(),
    ),
  );
  List<TicketRecord> records(dynamic rows) => (rows as List)
      .map((row) => TicketRecord.fromJson(Map<String, dynamic>.from(row)))
      .toList();
  for (final row in fixture['dates'])
    test('shared date ${row['input']}', () {
      final date = JourneyDate.fromJson(row['stored']);
      expect(date?.toJson() ?? '', row['stored']);
      expect(date?.calendarText ?? '', row['calendar']);
      expect(date?.label ?? '日期未知', row['label']);
      if (date?.date != null)
        expect(JourneyDate.fromDateTime(date!.date!).toJson(), row['stored']);
    });
  test('dates keep ordinal and year independent, reject invalid leap dates and noncanonical storage', () {
    expect(JourneyDate.calendar(2024, 2, 29).dayOfYear, 60);
    expect(JourneyDate(2025, 60).date, DateTime.utc(2025, 3, 1));
    expect(JourneyDate(null, 366).calendarText, '');
    expect(() => JourneyDate(2025, 366), throwsFormatException);
    expect(() => JourneyDate.calendar(2025, 2, 29), throwsFormatException);
    expect(() => JourneyDate.fromJson('2025-01-01'), throwsFormatException);
  });
  for (final row in fixture['barcodes'])
    test(
      'shared boarding payload with ${row['expected']['legCount']} legs',
      () {
        final bytes = base64Decode(row['payload']);
        expect(decodeBoardingBytes(bytes), row['expected']);
        final tickets = boardingRecords(bytes, catalog);
        expect(tickets.length, row['expected']['legCount']);
        expect(tickets.first.barcodeLocked('seat'), true);
        expect(tickets.first.departure!.year, null);
        expect(tickets.first['boardingCode']['format'], 'PDF417');
        expect(base64Decode(tickets.first['boardingCode']['rawBytes'])[22], 32);
        expect(tickets.first.text('actualBoardingTime'), '18:21');
        expect(tickets.first.text('boardingTime'), '');
        if (tickets.length > 1)
          expect(tickets[1].text('actualBoardingTime'), '');
        expect(decodeBoardingBytes(bytes.sublist(0, bytes.length - 5)), null);
      },
    );
  for (final row in fixture['dedup'])
    test('shared deduplication: ${row['name']}', () {
      expect(
        deduplicateTickets(
          records(row['input']),
          catalog,
        ).map((record) => record.toJson()).toList(),
        row['expected'],
      );
    });
  for (final row in fixture['merges'])
    test('shared conflict merge: ${row['name']}', () {
      final result = mergeTickets(
        records(row['base']),
        records(row['local']),
        records(row['remote']),
      );
      expect(
        result.records.map((record) => record.toJson()).toList(),
        row['expectedRecords'],
      );
      expect(
        result.conflicts
            .map((conflict) => {'id': conflict.id, 'field': conflict.field})
            .toList(),
        row['conflictFields'],
      );
    });
  test('all current example fields survive an archive roundtrip', () {
    final input = jsonDecode(
      File('../../apps/flutter/assets/demo.json').readAsStringSync(),
    );
    expect(
      TicketArchive.fromJson(TicketArchive.fromJson(input).toJson()).records
          .map((record) => record.toJson())
          .toList(),
      input['records'],
    );
  });
}
