import 'dart:convert';

import 'package:crypto/crypto.dart';

import 'd1_archive.dart';
import 'github_archive.dart';
import 'shared_settings.dart';
import 'ticket_record.dart';

enum CloudSource { github, d1 }

bool sameGitHubTarget(GitHubConnection a, GitHubConnection b) =>
    a.repositoryId != null &&
    a.repositoryId == b.repositoryId &&
    a.branch == b.branch;

bool sameD1Target(D1Connection a, D1Connection b) =>
    a.id != null && a.id == b.id && a.url == b.url;

bool unlinkedArchive(ArchiveSnapshot snapshot) =>
    (snapshot.settings['connections'] as Map?)?['unlinked'] == true;

typedef LinkedCloud = ({
  GitHubConnection github,
  String githubToken,
  D1Connection d1,
  String d1Token,
});

LinkedCloud? linkedCloud(ArchiveSnapshot snapshot) {
  final settings = snapshot.settings['connections'] as Map?;
  final github = settings?['github'], d1 = settings?['d1'];
  if (github == null && d1 == null) return null;
  if (github is! Map || d1 is! Map) {
    throw const FormatException('云端关联信息不完整');
  }
  return (
    github: GitHubConnection.fromJson(Map<String, dynamic>.from(github)),
    githubToken: github['token'] as String,
    d1: D1Connection.fromJson(d1),
    d1Token: d1['token'] as String,
  );
}

class CloudPair {
  const CloudPair(this.github, this.githubTarget, this.d1, this.d1Target);
  final GitHubArchive github;
  final GitHubConnection githubTarget;
  final D1Archive d1;
  final D1Connection d1Target;

  Map<String, dynamic> _settings(Map<String, dynamic> original) =>
      sharedSettings({
        ...original,
        'connections': {
          'github': {...githubTarget.toJson(), 'token': github.token},
          'd1': {...d1Target.toJson(), 'token': d1.token},
        },
      });

  void check(ArchiveSnapshot repo, ArchiveSnapshot primary) {
    if (repo.repositoryId != githubTarget.repositoryId ||
        primary.databaseId != d1Target.id) {
      throw const FormatException('云端票库的身份已变化');
    }
    for (final snapshot in [repo, primary]) {
      final link = linkedCloud(snapshot);
      if (link != null &&
          (!sameGitHubTarget(link.github, githubTarget) ||
              !sameD1Target(link.d1, d1Target))) {
        throw const FormatException('票库已关联其他账号，请先解除原关联');
      }
    }
  }

  Future<ArchiveSnapshot> bind(
    ArchiveSnapshot repo,
    ArchiveSnapshot primary,
    CloudSource source,
  ) async {
    final (latestRepo, latestD1) = await (github.read(), d1.read()).wait;
    check(latestRepo, latestD1);
    if (latestRepo.head != repo.head || latestD1.head != primary.head) {
      throw const FormatException('云端票库已有变化，请重新核对后绑定');
    }
    if (linkedCloud(repo) != null || linkedCloud(primary) != null) {
      if (unlinkedArchive(repo) || unlinkedArchive(primary)) {
        throw const FormatException('原关联正在解除，请先完成重置操作');
      }
      await github.write(repo.records, repo, _settings(repo.settings));
      return _linkD1(primary);
    }
    if (source == CloudSource.github) {
      final preferences = sharedSettings(
        {...repo.settings}..remove('connections'),
      );
      final copied = await d1.replace(primary, repo.records, preferences);
      await github.write(repo.records, repo, _settings(preferences));
      return _linkD1(copied);
    }
    await github.replaceTickets(
      primary.records,
      repo,
      _settings(primary.settings),
      newTicketId(),
    );
    return _linkD1(primary);
  }

  Future<ArchiveSnapshot> _linkD1(ArchiveSnapshot source) async {
    final settings = _settings(source.settings);
    final head = await d1.write(source.records, source, settings);
    if (head == source.head) return source;
    return d1.read();
  }

  Future<void> backup() async {
    final primary = await d1.read();
    final repo = await github.read();
    check(repo, primary);
    if (unlinkedArchive(repo) ||
        unlinkedArchive(primary) ||
        (linkedCloud(repo) == null && linkedCloud(primary) == null)) {
      throw const FormatException('两边票库的关联已解除，请重新登录');
    }
    await github.write(primary.records, repo, _settings(primary.settings));
  }

  Future<({ArchiveSnapshot github, ArchiveSnapshot d1})> resetTargets() async {
    final (repo, primary) = await (github.resetTarget(), d1.read()).wait;
    check(repo, primary);
    return (github: repo, d1: primary);
  }

  Map<String, dynamic> prepareReset(
    ArchiveSnapshot repo,
    ArchiveSnapshot primary, {
    CloudSource? keep,
  }) {
    check(repo, primary);
    if (unlinkedArchive(primary)) throw const FormatException('票库关联已解除，请重新登录');
    if (unlinkedArchive(repo) && keep == null) {
      throw const FormatException('GitHub 已解除关联，请选择重置后继续使用的票库');
    }
    return {
      'id': newTicketId(),
      'github': githubTarget.toJson(),
      'd1': d1Target.toJson(),
      'beforeGitHub': repo.head,
      'beforeD1': primary.head,
      'githubSettings': _digest(_resetSettings(repo, keep)),
      'd1Settings': _digest(_resetSettings(primary, keep)),
      if (keep != null) 'keep': keep.name,
    };
  }

  bool matchesReset(Map journal) =>
      sameGitHubTarget(
        githubTarget,
        GitHubConnection.fromJson(
          Map<String, dynamic>.from(journal['github'] as Map),
        ),
      ) &&
      sameD1Target(d1Target, D1Connection.fromJson(journal['d1'] as Map));

  Future<({ArchiveSnapshot github, ArchiveSnapshot d1})> continueReset(
    Map<String, dynamic> journal,
    Future<void> Function(Map<String, dynamic>) save,
  ) async {
    if (!matchesReset(journal)) throw const FormatException('无法核对原来的两个票库');
    final targets = await resetTargets();
    var repo = targets.github, primary = targets.d1;
    final id = journal['id'] as String;
    final keep = journal['keep'] == null
        ? null
        : CloudSource.values.byName(journal['keep'] as String);
    bool completedGitHub() =>
        repo.generation == id &&
        repo.recordCount == 0 &&
        repo.paths.length == 1 &&
        repo.paths.single == 'archive/index.json' &&
        _digest(repo.settings) == journal['githubSettings'];
    bool completedD1() =>
        primary.head == id &&
        primary.generation == id &&
        primary.records.isEmpty &&
        _digest(primary.settings) == journal['d1Settings'];
    const changedGitHub = FormatException('GitHub 仓库已有变化，请放弃续接后重新核对');
    const changedD1 = FormatException('D1 票库已有变化，请放弃续接后重新核对');
    final expectedGitHub = journal['githubHead'];
    if (expectedGitHub != null &&
        (repo.head != expectedGitHub || !completedGitHub())) {
      throw changedGitHub;
    }
    if (expectedGitHub == null) {
      if (primary.head != journal['beforeD1']) throw changedD1;
      if (!completedGitHub()) {
        if (repo.head != journal['beforeGitHub']) throw changedGitHub;
        repo = await github.reset(
          repo,
          _resetSettings(repo, keep),
          resetId: id,
        );
      }
      await save({...journal, 'githubHead': repo.head});
      journal = {...journal, 'githubHead': repo.head};
      primary = await d1.read();
    }
    if (!completedD1()) {
      if (primary.head != journal['beforeD1'] || journal['d1Head'] != null)
        throw changedD1;
      if (await github.head() != repo.head) throw changedGitHub;
      primary = await d1.replace(
        primary,
        [],
        _resetSettings(primary, keep),
        resetId: id,
      );
    }
    await save({...journal, 'd1Head': primary.head});
    return (github: repo, d1: primary);
  }
}

Map<String, dynamic> _resetSettings(
  ArchiveSnapshot snapshot,
  CloudSource? keep,
) => keep == null
    ? snapshot.settings
    : sharedSettings({
        ...snapshot.settings,
        'connections': {'unlinked': true},
      });

String _digest(Map<String, dynamic> settings) => sha256
    .convert(utf8.encode(canonicalJson(sharedSettings(settings))))
    .toString();
