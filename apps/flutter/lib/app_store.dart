import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji_core/xingji_core.dart';

import 'platform_services.dart';
import 'ticket_face.dart';
import 'ticket_runtime_native.dart'
    if (dart.library.js_interop) 'ticket_runtime_web.dart'
    as runtime;

Future<List<TicketRecord>> _normalizeCloudRecords(
  List<TicketRecord> records,
) async {
  final archive = TicketArchive(records).toJson();
  final result =
      jsonDecode(await runtime.normalizeArchive(jsonEncode(archive))) as Map;
  if (result['error'] case final String message) throw FormatException(message);
  return TicketArchive.fromJson({...archive, 'records': result['records']})
      .records;
}

enum SaveOutcome { local, synced }

enum BindingChoice { merge, replaceCloud, replaceLocal }

typedef PickConflicts = Future<Map<String, bool>?> Function(
  ArchiveMerge tickets,
  SettingsMerge settings,
);

typedef ChooseLocalArchive = Future<BindingChoice?> Function(
  int localCount,
  int cloudCount,
);
typedef ChooseCloudSource = Future<CloudSource?> Function(
  int githubCount,
  int d1Count,
);
typedef CloudResetPreview = ({ArchiveSnapshot? github, ArchiveSnapshot? d1});

/// Demo data never enters the private archive or the persistence envelope.
class AppStore extends ChangeNotifier {
  final SharedPreferences preferences;
  final ReferenceCatalog catalog;
  final List<TicketRecord> examples;
  final Map<String, dynamic> mapData;
  final GitHubArchive Function(GitHubConnection, String) remoteFactory;
  final D1Archive Function(D1Connection, String) d1Factory;
  List<TicketRecord> _records = [], _base = [];
  ArchiveSnapshot? _reviewedRemote;
  Map<String, dynamic> settings = {}, _baseSettings = {};
  GitHubConnection? connection;
  D1Connection? d1Connection;
  GitHubArchive? _github;
  D1Archive? _d1;
  ArchiveRemote? get _remote => d1Connection != null ? _d1 : _github;
  Map<String, dynamic>? _resetJournal;
  ArchiveMerge? conflicts;
  SettingsMerge? settingsConflicts;
  bool resetDetected = false;
  String _head = '', _generation = '';
  int _archiveSession = 0;
  bool demo = false, busy = false, pending = false;
  bool _online = false, _checking = false;
  String status = '本机票库';
  String? syncError;
  AppStore(
    this.preferences,
    this.catalog,
    this.examples,
    this.mapData, {
    GitHubArchive Function(GitHubConnection, String)? remoteFactory,
    D1Archive Function(D1Connection, String)? d1Factory,
  }) : remoteFactory =
           remoteFactory ?? ((target, token) => GitHubArchive(target, token)),
       d1Factory = d1Factory ?? ((target, token) => D1Archive(target, token));
  static const storageKey = 'xingji.flutter.archive.v2';
  static Future<AppStore> load() async {
    final assets = await Future.wait(
      [
        'reference',
        'demo',
        'map',
      ].map((name) => rootBundle.loadString('assets/$name.json')),
    );
    final preferences = await SharedPreferences.getInstance();
    final store = AppStore(
      preferences,
      ReferenceCatalog.fromJson(jsonDecode(assets[0])),
      TicketArchive.fromJson(jsonDecode(assets[1])).records,
      jsonDecode(assets[2]),
      remoteFactory: (target, token) => GitHubArchive(
        target,
        token,
        normalizeRecords: _normalizeCloudRecords,
      ),
      d1Factory: (target, token) =>
          D1Archive(target, token, normalizeRecords: _normalizeCloudRecords),
    );
    final saved = preferences.getString(storageKey);
    await prepareTicketFaces(store.examples);
    if (saved != null) {
      final envelope = jsonDecode(saved) as Map<String, dynamic>;
      store._records = TicketArchive.fromJson(envelope['local']).records;
      store._base = TicketArchive.fromJson(envelope['base']).records;
      store.settings = Map<String, dynamic>.from(envelope['settings']);
      store._baseSettings = sharedSettings(
        envelope['baseSettings'] ?? envelope['settings'],
      );
      store._head = envelope['head'];
      store._generation = envelope['generation'];
      if (envelope['connection'] != null) {
        store.connection = GitHubConnection.fromJson(envelope['connection']);
      }
      if (envelope['d1Connection'] case final Map d1) {
        store.d1Connection = D1Connection.fromJson(d1);
      }
      store._resetJournal = envelope['resetProgress'] as Map<String, dynamic>?;
      store.pending = store.hasCloud && envelope['pending'] == true;
      if (store.hasCloud) {
        store.status = '云端票库待连接 · 只读';
      }
    }
    return store;
  }

  bool _restoreTried = false;

  String _credentialKey(GitHubConnection target) =>
      'github:${target.label.toLowerCase()}:${target.branch}';
  String _d1CredentialKey(D1Connection target) => 'd1:${target.url}';

  Future<void> restoreConnection() async {
    if (!AppleServices.available ||
        !hasCloud ||
        connected ||
        busy ||
        demo ||
        _restoreTried) {
      return;
    }
    _restoreTried = true;
    await _run(() async {
      try {
        await _restoreGitHubCredential();
        final target = d1Connection;
        if (target != null) {
          final token = await AppleServices.credential(
            _d1CredentialKey(target),
          );
          if (token != null) _d1 = d1Factory(target, token);
        }
        if (_remote == null || hasResetProgress) return;
        try {
          await _sync();
        } on ArchiveApiException catch (error) {
          if (error.status == 401) {
            _remote?.close();
            if (d1Connection == null) {
              _github = null;
            } else {
              _d1 = null;
            }
            status = '云端授权已失效 · 只读';
          }
        } catch (_) {
          // The cache is still readable. Connection refresh retries on resume.
        }
      } catch (_) {
        syncError = '暂时无法读取钥匙串中的云端凭据';
      }
    });
  }

  Future<void> _restoreGitHubCredential() async {
    final target = connection;
    if (target == null) return;
    final token = await AppleServices.credential(_credentialKey(target));
    if (token != null) _github = remoteFactory(target, token);
  }

  Future<void> _rememberCredential(String key, String token) async {
    if (!AppleServices.available) return;
    try {
      await AppleServices.writeCredential(key, token);
    } catch (_) {
      syncError = '票库已连接，但无法在钥匙串保留凭据';
    }
  }

  bool get connected => _remote != null;
  bool get hasCloud => connection != null || d1Connection != null;
  bool get githubConnected => _github != null;
  bool get d1Connected => _d1 != null;
  bool get isPaired => connection != null && d1Connection != null;
  bool get hasResetProgress => _resetJournal != null;
  String? get readOnlyReason {
    if (hasResetProgress) return '请继续或放弃此前的票库重置';
    if (!hasCloud) return null;
    if (!connected) {
      return d1Connection != null ? '请重新登录 D1 后编辑' : '请重新登录 GitHub 后编辑';
    }
    if (resetDetected) return '请先处理云端票库重置';
    if (conflicts != null) return '请先处理同步冲突';
    if (!_online) return '云端连接不可用，票库暂时只读';
    if (pending) return '请先完成之前的同步';
    return null;
  }

  bool get canWrite => !demo && !busy && readOnlyReason == null;
  int get archiveSession => _archiveSession;

  List<TicketRecord> get records =>
      (demo ? examples : _records).where((record) => !record.deleted).toList();
  List<TicketRecord> get privateRecords => List.unmodifiable(_records);
  Future<void> _persist() async {
    final saved = await preferences.setString(
      storageKey,
      jsonEncode({
        'local': TicketArchive(_records).toJson(),
        'base': TicketArchive(_base).toJson(),
        'settings': {...settings}..remove('connections'),
        'baseSettings': {..._baseSettings}..remove('connections'),
        'head': _head,
        'generation': _generation,
        'pending': pending,
        'connection': connection?.toJson(),
        'd1Connection': d1Connection?.toJson(),
        if (_resetJournal != null) 'resetProgress': _resetJournal,
      }),
    );
    if (!saved) throw StateError('本机存储失败，请先导出备份');
  }

  void setDemo(bool value) {
    if (demo == value) return;
    demo = value;
    _archiveSession++;
    notifyListeners();
  }

  Future<T> _run<T>(Future<T> Function() action) async {
    if (busy) throw StateError('正在保存，请稍候');
    busy = true;
    notifyListeners();
    try {
      return await action();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  void _requireWritable() {
    if (demo) throw const FormatException('请先退出示例模式');
    if (readOnlyReason case final reason?) throw FormatException(reason);
  }

  Future<void> checkWriteAccess() async {
    _requireWritable();
    if (!hasCloud) return;
    await _run(() async {
      try {
        await _remote!.head();
      } catch (failure) {
        _syncFailure(failure);
        throw FormatException(readOnlyReason ?? syncError!);
      }
    });
  }

  Future<void> refreshConnection() async {
    final remote = _remote;
    if (remote == null ||
        demo ||
        busy ||
        _checking ||
        resetDetected ||
        hasResetProgress ||
        conflicts != null) {
      return;
    }
    final previous = _head;
    _checking = true;
    try {
      final head = await remote.head();
      if (!busy &&
          !demo &&
          identical(remote, _remote) &&
          previous == _head &&
          (!_online || head != _head)) {
        await sync();
      }
    } catch (failure) {
      if (!busy &&
          identical(remote, _remote) &&
          previous == _head &&
          !resetDetected &&
          conflicts == null) {
        _syncFailure(failure);
        notifyListeners();
      }
    } finally {
      _checking = false;
    }
  }

  List<TicketRecord> _replaceRecords(Iterable<TicketRecord> rows) {
    final byId = {for (final record in _records) record.id: record};
    for (final record in rows) {
      byId[record.id] = record;
    }
    return byId.values.toList();
  }

  Future<SaveOutcome> _saveChanges({
    List<TicketRecord>? records,
    List<TicketRecord>? baseRecords,
    Map<String, dynamic>? nextSettings,
    Map<String, dynamic>? baseSettings,
    PickConflicts? pick,
  }) async {
    _requireWritable();
    final next = records ?? _records;
    final preferences = nextSettings ?? settings;
    final remote = _remote;
    final previous = baseRecords ?? _records;
    final updated = changedRailDuplicateIds(previous, next);
    final reviewed = records == null
        ? next
        : deduplicateTickets(next, catalog, rejectRailConflictsFor: updated);
    if (remote == null) {
      final oldRecords = _records, oldSettings = settings;
      _records = reviewed;
      settings = preferences;
      try {
        await _persist();
      } catch (_) {
        _records = oldRecords;
        settings = oldSettings;
        rethrow;
      }
      status = '已保存在本机';
      return SaveOutcome.local;
    }

    // Keep the edit in the form until the branch update succeeds. Retry once
    // if another device advanced the branch between reading and publishing.
    final canonicalNext = await remote.canonicalRecords(reviewed);
    final previousSettings = baseSettings ?? settings;
    for (var attempt = 0; ; attempt++) {
      late final ArchiveSnapshot snapshot;
      try {
        snapshot = await _currentSnapshot(remote);
      } catch (failure) {
        _syncFailure(failure);
        rethrow;
      }
      if (snapshot.head != _head) {
        checkRailDuplicates(next, updated, snapshot.records, catalog);
      }
      final tickets = mergeTickets(
        previous,
        canonicalNext,
        snapshot.records,
        catalog: catalog,
      );
      final shared = mergeSettings(
        previousSettings,
        preferences,
        snapshot.settings,
      );
      var merged = tickets.records, mergedSettings = shared.settings;
      if (tickets.conflicts.isNotEmpty || shared.conflicts.isNotEmpty) {
        final choices = await pick?.call(tickets, shared);
        if (choices == null) {
          throw const FormatException('修改尚未保存，请核对两端的内容');
        }
        merged = tickets.resolve(choices);
        mergedSettings = shared.resolve(choices);
      }
      merged = await remote.canonicalRecords(
        deduplicateTickets(merged, catalog),
      );
      try {
        final head = await remote.write(merged, snapshot, mergedSettings);
        _adopt(
          snapshot,
          records: merged,
          newSettings: mergedSettings,
          head: head,
        );
        await _persistSynced();
        return SaveOutcome.synced;
      } on ArchiveApiException catch (failure) {
        if (failure.status == 409 || failure.status == 422) {
          if (attempt == 0) continue;
          throw const FormatException('云端票库仍在变化，请稍后重新保存');
        }
        if (remote is D1Archive &&
            (failure.status == 400 || failure.status == 413)) {
          rethrow;
        }
        _syncFailure(failure);
        rethrow;
      } catch (failure) {
        _syncFailure(failure);
        rethrow;
      }
    }
  }

  Future<SaveOutcome> save(
    TicketRecord record, {
    TicketRecord? original,
    PickConflicts? pick,
  }) => _run(() async {
    _requireWritable();
    if (record.missingFields.isNotEmpty) throw const FormatException('请补全必填项');
    requireCompleteIdentity(record.text('identity'));
    final next = catalog.normalize(record.withChanges({'updatedAt': utcNow()}));
    return _saveChanges(
      records: _replaceRecords([next]),
      baseRecords: original == null ? null : _replaceRecords([original]),
      pick: pick,
    );
  });

  Future<void> delete(TicketRecord record, {PickConflicts? pick}) =>
      deleteMany({record.id}, originals: [record], pick: pick);

  Future<void> deleteMany(
    Set<String> ids, {
    Iterable<TicketRecord> originals = const [],
    PickConflicts? pick,
  }) => _run(() async {
    _requireWritable();
    final base = _replaceRecords(originals);
    await _saveChanges(
      baseRecords: base,
      records: base
          .map(
            (row) => ids.contains(row.id)
                ? row.withChanges({'deleted': true, 'updatedAt': utcNow()})
                : row,
          )
          .toList(),
      pick: pick,
    );
  });

  Future<void> saveProfile(
    Map<String, dynamic> profile, {
    Map<String, dynamic>? original,
    PickConflicts? pick,
  }) => _run(() async {
    await _saveChanges(
      nextSettings: sharedSettings({
        ...settings,
        'profile': personalProfile(profile),
      }),
      baseSettings: original == null
          ? null
          : {...settings, 'profile': original},
      pick: pick,
    );
  });

  Future<FullArchiveBackup> exportBackup() async {
    final target = connection;
    final archive = TicketArchive(List.of(_records));
    final savedSettings = sharedSettings(settings);
    var token = _github?.token ?? '';
    if (token.isEmpty && target != null && AppleServices.available) {
      token = await AppleServices.credential(_credentialKey(target)) ?? '';
    }
    final d1 = d1Connection;
    var d1Token = _d1?.token ?? '';
    if (d1Token.isEmpty && d1 != null && AppleServices.available) {
      d1Token = await AppleServices.credential(_d1CredentialKey(d1)) ?? '';
    }
    return FullArchiveBackup(
      archive,
      savedSettings,
      github: target == null ? null : (target: target, token: token),
      d1: d1 == null ? null : (target: d1, token: d1Token),
    );
  }

  Future<void> importArchive(
    TicketArchive archive, {
    Map<String, dynamic>? backupSettings,
    PickConflicts? pick,
  }) => _run(() async {
    for (final record in archive.records) {
      requireCompleteIdentity(record.text('identity'));
    }
    await _saveChanges(
      records: [..._records, ...archive.records],
      nextSettings: backupSettings == null
          ? null
          : sharedSettings({
              ...backupSettings,
              'connections': settings['connections'],
            }),
      pick: pick,
    );
  });

  void _checkBinding(GitHubConnection target) {
    final current = connection;
    if (current != null &&
        (current.label.toLowerCase() != target.label.toLowerCase() ||
            current.branch != target.branch)) {
      throw const FormatException('请先导出并清空本机票库，再切换仓库或分支');
    }
  }

  GitHubConnection _verifiedGitHub(
    GitHubConnection target,
    ArchiveSnapshot snapshot,
  ) {
    final id = snapshot.repositoryId;
    if (id == null ||
        target.repositoryId != null && target.repositoryId != id ||
        connection?.repositoryId != null && connection!.repositoryId != id) {
      throw const FormatException('GitHub 仓库身份已改变，已保留本机票库');
    }
    return GitHubConnection(
      target.owner,
      target.repository,
      branch: target.branch,
      repositoryId: id,
    );
  }

  Future<bool> connect(
    GitHubConnection target,
    String token, {
    ChooseLocalArchive? choose,
    PickConflicts? pick,
    ChooseCloudSource? chooseSource,
  }) => _run(() async {
    if (demo) throw const FormatException('请退出示例模式后连接票库');
    if (githubConnected) throw const FormatException('请先退出登录');
    _checkBinding(target);
    final github = remoteFactory(target, token);
    try {
      final repo = await github.read();
      final binding = _verifiedGitHub(target, repo);
      if (hasResetProgress) {
        connection = binding;
        _github = github;
        await _rememberCredential(_credentialKey(binding), token);
        return true;
      }
      if (d1Connection != null && connection == null) {
        final primary = _d1;
        if (primary == null || pending) {
          throw const FormatException('请先连接并同步 D1 票库');
        }
        final paired = await _bindPair(
          CloudPair(github, binding, primary, d1Connection!),
          repo,
          await primary.read(),
          chooseSource,
        );
        if (paired == null) return false;
        await _activateD1(primary, paired, github, binding);
        return true;
      }
      if (linkedCloud(repo) case final link?) {
        return await _useLinkedD1(
          github,
          binding,
          repo,
          link,
          choose: choose,
          pick: pick,
        );
      }
      if (d1Connection != null) {
        throw const FormatException('两边票库的关联已解除，请重新登录 D1');
      }
      if (connection != null) {
        connection = binding;
        _github = github;
        _archiveSession++;
        await _sync(firstSnapshot: repo);
        await _rememberCredential(_credentialKey(binding), token);
        return true;
      }
      final initial = await _bindLocal(
        github,
        repo,
        choose: choose,
        pick: pick,
      );
      if (initial == null) return false;
      connection = binding;
      _github = github;
      _archiveSession++;
      _adopt(initial);
      await _persistSynced();
      await _rememberCredential(_credentialKey(binding), token);
      return true;
    } finally {
      if (!identical(_github, github)) github.close();
    }
  });

  Future<bool> connectD1(
    D1Connection target,
    String token, {
    ChooseLocalArchive? choose,
    PickConflicts? pick,
    ChooseCloudSource? chooseSource,
  }) => _run(() async {
    if (demo) throw const FormatException('请退出示例模式后连接票库');
    if (d1Connected) throw const FormatException('请先退出登录');
    final current = d1Connection;
    if (current != null && target.url != current.url) {
      throw const FormatException('请先退出登录，再更换 D1 票库');
    }
    final primary = d1Factory(current ?? target, token);
    try {
      final snapshot = await primary.read();
      final binding = primary.verifiedConnection;
      if (hasResetProgress) {
        d1Connection = binding;
        _d1 = primary;
        await _rememberCredential(_d1CredentialKey(binding), token);
        return true;
      }
      if (connection != null && current == null) {
        final github = _github;
        if (github == null || pending) {
          throw const FormatException('请先连接并同步 GitHub 票库');
        }
        final paired = await _bindPair(
          CloudPair(github, connection!, primary, binding),
          await github.read(),
          snapshot,
          chooseSource,
        );
        if (paired == null) return false;
        await _activateD1(primary, paired, github, connection);
        return true;
      }
      final link = linkedCloud(snapshot);
      if (link != null && !sameD1Target(link.d1, binding)) {
        throw const FormatException('保存的 D1 关联与此数据库身份不符');
      }
      if (current != null) {
        _d1 = primary;
        await _rememberCredential(_d1CredentialKey(binding), token);
        await _sync(firstSnapshot: snapshot);
        return true;
      }
      final initial = await _bindLocal(
        primary,
        snapshot,
        choose: choose,
        pick: pick,
      );
      if (initial == null) return false;
      final github = link != null && link.githubToken.isNotEmpty
          ? remoteFactory(link.github, link.githubToken)
          : null;
      await _activateD1(primary, initial, github, link?.github);
      return true;
    } finally {
      if (!identical(_d1, primary)) primary.close();
    }
  });

  Future<ArchiveSnapshot?> _bindPair(
    CloudPair pair,
    ArchiveSnapshot repo,
    ArchiveSnapshot snapshot,
    ChooseCloudSource? choose,
  ) async {
    pair.check(repo, snapshot);
    final source = linkedCloud(repo) != null || linkedCloud(snapshot) != null
        ? CloudSource.d1
        : await choose?.call(
            repo.records.where((row) => !row.deleted).length,
            snapshot.records.where((row) => !row.deleted).length,
          );
    return source == null ? null : pair.bind(repo, snapshot, source);
  }

  Future<bool> _useLinkedD1(
    GitHubArchive github,
    GitHubConnection binding,
    ArchiveSnapshot repo,
    LinkedCloud link, {
    ChooseLocalArchive? choose,
    PickConflicts? pick,
  }) async {
    if (!sameGitHubTarget(link.github, binding) ||
        (d1Connection != null && !sameD1Target(link.d1, d1Connection!))) {
      throw const FormatException('保存的 GitHub 关联与此仓库身份不符');
    }
    if (pending) throw const FormatException('请先备份本机待确认的修改，再连接已关联的 D1 票库');
    final primary = _d1 ?? d1Factory(link.d1, link.d1Token);
    try {
      var snapshot = await primary.read();
      final pair = CloudPair(github, binding, primary, link.d1);
      pair.check(repo, snapshot);
      if (unlinkedArchive(snapshot)) {
        throw const FormatException('D1 关联已解除，请直接登录 D1');
      }
      if (linkedCloud(snapshot) == null) {
        snapshot = await pair.bind(repo, snapshot, CloudSource.d1);
      }
      final initial = hasCloud
          ? snapshot
          : await _bindLocal(primary, snapshot, choose: choose, pick: pick);
      if (initial == null) return false;
      await _activateD1(primary, initial, github, binding);
      return true;
    } finally {
      if (!identical(_d1, primary)) primary.close();
    }
  }

  Future<void> _activateD1(
    D1Archive primary,
    ArchiveSnapshot snapshot,
    GitHubArchive? github,
    GitHubConnection? githubTarget,
  ) async {
    if (!identical(_d1, primary)) _d1?.close();
    if (!identical(_github, github)) _github?.close();
    _d1 = primary;
    d1Connection = primary.verifiedConnection;
    _github = github;
    connection = githubTarget;
    _archiveSession++;
    _adopt(snapshot);
    await _persistSynced();
    await _rememberCredential(_d1CredentialKey(d1Connection!), primary.token);
    if (github != null && githubTarget != null) {
      await _rememberCredential(_credentialKey(githubTarget), github.token);
    }
  }

  Future<ArchiveSnapshot?> _bindLocal(
    ArchiveRemote remote,
    ArchiveSnapshot snapshot, {
    ChooseLocalArchive? choose,
    PickConflicts? pick,
  }) async {
    final localCount = _records.where((row) => !row.deleted).length;
    final cloudCount = snapshot.records.where((row) => !row.deleted).length;
    final choice = localCount > 0 && cloudCount > 0
        ? await choose?.call(localCount, cloudCount)
        : BindingChoice.merge;
    if (choice == null) return null;
    final tickets = switch (choice) {
      BindingChoice.merge when _records.isEmpty => ArchiveMerge(
        snapshot.records,
        [],
      ),
      BindingChoice.merge => mergeTickets(
        [],
        await remote.canonicalRecords(_records),
        snapshot.records,
        catalog: catalog,
      ),
      BindingChoice.replaceCloud => ArchiveMerge(List.of(_records), []),
      BindingChoice.replaceLocal => ArchiveMerge(snapshot.records, []),
    };
    final shared = mergeSettings({}, settings, snapshot.settings);
    var merged = tickets.records, mergedSettings = shared.settings;
    if (tickets.conflicts.isNotEmpty || shared.conflicts.isNotEmpty) {
      final choices = await pick?.call(tickets, shared);
      if (choices == null) return null;
      merged = tickets.resolve(choices);
      mergedSettings = shared.resolve(choices);
    }
    merged = await remote.canonicalRecords(
      choice == BindingChoice.replaceLocal || _records.isEmpty
          ? merged
          : deduplicateTickets(merged, catalog),
    );
    final replace = choice == BindingChoice.replaceCloud;
    if (replace && remote is D1Archive) {
      return remote.replace(snapshot, merged, mergedSettings);
    }
    final generation = replace ? newTicketId() : snapshot.generation;
    final head = replace && remote is GitHubArchive
        ? await remote.replaceTickets(
            merged,
            snapshot,
            mergedSettings,
            generation,
          )
        : await remote.write(merged, snapshot, mergedSettings);
    return ArchiveSnapshot(
      records: merged,
      settings: mergedSettings,
      head: head,
      tree: snapshot.tree,
      generation: generation,
      repositoryId: snapshot.repositoryId,
      databaseId: snapshot.databaseId,
    );
  }

  Future<void> sync() => _run(_sync);

  Future<ArchiveSnapshot> _readBound(ArchiveRemote remote) async {
    final snapshot = await remote.read();
    if (remote is D1Archive
        ? snapshot.databaseId != d1Connection?.id
        : snapshot.repositoryId != connection?.repositoryId) {
      throw const FormatException('仓库身份已改变，已保留本机票库');
    }
    return snapshot;
  }

  void _clearReview() {
    conflicts = null;
    settingsConflicts = null;
    _reviewedRemote = null;
  }

  Future<ArchiveSnapshot> _currentSnapshot(
    ArchiveRemote remote, {
    ArchiveSnapshot? firstSnapshot,
  }) async {
    final snapshot = firstSnapshot ?? await _readBound(remote);
    if (_head.isNotEmpty && !snapshot.initialized) {
      throw const FormatException('云端票库索引已删除，已停止同步并保留本机票库');
    }
    await remote.assertDescendant(_head, snapshot.head);
    if (_head.isNotEmpty && _generation != snapshot.generation) {
      resetDetected = true;
      throw const FormatException('云端票库已重置，请先导出本机备份，再采用云端票库');
    }
    if (remote is GitHubArchive && linkedCloud(snapshot) != null) {
      throw const FormatException('此 GitHub 仓库已关联 D1，请同步后再编辑');
    }
    if (remote is D1Archive && isPaired && unlinkedArchive(snapshot)) {
      throw const FormatException('两边票库的关联已解除，请重新登录');
    }
    if (remote is D1Archive) await _discoverGitHub(snapshot);
    return snapshot;
  }

  void _syncFailure(Object failure) {
    _online = false;
    syncError = failure is FormatException
        ? failure.message
        : failure.toString();
    status = '云端票库暂时只读';
  }

  Future<void> _persistSynced() async {
    status = '已同步';
    try {
      await _persist();
    } catch (_) {
      syncError = '云端已保存，本机缓存更新失败';
    }
  }

  Future<void> _sync({ArchiveSnapshot? firstSnapshot}) async {
    final remote = _remote;
    if (remote == null) return;
    if (hasResetProgress) throw const FormatException('请先继续或放弃此前的票库重置');
    _clearReview();
    syncError = null;
    status = '正在同步';
    notifyListeners();
    try {
      final loaded = firstSnapshot ?? await _readBound(remote);
      final link = remote is GitHubArchive ? linkedCloud(loaded) : null;
      if (remote is GitHubArchive && link != null) {
        await _useLinkedD1(remote, connection!, loaded, link);
        return;
      }
      final snapshot = await _currentSnapshot(remote, firstSnapshot: loaded);
      if (!pending) {
        _adopt(snapshot);
        await _persistSynced();
        return;
      }
      final merge = mergeTickets(
        _base,
        await remote.canonicalRecords(_records),
        snapshot.records,
        catalog: catalog,
      );
      final settingMerge = mergeSettings(
        _baseSettings,
        settings,
        snapshot.settings,
      );
      if (merge.conflicts.isNotEmpty || settingMerge.conflicts.isNotEmpty) {
        conflicts = merge;
        settingsConflicts = settingMerge;
        _reviewedRemote = snapshot;
        _online = true;
        pending = true;
        status = '请选择同步冲突的处理方式';
        await _persist();
        return;
      }
      final mergedSettings = settingMerge.settings;
      final records = await remote.canonicalRecords(
        deduplicateTickets(merge.records, catalog),
      );
      final head = await remote.write(records, snapshot, mergedSettings);
      _adopt(
        snapshot,
        records: records,
        newSettings: mergedSettings,
        head: head,
      );
      await _persistSynced();
    } catch (failure) {
      _syncFailure(failure);
      rethrow;
    }
  }

  Future<void> _discoverGitHub(ArchiveSnapshot snapshot) async {
    final link = linkedCloud(snapshot);
    if (link == null) return;
    if (d1Connection == null ||
        !sameD1Target(link.d1, d1Connection!) ||
        (connection != null && !sameGitHubTarget(connection!, link.github))) {
      throw const FormatException('保存的云端关联与当前票库不符');
    }
    if (connection == null) _archiveSession++;
    connection = link.github;
    if (_github == null && link.githubToken.isNotEmpty) {
      _github = remoteFactory(link.github, link.githubToken);
      await _rememberCredential(_credentialKey(link.github), link.githubToken);
    }
  }

  Future<void> resolveConflicts(Map<String, bool> choices) => _run(() async {
    final merge = conflicts, reviewed = _reviewedRemote, remote = _remote;
    if (merge == null || reviewed == null || remote == null) return;
    final nextRecords = merge.resolve(choices);
    final nextSettings = settingsConflicts?.resolve(choices) ?? settings;
    try {
      final snapshot = await _currentSnapshot(remote);
      if (snapshot.head != reviewed.head) {
        await _sync(firstSnapshot: snapshot);
        if (conflicts != null) {
          throw const FormatException('云端票库已变化，请重新核对冲突');
        }
        return;
      }
      final records = await remote.canonicalRecords(
        deduplicateTickets(nextRecords, catalog),
      );
      final head = await remote.write(records, snapshot, nextSettings);
      _adopt(snapshot, records: records, newSettings: nextSettings, head: head);
      await _persistSynced();
    } catch (failure) {
      _syncFailure(failure);
      rethrow;
    }
  });

  Future<void> resetRepository({GitHubConnection? target, String? token}) =>
      _run(() async {
        final binding = connection;
        final selected = target ?? binding;
        if (d1Connection != null || hasResetProgress) {
          throw const FormatException('请从「重置仓库」处理当前云端票库');
        }
        if (demo || selected == null || (token == null && _github == null)) {
          throw StateError('请先授权要重置的 GitHub 私有仓库');
        }
        _checkBinding(selected);
        final remote = token == null
            ? _github!
            : remoteFactory(selected, token);
        final previousStatus = status;
        status = '正在重置 GitHub 仓库…';
        notifyListeners();
        try {
          final snapshot = await remote.resetTarget(
            fallbackSettings: binding == null ? const {} : settings,
          );
          if (linkedCloud(snapshot) != null) {
            throw const FormatException('此 GitHub 票库已绑定 D1，请连接后一起重置');
          }
          if (binding?.repositoryId != null &&
              binding!.repositoryId != snapshot.repositoryId) {
            throw const FormatException('仓库身份已改变，已停止重置');
          }
          await remote.assertDescendant(_head, snapshot.head);
          var keptSettings = snapshot.settings;
          if (binding != null) {
            final merged = mergeSettings(
              _baseSettings,
              settings,
              snapshot.settings,
            );
            if (merged.conflicts.isNotEmpty) {
              throw const FormatException('个人资料存在同步冲突，请先同步并处理后再重置');
            }
            keptSettings = merged.settings;
          }
          final empty = await remote.reset(snapshot, keptSettings);
          status = 'GitHub 仓库已重置，个人资料和飞常准设置已保留';
          if (binding != null) {
            _adopt(empty);
            await _persist();
          }
        } catch (_) {
          if (status == '正在重置 GitHub 仓库…') status = previousStatus;
          rethrow;
        } finally {
          if (token != null) remote.close();
        }
      });

  CloudPair _connectedPair() {
    if (_github == null ||
        _d1 == null ||
        connection == null ||
        d1Connection == null) {
      throw const FormatException('请先连接两边票库');
    }
    return CloudPair(_github!, connection!, _d1!, d1Connection!);
  }

  Future<void> backupToGitHub() => _run(() async {
    _requireWritable();
    await _connectedPair().backup();
    status = '已备份到 GitHub';
    syncError = null;
  });

  Future<CloudResetPreview> prepareD1Reset() => _run(() async {
    if (demo || !d1Connected || hasResetProgress) {
      throw const FormatException('请先连接 D1 并处理现有重置');
    }
    if (isPaired) return _connectedPair().resetTargets();
    final primary = await _readBound(_d1!);
    if (linkedCloud(primary) != null) {
      throw const FormatException('此 D1 票库已绑定 GitHub，请先同步以恢复关联');
    }
    return (github: null, d1: primary);
  });

  Future<void> resetD1Archive(
    CloudResetPreview confirmed, {
    CloudSource? keep,
  }) => _run(() async {
    if (demo || _d1 == null || confirmed.d1 == null || hasResetProgress) {
      throw const FormatException('D1 票库已变化，请重新确认');
    }
    if (isPaired) {
      final pair = _connectedPair(), repo = confirmed.github;
      if (repo == null) throw const FormatException('票库关联已变化，请重新确认');
      await _saveResetJournal(
        pair.prepareReset(repo, confirmed.d1!, keep: keep),
      );
      await _continuePairedReset(pair);
      return;
    }
    final primary = _d1!, snapshot = await _readBound(_d1!);
    if (snapshot.head != confirmed.d1!.head || linkedCloud(snapshot) != null) {
      throw const FormatException('D1 票库已有变化，请重新确认');
    }
    final id = newTicketId();
    ArchiveSnapshot empty;
    try {
      empty = await primary.replace(
        snapshot,
        [],
        snapshot.settings,
        resetId: id,
      );
    } catch (_) {
      final current = await _readBound(primary);
      if (current.head != id ||
          current.generation != id ||
          current.records.isNotEmpty ||
          !sameValue(current.settings, snapshot.settings)) {
        rethrow;
      }
      empty = current;
    }
    _adopt(empty);
    status = '票库已重置';
    await _persist();
  });

  Future<void> continueCloudReset() => _run(() async {
    if (demo || !hasResetProgress) throw const FormatException('没有待继续的重置');
    await _continuePairedReset(_connectedPair());
  });

  Future<void> abandonCloudReset() => _run(() async {
    await _saveResetJournal(null);
    _online = false;
    status = '重置续接已放弃，请重新同步';
  });

  Future<void> _saveResetJournal(Map<String, dynamic>? journal) async {
    final previous = _resetJournal;
    _resetJournal = journal;
    try {
      await _persist();
    } catch (_) {
      _resetJournal = previous;
      rethrow;
    }
  }

  Future<void> _continuePairedReset(CloudPair pair) async {
    final journal = _resetJournal!;
    final result = await pair.continueReset(journal, _saveResetJournal);
    final keep = journal['keep'];
    final droppedKey = switch (keep) {
      'github' => _d1CredentialKey(d1Connection!),
      'd1' => _credentialKey(connection!),
      _ => null,
    };
    if (keep == 'github') {
      _d1?.close();
      _d1 = null;
      d1Connection = null;
    } else if (keep == 'd1') {
      _github?.close();
      _github = null;
      connection = null;
    }
    _adopt(keep == 'github' ? result.github : result.d1);
    _archiveSession++;
    _resetJournal = null;
    status = '票库已重置';
    await _persist();
    if (droppedKey != null && AppleServices.available) {
      await AppleServices.deleteCredential(droppedKey);
    }
  }

  Future<void> acceptRemoteReset() => _run(() async {
    if (demo || _remote == null || !resetDetected) {
      throw StateError('没有待采用的云端重置');
    }
    final snapshot = await _readBound(_remote!);
    await _remote!.assertDescendant(_head, snapshot.head);
    if (snapshot.generation == _generation) {
      resetDetected = false;
      throw const FormatException('云端重置状态已变化，请重新同步');
    }
    if (_remote is D1Archive &&
        connection != null &&
        unlinkedArchive(snapshot)) {
      if (AppleServices.available) {
        await AppleServices.deleteCredential(_credentialKey(connection!));
      }
      _github?.close();
      _github = null;
      connection = null;
    }
    _adopt(snapshot);
    status = '已采用云端票库';
    await _persist();
  });
  void _adopt(
    ArchiveSnapshot snapshot, {
    List<TicketRecord>? records,
    Map<String, dynamic>? newSettings,
    String? head,
    String? generation,
  }) {
    _records = records ?? List.of(snapshot.records);
    _base = List.of(_records);
    settings = sharedSettings(newSettings ?? snapshot.settings);
    _baseSettings = sharedSettings(cloneJson(settings));
    _head = head ?? snapshot.head;
    final nextGeneration = generation ?? snapshot.generation;
    if (_generation != nextGeneration) _archiveSession++;
    _generation = nextGeneration;
    pending = false;
    resetDetected = false;
    _online = connected;
    syncError = null;
    _clearReview();
  }

  Future<void> clearLocalArchive({bool signOut = false}) => _run(() async {
    if (demo) throw StateError('请先退出示例模式');
    final target = connection;
    final d1 = d1Connection;
    if (AppleServices.available) {
      if (target != null) {
        await AppleServices.deleteCredential(_credentialKey(target));
      }
      if (d1 != null) {
        await AppleServices.deleteCredential(_d1CredentialKey(d1));
      }
    }
    _github?.close();
    _d1?.close();
    _github = null;
    _d1 = null;
    connection = null;
    d1Connection = null;
    _resetJournal = null;
    _archiveSession++;
    _records = [];
    _base = [];
    _baseSettings = {};
    settings = signOut
        ? sharedSettings()
        : sharedSettings({...settings}..remove('connections'));
    _head = '';
    _generation = '';
    pending = false;
    resetDetected = false;
    _online = connected;
    syncError = null;
    _clearReview();
    status = signOut ? '已退出登录，本机票库已清空' : '本机票库已清空，个人资料已保留';
    await _persist();
  });
  @override
  void dispose() {
    _github?.close();
    _d1?.close();
    super.dispose();
  }
}
