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
    'local-only tickets reload from storage without a sync requirement',
    () async {
      final app = await store(), record = ticket();
      expect(await app.save(record), SaveOutcome.local);
      expect(app.pending, false);
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
      final reopened = await AppStore.load();
      addTearDown(reopened.dispose);
      expect(reopened.records.single.id, record.id);
      expect(reopened.connection, isNull);
      expect(reopened.pending, false);
      app.dispose();
    },
  );
  test(
    'connecting later uploads tickets entered in the local-only library',
    () async {
      SharedPreferences.setMockInitialValues({});
      final remote = _MemoryRemote();
      final app = AppStore(
        await SharedPreferences.getInstance(),
        catalog,
        [],
        {},
        remoteFactory: (_, _) => remote,
      );
      addTearDown(app.dispose);
      final record = ticket();
      expect(await app.save(record), SaveOutcome.local);
      expect(remote.snapshot.records, isEmpty);

      await app.connect(const GitHubConnection('user', 'private'), 'test');
      expect(remote.snapshot.records.single.id, record.id);
      expect(app.pending, false);
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
  test('batch deletion and local reset preserve settings without retaining ticket snapshots', () async {
    final app = await store(),
        first = ticket(),
        second = ticket().withChanges({'id': 'second', 'service': 'G22'});
    app.settings = {'flightMcpKey': 'existing-setting'};
    await app.saveProfile({'chineseName': '示例旅客'});
    await app.save(first);
    await app.save(second);
    await app.deleteMany({first.id, second.id});
    expect(app.records, isEmpty);
    expect(app.privateRecords.every((r) => r.deleted), true);
    final profile = app.settings['profile'];
    await app.clearLocalArchive();
    expect(app.privateRecords, isEmpty);
    expect(app.connection, isNull);
    final saved = jsonDecode(app.preferences.getString(AppStore.storageKey)!);
    expect(saved['base']['records'], isEmpty);
    expect(saved['settings']['profile'], profile);
    expect(saved['settings']['flightMcpKey'], 'existing-setting');
    expect(saved['pending'], false);
    app.dispose();
  });
  test('sync rebases resolved profile conflicts and reset adopts a new empty generation', () async {
    SharedPreferences.setMockInitialValues({});
    final remote = _MemoryRemote();
    final app = AppStore(
      await SharedPreferences.getInstance(),
      catalog,
      [],
      {},
      remoteFactory: (_, _) => remote,
    );
    await app.connect(const GitHubConnection('user', 'private'), 'test');
    final key = app.settings['flightMcpKey'];
    remote.update({
      'profile': personalProfile({'chineseName': '云端姓名'}),
      'flightMcpKey': key,
    });
    await app.saveProfile({'chineseName': '本机姓名'});
    expect(app.settingsConflicts!.conflicts, hasLength(1));
    await app.resolveConflicts({'settings:profile': false});
    expect(remote.snapshot.settings['profile']['chineseName'], '本机姓名');
    expect(app.settingsConflicts, isNull);
    await app.save(ticket());
    expect(app.records, hasLength(1));
    final generation = remote.snapshot.generation;
    await app.resetRepository();
    expect(app.records, isEmpty);
    expect(remote.snapshot.generation, isNot(generation));
    expect(app.settings['profile']['chineseName'], '本机姓名');
    expect(app.settings['flightMcpKey'], key);
    expect(app.pending, false);
    app.dispose();
  });

  test(
    'a failed refresh cannot apply choices from an outdated conflict review',
    () async {
      SharedPreferences.setMockInitialValues({});
      final remote = _MemoryRemote();
      final app = AppStore(
        await SharedPreferences.getInstance(),
        catalog,
        [],
        {},
        remoteFactory: (_, _) => remote,
      );
      addTearDown(app.dispose);
      await app.connect(const GitHubConnection('user', 'private'), 'test');
      final record = ticket();
      await app.save(record);
      remote.update(
        remote.snapshot.settings,
        records: [
          record.withChanges({'seat': '11F'}),
        ],
      );
      expect(
        await app.save(record.withChanges({'seat': '12F'})),
        SaveOutcome.pending,
      );
      expect(app.conflicts?.conflicts.single.field, 'seat');

      remote.offline = true;
      expect(
        await app.save(record.withChanges({'seat': '13F'})),
        SaveOutcome.pending,
      );
      final saved = jsonDecode(app.preferences.getString(AppStore.storageKey)!);
      expect(
        TicketArchive.fromJson(saved['local']).records.single.text('seat'),
        '13F',
      );
      expect(app.syncError, isNotEmpty);
      await expectLater(app.sync(), throwsStateError);
      await app.resolveConflicts({'${record.id}:seat': true});
      expect(app.records.single.text('seat'), '13F');
      expect(app.pending, true);
      expect(app.conflicts, isNull);
    },
  );

  test(
    'reset-only authorization preserves an unrelated local ticket library',
    () async {
      SharedPreferences.setMockInitialValues({});
      final remote = _MemoryRemote()..legacy = true;
      final app = AppStore(
        await SharedPreferences.getInstance(),
        catalog,
        [],
        {},
        remoteFactory: (target, token) {
          expect(target.label, 'user/private');
          expect(token, 'reset-token');
          return remote;
        },
      );
      addTearDown(app.dispose);
      final record = ticket();
      await app.save(record);
      remote.update(remote.snapshot.settings, records: [ticket()]);

      await app.resetRepository(
        target: const GitHubConnection('user', 'private'),
        token: 'reset-token',
      );
      expect(remote.snapshot.records, isEmpty);
      expect(remote.snapshot.settings['flightMcpKey'], 'preserved-key');
      expect(app.records.single.id, record.id);
      expect(app.connection, isNull);
      expect(app.connected, false);
    },
  );

  test(
    'a saved binding can reset after the session credentials are gone',
    () async {
      SharedPreferences.setMockInitialValues({});
      final remote = _MemoryRemote();
      final app =
          AppStore(
              await SharedPreferences.getInstance(),
              catalog,
              [],
              {},
              remoteFactory: (_, _) => remote,
            )
            ..connection = const GitHubConnection(
              'user',
              'private',
              repositoryId: 1,
            );
      addTearDown(app.dispose);
      expect(await app.save(ticket()), SaveOutcome.pending);
      expect(app.connected, false);
      await app.resetRepository(token: 'reset-token');
      expect(app.records, isEmpty);
      expect(app.connection?.label, 'user/private');
      expect(app.connected, false);
      expect(app.pending, false);
      final saved = jsonDecode(app.preferences.getString(AppStore.storageKey)!);
      expect(saved['generation'], 'reset');
      expect(saved['settings']['flightMcpKey'], 'preserved-key');
    },
  );

  test('a bound archive cannot silently connect to another branch', () async {
    SharedPreferences.setMockInitialValues({});
    final remote = _MemoryRemote();
    final app = AppStore(
      await SharedPreferences.getInstance(),
      catalog,
      [],
      {},
      remoteFactory: (_, _) => remote,
    );
    addTearDown(app.dispose);
    await app.connect(const GitHubConnection('user', 'private'), 'test');
    await expectLater(
      app.connect(
        const GitHubConnection('user', 'private', branch: 'other'),
        'test',
      ),
      throwsFormatException,
    );
    expect(app.connection?.branch, 'main');
  });
}

class _MemoryRemote extends GitHubArchive {
  _MemoryRemote() : super(const GitHubConnection('user', 'private'), 'test');
  ArchiveSnapshot snapshot = ArchiveSnapshot(
    records: [],
    settings: {'flightMcpKey': 'preserved-key'},
    head: '0',
    tree: 'tree',
    repositoryId: 1,
    generation: 'initial',
  );
  bool offline = false, legacy = false;
  void update(
    Map<String, dynamic> settings, {
    List<TicketRecord>? records,
    String? generation,
  }) {
    snapshot = ArchiveSnapshot(
      records: records ?? snapshot.records,
      settings: settings,
      head: '${int.parse(snapshot.head) + 1}',
      tree: 'tree',
      repositoryId: 1,
      generation: generation ?? snapshot.generation,
    );
  }

  @override
  Future<Map<String, dynamic>> verify() async => {'id': 1};
  @override
  Future<ArchiveSnapshot> read() async {
    if (offline) throw StateError('offline');
    if (legacy) throw const FormatException('unsupported ticket format');
    return snapshot;
  }

  @override
  Future<ArchiveSnapshot> resetTarget({
    Map<String, dynamic> fallbackSettings = const {},
  }) async => snapshot;

  @override
  Future<void> assertDescendant(String previous, String current) async {}
  @override
  Future<String> write(
    List<TicketRecord> records,
    ArchiveSnapshot before,
    Map<String, dynamic> settings,
  ) async {
    update(settings, records: records);
    return snapshot.head;
  }

  @override
  Future<ArchiveSnapshot> reset(
    ArchiveSnapshot before,
    Map<String, dynamic> settings,
  ) async {
    update(settings, records: [], generation: 'reset');
    return snapshot;
  }
}
