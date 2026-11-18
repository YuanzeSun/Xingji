import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji_core/xingji_core.dart';

import 'ticket_face.dart';

/// Demo data never enters the private archive or the persistence envelope.
class AppStore extends ChangeNotifier {
  final SharedPreferences preferences;
  final ReferenceCatalog catalog;
  final List<TicketRecord> examples;
  final Map<String, dynamic> mapData;
  final GitHubArchive Function(GitHubConnection, String) remoteFactory;
  List<TicketRecord> _records = [], _base = [];
  List<TicketRecord> _reviewedRemote = [];
  Map<String, dynamic> settings = {}, _baseSettings = {};
  GitHubConnection? connection;
  GitHubArchive? _remote;
  ArchiveMerge? conflicts;
  SettingsMerge? settingsConflicts;
  bool resetDetected = false;
  String _head = '', _generation = '';
  bool demo = false, busy = false, pending = false;
  String status = '本机票库';
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
      store.pending = envelope['pending'];
      if (envelope['connection'] != null) {
        store.connection = GitHubConnection.fromJson(envelope['connection']);
      }
      store.status = store.pending ? '本机有待同步的修改' : '本机票库';
    }
    return store;
  }

  bool get connected => _remote != null;
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

  Future<void> _run(Future<void> Function() action) async {
    if (busy) throw StateError('正在保存，请稍候');
    busy = true;
    notifyListeners();
    try {
      await action();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> _saveLocal(List<TicketRecord> records) async {
    final previous = _records,
        previousPending = pending,
        previousStatus = status;
    _records = deduplicateTickets(records, catalog);
    pending = true;
    status = '正在保存到本机';
    try {
      await _persist();
    } catch (_) {
      _records = previous;
      pending = previousPending;
      status = previousStatus;
      rethrow;
    }
    if (connected) {
      await _sync();
    } else {
      status = '已保存在本机';
    }
  }

  Future<void> save(TicketRecord record) => _run(() async {
    if (demo) throw StateError('请退出示例模式后录入票据');
    if (record.missingFields.isNotEmpty) throw const FormatException('请补全必填项');
    final next = catalog.normalize(record.withChanges({'updatedAt': utcNow()}));
    await _saveLocal([..._records.where((row) => row.id != next.id), next]);
  });
  Future<void> delete(TicketRecord record) => _run(() async {
    if (demo) throw StateError('示例票据不能删除');
    await _saveLocal(
      _records
          .map(
            (row) => row.id == record.id
                ? row.withChanges({'deleted': true, 'updatedAt': utcNow()})
                : row,
          )
          .toList(),
    );
  });
  Future<void> deleteMany(Set<String> ids) => _run(() async {
    if (demo) throw StateError('示例票据不能删除');
    await _saveLocal(
      _records
          .map(
            (row) => ids.contains(row.id)
                ? row.withChanges({'deleted': true, 'updatedAt': utcNow()})
                : row,
          )
          .toList(),
    );
  });
  Future<void> saveProfile(Map<String, dynamic> profile) => _run(() async {
    if (demo) throw StateError('请退出示例模式后保存资料');
    final previous = settings, wasPending = pending;
    settings = sharedSettings({
      ...settings,
      'profile': personalProfile(profile),
    });
    pending = true;
    try {
      await _persist();
    } catch (_) {
      settings = previous;
      pending = wasPending;
      rethrow;
    }
    if (connected) {
      await _sync();
    } else {
      status = '个人资料已保存在本机';
    }
  });
  Future<void> importArchive(TicketArchive archive) => _run(() async {
    if (demo) throw StateError('请退出示例模式后导入');
    await _saveLocal([..._records, ...archive.records]);
  });
  Future<void> connect(GitHubConnection target, String token) => _run(() async {
    if (demo) throw StateError('请退出示例模式后连接票库');
    if (connection != null &&
        connection!.label != target.label &&
        _records.isNotEmpty) {
      throw const FormatException('请先导出并清空本机票库，再切换仓库');
    }
    final remote = remoteFactory(target, token);
    final verified = await remote.verify();
    if (connection?.repositoryId != null &&
        connection!.repositoryId != verified['id']) {
      remote.close();
      throw const FormatException('仓库身份已改变，已保留本机票库');
    }
    _remote?.close();
    _remote = remote;
    connection = GitHubConnection(
      target.owner,
      target.repository,
      branch: target.branch,
      repositoryId: verified['id'],
    );
    await _sync();
  });
  Future<void> sync() => _run(_sync);
  Future<void> _sync() async {
    final remote = _remote;
    if (remote == null) return;
    status = '正在同步';
    notifyListeners();
    try {
      final snapshot = await remote.read();
      await remote.assertDescendant(_head, snapshot.head);
      if (_head.isNotEmpty && _generation != snapshot.generation) {
        resetDetected = true;
        throw const FormatException('云端票库已重置，请先导出本机备份，再重新连接');
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
        _reviewedRemote = List.of(snapshot.records);
        status = '请选择同步冲突的处理方式';
        return;
      }
      final mergedSettings = settingMerge.settings;
      final head = await remote.write(merge.records, snapshot, mergedSettings);
      _records = deduplicateTickets(merge.records, catalog);
      _base = List.of(_records);
      settings = mergedSettings;
      _baseSettings = sharedSettings(cloneJson(settings));
      _head = head;
      _generation = snapshot.generation;
      conflicts = null;
      _reviewedRemote = [];
      settingsConflicts = null;
      resetDetected = false;
      pending = false;
      status = '已同步';
      await _persist();
    } catch (_) {
      status = pending ? '已存本机，等待同步' : '同步未完成';
      rethrow;
    }
  }

  Future<void> resolveConflicts(Map<String, bool> choices) => _run(() async {
    final merge = conflicts;
    if (merge == null) return;
    final nextRecords = merge.resolve(choices);
    final nextSettings = settingsConflicts?.resolve(choices) ?? settings;
    _records = nextRecords;
    _base = List.of(_reviewedRemote);
    settings = nextSettings;
    if (settingsConflicts != null) {
      _baseSettings = sharedSettings(cloneJson(settingsConflicts!.remote));
    }
    conflicts = null;
    _reviewedRemote = [];
    settingsConflicts = null;
    _reviewedRemote = [];
    pending = true;
    await _persist();
    await _sync();
  });

  Future<void> resetRepository() => _run(() async {
    if (demo || _remote == null) throw StateError('请先连接私人票库');
    status = '正在重置仓库…';
    notifyListeners();
    final snapshot = await _remote!.read();
    await _remote!.assertDescendant(_head, snapshot.head);
    final merge = mergeSettings(_baseSettings, settings, snapshot.settings);
    if (merge.conflicts.isNotEmpty) {
      throw const FormatException('个人资料存在同步冲突，请先同步并处理后再重置');
    }
    final empty = await _remote!.reset(snapshot, merge.settings);
    _adopt(empty);
    status = '仓库已重置，个人资料和飞常准设置已保留';
    await _persist();
  });
  Future<void> acceptRemoteReset() => _run(() async {
    if (_remote == null || !resetDetected) throw StateError('没有待采用的云端重置');
    _adopt(await _remote!.read());
    status = '已采用云端票库';
    await _persist();
  });
  void _adopt(ArchiveSnapshot snapshot) {
    _records = deduplicateTickets(snapshot.records, catalog);
    _base = List.of(_records);
    settings = sharedSettings(snapshot.settings);
    _baseSettings = sharedSettings(cloneJson(settings));
    _head = snapshot.head;
    _generation = snapshot.generation;
    pending = false;
    resetDetected = false;
    conflicts = null;
    _reviewedRemote = [];
    settingsConflicts = null;
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
    conflicts = null;
    _reviewedRemote = [];
    settingsConflicts = null;
    status = '本机票库已清空，个人资料已保留';
    await _persist();
  });
  @override
  void dispose() {
    _remote?.close();
    super.dispose();
  }
}
