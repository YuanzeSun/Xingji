import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji/app_store.dart';
import 'package:xingji/platform_services.dart';
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
    'identity': '110101199001011234',
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

  test('a duplicate rail trip merges blanks and rejects conflicting ticket details', () async {
    final app = await store();
    addTearDown(app.dispose);
    final initial = ticket().withChanges({'ticketNumber': 'T000001'});
    await app.save(initial);
    await app.importArchive(
      TicketArchive([
        ticket().withChanges({'gate': '16A'}),
      ]),
    );
    expect(app.records.single.text('gate'), '16A');
    await expectLater(
      app.importArchive(
        TicketArchive([
          ticket().withChanges({'ticketNumber': 'T000002', 'gate': '18B'}),
        ]),
      ),
      throwsA(
        isA<FormatException>().having(
          (e) => e.message,
          'message',
          contains('票号'),
        ),
      ),
    );
    expect(app.records.single.text('gate'), '16A');
    expect(app.records.single.text('ticketNumber'), 'T000001');
  });

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
    'iOS restores a bound repository from Keychain and forgets it on reset',
    () async {
      debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
      final messenger =
          TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
      final keychain = <String, String>{};
      messenger.setMockMethodCallHandler(AppleServices.channel, (call) async {
        final key = call.arguments['key'] as String;
        if (call.method == 'readCredential') return keychain[key];
        if (call.method == 'writeCredential') {
          keychain[key] = call.arguments['value'] as String;
        } else if (call.method == 'deleteCredential') {
          keychain.remove(key);
        }
        return null;
      });
      addTearDown(() {
        debugDefaultTargetPlatformOverride = null;
        messenger.setMockMethodCallHandler(AppleServices.channel, null);
      });

      SharedPreferences.setMockInitialValues({});
      final preferences = await SharedPreferences.getInstance();
      final remote = _MemoryRemote();
      final first = AppStore(
        preferences,
        catalog,
        [],
        {},
        remoteFactory: (_, _) => remote,
      );
      addTearDown(first.dispose);
      await first.connect(
        const GitHubConnection('user', 'private'),
        'test-pat',
      );
      expect(keychain['github:user/private:main'], 'test-pat');
      expect(
        preferences.getString(AppStore.storageKey),
        isNot(contains('test-pat')),
      );

      final reopened = AppStore(
        preferences,
        catalog,
        [],
        {},
        remoteFactory: (target, token) {
          expect(target.repositoryId, first.connection?.repositoryId);
          expect(token, 'test-pat');
          return remote;
        },
      )..connection = first.connection;
      addTearDown(reopened.dispose);
      expect(reopened.canWrite, isFalse);
      await reopened.restoreConnection();
      expect(reopened.canWrite, isTrue);
      await reopened.clearLocalArchive();
      expect(keychain, isEmpty);
      expect(reopened.connection, isNull);
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
    await expectLater(app.save(record), throwsFormatException);
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
  test(
    'profile conflicts resolve online and reset adopts a new empty generation',
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
      await app.connect(const GitHubConnection('user', 'private'), 'test');
      final key = app.settings['flightMcpKey'];
      remote.update({
        'profile': personalProfile({'chineseName': '云端姓名'}),
        'flightMcpKey': key,
      });
      await app.saveProfile(
        {'chineseName': '本机姓名'},
        pick: (tickets, shared) async {
          expect(shared.conflicts, hasLength(1));
          expect(app.settings['profile'], isNull);
          return {'settings:profile': false};
        },
      );
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
    },
  );

  test(
    'bound archive is read-only without a session and when the network fails',
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
      await app.connect(const GitHubConnection('user', 'private'), 'test');
      await app.save(record);
      final before = app.preferences.getString(AppStore.storageKey);
      final reopened = await AppStore.load();
      addTearDown(reopened.dispose);
      expect(reopened.canWrite, false);
      expect(reopened.records.single.id, record.id);
      await expectLater(reopened.save(record), throwsFormatException);

      remote.offline = true;
      await expectLater(
        app.save(record.withChanges({'seat': '12F'})),
        throwsStateError,
      );
      expect(app.canWrite, false);
      expect(app.records.single.text('seat'), '08F');
      expect(app.preferences.getString(AppStore.storageKey), before);
      expect(app.pending, false);
      await expectLater(app.delete(record), throwsFormatException);
      await expectLater(app.deleteMany({record.id}), throwsFormatException);
      await expectLater(
        app.importArchive(TicketArchive([record])),
        throwsFormatException,
      );
      await expectLater(
        app.saveProfile({'chineseName': '离线'}),
        throwsFormatException,
      );
      await app.refreshConnection();
      expect(app.canWrite, false);

      remote.offline = false;
      remote.update(
        remote.snapshot.settings,
        records: [
          record.withChanges({'seat': '16F'}),
        ],
      );
      remote.beforeWrite = () =>
          fail('Reconnect should only read the confirmed cloud archive');
      await app.refreshConnection();
      expect(app.canWrite, true);
      expect(app.records.single.text('seat'), '16F');
      expect(remote.snapshot.records.single.text('seat'), '16F');
    },
  );

  test(
    'a rejected cloud write leaves both the cache and the archive unchanged',
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
      final before = app.preferences.getString(AppStore.storageKey);
      remote.beforeWrite = () => remote.offline = true;
      await expectLater(app.delete(record), throwsStateError);
      expect(app.records.single.id, record.id);
      expect(remote.snapshot.records.single.deleted, false);
      expect(app.preferences.getString(AppStore.storageKey), before);
      expect(app.canWrite, false);
    },
  );

  test(
    'a racing write retries on the new head and merges independent edits',
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
      await app.save(ticket());
      final original = app.records.single;
      remote.beforeWrite = () => remote.update(
        remote.snapshot.settings,
        records: [
          original.withChanges({'gate': '4A'}),
        ],
      );
      await app.save(original.withChanges({'seat': '16F'}), original: original);
      expect(remote.snapshot.records.single.text('seat'), '16F');
      expect(remote.snapshot.records.single.text('gate'), '4A');

      final refreshed = app.records.single;
      remote.beforeWrite = () => remote.update(
        remote.snapshot.settings,
        records: [
          refreshed.withChanges({'seat': '17A'}),
        ],
      );
      await app.save(
        refreshed.withChanges({'seat': '17F'}),
        original: refreshed,
        pick: (tickets, settings) async {
          final conflict = tickets.conflicts.single;
          expect(conflict.field, 'seat');
          expect(conflict.remote, '17A');
          expect(conflict.local, '17F');
          expect(app.records.single.text('seat'), '16F');
          return {'${refreshed.id}:seat': true};
        },
      );
      expect(app.records.single.text('seat'), '17A');
      expect(app.pending, false);
    },
  );

  test('conflict from a stale editor can be canceled or resolved without persisting a draft', () async {
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
    await app.save(ticket());
    final original = app.records.single;
    remote.update(
      remote.snapshot.settings,
      records: [
        original.withChanges({'seat': '11F'}),
      ],
    );
    await app.refreshConnection();
    final draft = original.withChanges({'seat': '12F'});
    final before = app.preferences.getString(AppStore.storageKey);
    await expectLater(
      app.save(
        draft,
        original: original,
        pick: (tickets, settings) async {
          expect(tickets.conflicts.single.field, 'seat');
          return null;
        },
      ),
      throwsFormatException,
    );
    expect(app.preferences.getString(AppStore.storageKey), before);
    expect(app.records.single.text('seat'), '11F');
    expect(remote.snapshot.records.single.text('seat'), '11F');
    await app.save(
      draft,
      original: original,
      pick: (tickets, settings) async {
        expect(tickets.conflicts.single.remote, '11F');
        return {'${original.id}:seat': false};
      },
    );
    expect(remote.snapshot.records.single.text('seat'), '12F');
  });

  for (final choice in <BindingChoice?>[null, ...BindingChoice.values]) {
    test('first binding with two libraries handles $choice', () async {
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
      final local = ticket(),
          cloud = ticket().withChanges({'id': 'cloud', 'service': 'G22'});
      await app.save(local);
      remote.update(remote.snapshot.settings, records: [cloud]);
      final before = app.preferences.getString(AppStore.storageKey);
      final binding = await app.connect(
        const GitHubConnection('user', 'private'),
        'test',
        choose: (localCount, cloudCount) async {
          expect(localCount, 1);
          expect(cloudCount, 1);
          return choice;
        },
      );
      if (choice == null) {
        expect(binding, false);
        expect(app.connection, isNull);
        expect(app.preferences.getString(AppStore.storageKey), before);
        expect(remote.snapshot.records.single.id, cloud.id);
        return;
      }
      final ids = switch (choice) {
        BindingChoice.merge => {local.id, cloud.id},
        BindingChoice.replaceCloud => {local.id},
        BindingChoice.replaceLocal => {cloud.id},
      };
      expect(binding, true);
      expect(app.records.map((row) => row.id).toSet(), ids);
      expect(remote.snapshot.records.map((row) => row.id).toSet(), ids);
      expect(
        remote.snapshot.generation,
        choice == BindingChoice.replaceCloud ? isNot('initial') : 'initial',
      );
      expect(remote.snapshot.settings['flightMcpKey'], 'preserved-key');
    });
  }

  test(
    'D1 can be used alone, and signing out clears only the local cache',
    () async {
      SharedPreferences.setMockInitialValues({});
      final d1 = _MemoryD1();
      final app = AppStore(
        await SharedPreferences.getInstance(),
        catalog,
        [],
        {},
        d1Factory: (_, _) => d1,
      );
      addTearDown(app.dispose);
      await app.connectD1(d1.connection, d1.token);
      await app.save(ticket());
      expect(app.hasCloud, true);
      expect(app.connection, isNull);
      expect(d1.snapshot.records, hasLength(1));
      expect(
        (await app.exportBackup()).toJson()['connections']['d1']['token'],
        d1.token,
      );
      d1.offline = true;
      await expectLater(app.sync(), throwsStateError);
      expect(app.canWrite, false);
      expect(app.records, hasLength(1));
      await app.clearLocalArchive(signOut: true);
      expect(app.hasCloud, false);
      expect(app.records, isEmpty);
      expect(d1.snapshot.records, hasLength(1));
    },
  );

  test('either linked login uses D1 and ordinary edits never update the GitHub backup', () async {
    SharedPreferences.setMockInitialValues({});
    final d1 = _MemoryD1(), github = _MemoryRemote();
    final prefs = await SharedPreferences.getInstance();
    AppStore newStore() => AppStore(
      prefs,
      catalog,
      [],
      {},
      d1Factory: (_, _) => d1,
      remoteFactory: (_, _) => github,
    );
    final owner = newStore(), fromGitHub = newStore(), fromD1 = newStore();
    addTearDown(owner.dispose);
    addTearDown(fromGitHub.dispose);
    addTearDown(fromD1.dispose);
    await owner.connectD1(d1.connection, d1.token);
    await owner.save(ticket());
    await owner.connect(
      github.connection,
      github.token,
      chooseSource: (_, _) async => CloudSource.d1,
    );
    expect(owner.isPaired, true);
    final cached = jsonDecode(prefs.getString(AppStore.storageKey)!) as Map;
    expect(cached['settings']['connections'], isNull);
    expect(cached['baseSettings']['connections'], isNull);
    final backup = (await owner.exportBackup()).toJson();
    expect(backup['connections']['github']['token'], github.token);
    expect(backup['connections']['d1']['token'], d1.token);
    final staleHead = github.snapshot.head;
    await owner.save(owner.records.single.withChanges({'gate': '09A'}));
    expect(github.snapshot.head, staleHead);
    await fromGitHub.connect(github.connection, github.token);
    expect(fromGitHub.isPaired, true);
    expect(fromGitHub.records.single.text('gate'), '09A');
    github.offline = true;
    await fromD1.connectD1(d1.connection, d1.token);
    expect(fromD1.isPaired, true);
    expect(fromD1.records.single.text('gate'), '09A');
    await fromD1.save(fromD1.records.single.withChanges({'gate': '12A'}));
    expect(github.snapshot.head, staleHead);
    github.offline = false;
    await fromD1.backupToGitHub();
    expect(github.snapshot.records.single.text('gate'), '12A');
    await fromD1.clearLocalArchive(signOut: true);
    expect(fromD1.hasCloud, false);
    expect(linkedCloud(d1.snapshot), isNotNull);
  });

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
      await expectLater(app.save(ticket()), throwsFormatException);
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

  test(
    'signing out clears account data locally and leaves GitHub intact',
    () async {
      SharedPreferences.setMockInitialValues({});
      final remote = _MemoryRemote();
      final preferences = await SharedPreferences.getInstance();
      final app = AppStore(
        preferences,
        catalog,
        [],
        {},
        remoteFactory: (_, _) => remote,
      );
      addTearDown(app.dispose);
      const target = GitHubConnection('user', 'private');
      await app.connect(target, 'test');
      final head = remote.snapshot.head;
      expect(app.settings['flightMcpKey'], 'preserved-key');
      await expectLater(
        app.connect(target, 'another-token'),
        throwsFormatException,
      );
      await app.clearLocalArchive(signOut: true);
      expect(app.connected, false);
      expect(app.connection, isNull);
      expect(app.records, isEmpty);
      expect(app.settings['flightMcpKey'], '');
      expect(app.canWrite, true);
      expect(remote.snapshot.head, head);
      expect(remote.snapshot.settings['flightMcpKey'], 'preserved-key');
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
  void Function()? beforeWrite;
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
  Future<String> head() async => (await read()).head;
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
    final race = beforeWrite;
    beforeWrite = null;
    race?.call();
    if (offline) throw StateError('offline');
    if (before.head != snapshot.head) throw ArchiveApiException('stale', 422);
    update(settings, records: records);
    return snapshot.head;
  }

  @override
  Future<String> replaceTickets(
    List<TicketRecord> records,
    ArchiveSnapshot before,
    Map<String, dynamic> settings,
    String generation,
  ) async {
    if (before.head != snapshot.head) throw ArchiveApiException('stale', 422);
    update(settings, records: records, generation: generation);
    return snapshot.head;
  }

  @override
  Future<ArchiveSnapshot> reset(
    ArchiveSnapshot before,
    Map<String, dynamic> settings, {
    String? resetId,
  }) async {
    update(settings, records: [], generation: resetId ?? 'reset');
    return snapshot;
  }
}

class _MemoryD1 extends D1Archive {
  _MemoryD1()
    : super(
        D1Connection('https://archive.example.workers.dev', id: id),
        'test-d1',
      );
  static const id = '0123456789abcdef0123456789abcdef';
  ArchiveSnapshot snapshot = ArchiveSnapshot(
    databaseId: id,
    head: 'start',
    tree: '',
    records: [],
    settings: {'flightMcpKey': ''},
    generation: 'initial',
  );
  bool offline = false;

  @override
  Future<ArchiveSnapshot> read() async {
    if (offline) throw StateError('offline');
    return snapshot;
  }

  @override
  Future<String> write(
    List<TicketRecord> records,
    ArchiveSnapshot before,
    Map<String, dynamic> settings,
  ) async => (await _commit(before, records, settings)).head;

  @override
  Future<ArchiveSnapshot> replace(
    ArchiveSnapshot before,
    List<TicketRecord> records,
    Map<String, dynamic> settings, {
    String? resetId,
  }) => _commit(before, records, settings, resetId: resetId ?? newTicketId());

  Future<ArchiveSnapshot> _commit(
    ArchiveSnapshot before,
    List<TicketRecord> records,
    Map<String, dynamic> settings, {
    String? resetId,
  }) async {
    if (offline) throw StateError('offline');
    if (before.head != snapshot.head) {
      throw ArchiveApiException('stale D1 head', 409);
    }
    return snapshot = ArchiveSnapshot(
      databaseId: id,
      head: resetId ?? newTicketId(),
      tree: '',
      records: records,
      settings: settings,
      generation: resetId ?? before.generation,
    );
  }
}
