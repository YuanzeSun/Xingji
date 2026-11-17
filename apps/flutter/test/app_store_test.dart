import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji/app_store.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final catalog = ReferenceCatalog.fromJson({
    'stations': [],
    'airports': [],
    'airlines': [],
  });
  TicketRecord ticket() => TicketRecord.create({
    'origin': '北京南',
    'destination': '南京南',
    'service': 'G21',
    'departureDate': JourneyDate.calendar(2026, 11, 16).toJson(),
    'departureTime': '15:00',
    'passenger': '示例旅客',
    'identity': '11010119900101****',
    'seatClass': '二等座',
    'carriage': '05',
    'seat': '08F',
  });
  Future<AppStore> store() async {
    SharedPreferences.setMockInitialValues({});
    return AppStore(await SharedPreferences.getInstance(), catalog, [
      ticket(),
    ], {});
  }

  test(
    'offline save persists a pending private archive without copying examples',
    () async {
      final app = await store(), record = ticket();
      await app.save(record);
      expect(app.pending, true);
      expect(app.records.single.id, record.id);
      final saved = jsonDecode(app.preferences.getString(AppStore.storageKey)!);
      expect(
        TicketArchive.fromJson(saved['local']).records.single.id,
        record.id,
      );
      app.setDemo(true);
      expect(app.records.single.id, app.examples.single.id);
      app.setDemo(false);
      expect(app.records.single.id, record.id);
      app.dispose();
    },
  );
  test('demo rejects private writes and deleting a ticket persists a clean tombstone', () async {
    final app = await store(), record = ticket();
    app.setDemo(true);
    await expectLater(app.save(record), throwsStateError);
    expect(app.preferences.getString(AppStore.storageKey), isNull);
    app.setDemo(false);
    await app.save(record);
    await app.delete(record);
    expect(app.records, isEmpty);
    expect(app.privateRecords.single.deleted, true);
    expect(app.privateRecords.single.text('passenger'), '');
    expect(app.privateRecords.single['railRoute'], '');
    app.dispose();
  });
}
