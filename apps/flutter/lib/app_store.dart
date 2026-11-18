import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji_core/xingji_core.dart';

import 'ticket_face.dart';

enum SaveOutcome { local, synced }

enum BindingChoice { merge, replaceCloud, replaceLocal }

typedef PickConflicts = Future<Map<String, bool>?> Function(
  ArchiveMerge tickets,
  SettingsMerge settings,
);

/// Demo data never enters the private archive or the persistence envelope.
class AppStore extends ChangeNotifier {
  final SharedPreferences preferences;
  final ReferenceCatalog catalog;
  final List<TicketRecord> examples;
  final Map<String, dynamic> mapData;
  final GitHubArchive Function(GitHubConnection, String) remoteFactory;
  List<TicketRecord> _records = [], _base = [];
  ArchiveSnapshot? _reviewedRemote;
  Map<String, dynamic> settings = {}, _baseSettings = {};
  GitHubConnection? connection;
  GitHubArchive? _remote;
  ArchiveMerge? conflicts;
  SettingsMerge? settingsConflicts;
  bool resetDetected = false;
  String _head = '', _generation = '';
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
  }) : remoteFactory =
           remoteFactory ?? ((target, token) => GitHubArchive(target, token));
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
      store.pending = store.connection != null && envelope['pending'] == true;
      if (store.connection != null) {
        store.status = 'GitHub 待重新授权 · 只读';
      }
    }
    return store;
  }

  bool get connected => _remote != null;
  String? get readOnlyReason {
    if (connection == null) return null;
    if (!connected) return '请重新授权 GitHub 后编辑';
    if (resetDetected) return '请先处理云端票库重置';
    if (conflicts != null) return '请先处理同步冲突';
    if (!_online) return 'GitHub 连接不可用，票库暂时只读';
    if (pending) return '请先完成之前的同步';
    return null;
  }

  bool get canWrite => !demo && !busy && readOnlyReason == null;

  List<TicketRecord> get records =>
      (demo ? examples : _records).where((record) => !record.deleted).toList();
  List<TicketRecord> get privateRecords => List.unmodifiable(_records);
  Future<void> _persist() async {
    final saved = await preferences.setString(
      storageKey,
      jsonEncode({
        'local': TicketArchive(_records).toJson(),
        'base': TicketArchive(_base).toJson(),
        'settings': settings,
        'baseSettings': _baseSettings,
        'head': _head,
        'generation': _generation,
        'pending': pending,
        'connection': connection?.toJson(),
      }),
    );
    if (!saved) throw StateError('本机存储失败，请先导出备份');
  }

  void setDemo(bool value) {
    demo = value;
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
    if (connection == null) return;
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
    if (remote == null) {
      final oldRecords = _records, oldSettings = settings;
      _records = deduplicateTickets(next, catalog);
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
    final previous = baseRecords ?? _records;
    final previousSettings = baseSettings ?? settings;
    for (var attempt = 0; ; attempt++) {
      late final ArchiveSnapshot snapshot;
      try {
        snapshot = await _currentSnapshot(remote);
      } catch (failure) {
        _syncFailure(failure);
        rethrow;
      }
      final tickets = mergeTickets(previous, next, snapshot.records);
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
      merged = deduplicateTickets(merged, catalog);
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

  Future<void> importArchive(TicketArchive archive, {PickConflicts? pick}) =>
      _run(() async {
        await _saveChanges(
          records: deduplicateTickets([
            ..._records,
            ...archive.records,
          ], catalog),
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

  Future<bool> connect(
    GitHubConnection target,
    String token, {
    Future<BindingChoice?> Function(int localCount, int cloudCount)? choose,
    PickConflicts? pick,
  }) => _run(() async {
    if (demo) throw StateError('请退出示例模式后连接票库');
    _checkBinding(target);
    final current = connection;
    final remote = remoteFactory(target, token);
    try {
      final snapshot = await remote.read();
      if (current?.repositoryId != null &&
          current!.repositoryId != snapshot.repositoryId) {
        throw const FormatException('仓库身份已改变，已保留本机票库');
      }
      final binding = GitHubConnection(
        target.owner,
        target.repository,
        branch: target.branch,
        repositoryId: snapshot.repositoryId,
      );
      if (current != null) {
        _remote?.close();
        _remote = remote;
        connection = binding;
        await _sync(firstSnapshot: snapshot);
        return true;
      }

      final localCount = _records.where((row) => !row.deleted).length;
      final cloudCount = snapshot.records.where((row) => !row.deleted).length;
      final choice = localCount > 0 && cloudCount > 0
          ? await choose?.call(localCount, cloudCount)
          : BindingChoice.merge;
      if (choice == null) return false;
      final tickets = switch (choice) {
        BindingChoice.merge => mergeTickets([], _records, snapshot.records),
        BindingChoice.replaceCloud => ArchiveMerge(List.of(_records), []),
        BindingChoice.replaceLocal => ArchiveMerge(snapshot.records, []),
      };
      final shared = mergeSettings({}, settings, snapshot.settings);
      var merged = tickets.records, mergedSettings = shared.settings;
      if (tickets.conflicts.isNotEmpty || shared.conflicts.isNotEmpty) {
        final choices = await pick?.call(tickets, shared);
        if (choices == null) return false;
        merged = tickets.resolve(choices);
        mergedSettings = shared.resolve(choices);
      }
      merged = deduplicateTickets(merged, catalog);
      final replace = choice == BindingChoice.replaceCloud;
      final generation = replace ? newTicketId() : snapshot.generation;
      final head = replace
          ? await remote.replaceTickets(
              merged,
              snapshot,
              mergedSettings,
              generation,
            )
          : await remote.write(merged, snapshot, mergedSettings);
      _remote = remote;
      connection = binding;
      _adopt(
        snapshot,
        records: merged,
        newSettings: mergedSettings,
        head: head,
        generation: generation,
      );
      await _persistSynced();
      return true;
    } finally {
      if (!identical(_remote, remote)) remote.close();
    }
  });

  Future<void> sync() => _run(_sync);

  Future<ArchiveSnapshot> _readBound(GitHubArchive remote) async {
    final snapshot = await remote.read();
    if (snapshot.repositoryId != connection?.repositoryId) {
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
    GitHubArchive remote, {
    ArchiveSnapshot? firstSnapshot,
  }) async {
    final snapshot = firstSnapshot ?? await _readBound(remote);
    await remote.assertDescendant(_head, snapshot.head);
    if (_head.isNotEmpty && _generation != snapshot.generation) {
      resetDetected = true;
      throw const FormatException('云端票库已重置，请先导出本机备份，再采用云端票库');
    }
    return snapshot;
  }

  void _syncFailure(Object failure) {
    _online = false;
    syncError = failure is FormatException
        ? failure.message
        : failure.toString();
    status = 'GitHub 票库暂时只读';
  }

  Future<void> _persistSynced() async {
    status = '已同步';
    try {
      await _persist();
    } catch (_) {
      syncError = 'GitHub 已保存，本机缓存更新失败';
    }
  }

  Future<void> _sync({ArchiveSnapshot? firstSnapshot}) async {
    final remote = _remote;
    if (remote == null) return;
    _clearReview();
    syncError = null;
    status = '正在同步';
    notifyListeners();
    try {
      final snapshot = await _currentSnapshot(
        remote,
        firstSnapshot: firstSnapshot,
      );
      if (!pending) {
        _adopt(snapshot);
        await _persistSynced();
        return;
      }
      final merge = mergeTickets(_base, _records, snapshot.records);
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
      final records = deduplicateTickets(merge.records, catalog);
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
      final records = deduplicateTickets(nextRecords, catalog);
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
        if (demo || selected == null || (token == null && _remote == null)) {
          throw StateError('请先授权要重置的 GitHub 私有仓库');
        }
        _checkBinding(selected);
        final remote = token == null
            ? _remote!
            : remoteFactory(selected, token);
        final previousStatus = status;
        status = '正在重置 GitHub 仓库…';
        notifyListeners();
        try {
          final snapshot = await remote.resetTarget(
            fallbackSettings: binding == null ? const {} : settings,
          );
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
    _records = records ?? deduplicateTickets(snapshot.records, catalog);
    _base = List.of(_records);
    settings = sharedSettings(newSettings ?? snapshot.settings);
    _baseSettings = sharedSettings(cloneJson(settings));
    _head = head ?? snapshot.head;
    _generation = generation ?? snapshot.generation;
    pending = false;
    resetDetected = false;
    _online = connected;
    syncError = null;
    _clearReview();
  }

  Future<void> clearLocalArchive() => _run(() async {
    if (demo) throw StateError('请先退出示例模式');
    _remote?.close();
    _remote = null;
    connection = null;
    _records = [];
    _base = [];
    _baseSettings = {};
    _head = '';
    _generation = '';
    pending = false;
    resetDetected = false;
    _online = connected;
    syncError = null;
    _clearReview();
    status = '本机票库已清空，个人资料已保留';
    await _persist();
  });
  @override
  void dispose() {
    _remote?.close();
    super.dispose();
  }
}
