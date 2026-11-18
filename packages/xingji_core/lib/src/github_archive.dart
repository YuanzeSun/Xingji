import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'ticket_record.dart';
import 'shared_settings.dart';

class GitHubConnection {
  final String owner, repository, branch;
  final int? repositoryId;
  const GitHubConnection(
    this.owner,
    this.repository, {
    this.branch = 'main',
    this.repositoryId,
  });
  factory GitHubConnection.fromJson(Map<String, dynamic> data) =>
      GitHubConnection(
        data['owner'] as String,
        data['repo'] as String,
        branch: data['branch'] as String? ?? 'main',
        repositoryId: data['id'] as int?,
      );
  Map<String, dynamic> toJson() => {
    'owner': owner,
    'repo': repository,
    'branch': branch,
    if (repositoryId != null) 'id': repositoryId,
  };
  String get label => '$owner/$repository';
}

class ArchiveApiException implements Exception {
  final String message;
  final int status;
  ArchiveApiException(this.message, this.status);
  @override
  String toString() => message;
}

class ArchiveSnapshot {
  final List<TicketRecord> records;
  final Map<String, dynamic> settings;
  final String head, tree, generation;
  final Map<String, String> contents;
  final bool initialized;
  final int repositoryId;
  ArchiveSnapshot({
    required this.records,
    required this.settings,
    required this.head,
    required this.tree,
    required this.repositoryId,
    this.generation = '',
    this.contents = const {},
    this.initialized = true,
  });
}

class GitHubArchive {
  final GitHubConnection connection;
  final String token;
  final http.Client client;
  GitHubArchive(this.connection, this.token, {http.Client? client})
    : client = client ?? http.Client();
  Future<dynamic> _request(
    String path, {
    String method = 'GET',
    Map<String, dynamic>? body,
  }) async {
    if (![
      connection.owner,
      connection.repository,
    ].every((value) => RegExp(r'^[A-Za-z0-9_.-]+$').hasMatch(value))) {
      throw const FormatException('仓库名称格式无效');
    }
    final request = http.Request(
      method,
      Uri.parse(
        'https://api.github.com/repos/${connection.owner}/${connection.repository}$path',
      ),
    );
    request.headers.addAll({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer $token',
      'X-GitHub-Api-Version': '2022-11-28',
      'Cache-Control': 'no-store',
    });
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.body = jsonEncode(body);
    }
    final response = await http.Response.fromStream(
      await client.send(request).timeout(const Duration(seconds: 30)),
    );
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = switch (response.statusCode) {
        401 => 'GitHub 凭证无效或已过期',
        403 => '权限不足或请求额度已用尽',
        404 => '找不到仓库、分支或票库文件',
        409 || 422 => '云端票库已变化，请重新同步',
        _ => 'GitHub 请求失败（${response.statusCode}）',
      };
      throw ArchiveApiException(message, response.statusCode);
    }
    return response.bodyBytes.isEmpty
        ? null
        : jsonDecode(utf8.decode(response.bodyBytes));
  }

  Future<Map<String, dynamic>> verify() async {
    final repository = Map<String, dynamic>.from(await _request(''));
    if (repository['private'] != true) {
      throw const FormatException('请连接私人票库，避免将个人行程保存到公开仓库');
    }
    if (repository['permissions']?['push'] != true) {
      throw const FormatException('此凭证没有仓库写入权限');
    }
    if (repository['id'] is! int ||
        connection.repositoryId != null &&
            repository['id'] != connection.repositoryId) {
      throw const FormatException('仓库身份已改变，已停止同步');
    }
    return repository;
  }

  Future<String> head() async =>
      (await _request(
            '/git/ref/heads/${Uri.encodeComponent(connection.branch)}',
          ))['object']['sha']
          as String;
  Future<String> _blob(String sha) async {
    final blob = await _request('/git/blobs/$sha');
    if (blob['encoding'] != 'base64' || blob['content'] is! String) {
      throw const FormatException('云端文件内容不完整');
    }
    return utf8.decode(
      base64Decode((blob['content'] as String).replaceAll(RegExp(r'\s'), '')),
    );
  }

  Future<ArchiveSnapshot> read() async {
    final repository = await verify(), current = await head();
    final commit = await _request('/git/commits/$current');
    final tree = await _request(
      '/git/trees/${commit['tree']['sha']}?recursive=1',
    );
    if (tree['truncated'] == true) {
      throw const FormatException('仓库目录过大，请使用独立的私人票库');
    }
    final entries = (tree['tree'] as List).cast<Map<String, dynamic>>();
    final paths = entries
        .where(
          (row) =>
              row['type'] == 'blob' &&
              RegExp(r'^archive/(\d{4}|unknown)\.json$').hasMatch(row['path']),
        )
        .toList();
    final index = entries.where(
      (row) => row['type'] == 'blob' && row['path'] == 'archive/index.json',
    );
    if (index.isEmpty) {
      if (paths.isNotEmpty) {
        throw const FormatException('云端票库索引已删除，请先检查仓库，原有本机数据已保留');
      }
      return ArchiveSnapshot(
        records: [],
        settings: {'flightMcpKey': ''},
        head: current,
        tree: commit['tree']['sha'],
        repositoryId: repository['id'],
        initialized: false,
      );
    }
    final manifest = jsonDecode(await _blob(index.single['sha']));
    if (manifest['format'] != 'xingji-index' ||
        manifest['schemaVersion'] != 1 ||
        manifest['files'] is! Map ||
        manifest['recordCount'] is! int) {
      throw const FormatException('云端票库索引无效');
    }
    final files = Map<String, dynamic>.from(manifest['files']);
    if (files.length != paths.length ||
        paths.any((row) => !files.containsKey(row['path']))) {
      throw const FormatException('云端票库文件缺失，已停止同步并保留本机内容');
    }
    final contents = <String, String>{}, records = <TicketRecord>[];
    for (var offset = 0; offset < paths.length; offset += 4) {
      final batch = paths.skip(offset).take(4);
      final decoded = await Future.wait(
        batch.map((entry) async {
          final text = await _blob(entry['sha']);
          if (sha256.convert(utf8.encode(text)).toString() !=
              files[entry['path']]) {
            throw const FormatException('云端票库校验失败，原有数据未改变');
          }
          contents[entry['path']] = text;
          final rows = TicketArchive.fromJson(jsonDecode(text)).records;
          for (final record in rows) {
            if ((record.departure?.year?.toString() ?? 'unknown') !=
                (entry['path'] as String)
                    .substring(8)
                    .replaceFirst('.json', '')) {
              throw const FormatException('票据年份与文件不一致');
            }
          }
          return rows;
        }),
      );
      records.addAll(decoded.expand((rows) => rows));
    }
    if (records.length != manifest['recordCount'] ||
        records.map((record) => record.id).toSet().length != records.length) {
      throw const FormatException('云端票库数量或 ID 不一致');
    }
    return ArchiveSnapshot(
      records: records,
      settings: sharedSettings(manifest['settings'] ?? {}),
      head: current,
      tree: commit['tree']['sha'],
      generation: manifest['generation'] as String? ?? '',
      contents: contents,
      repositoryId: repository['id'],
    );
  }

  Future<String> write(
    List<TicketRecord> records,
    ArchiveSnapshot snapshot,
    Map<String, dynamic> settings,
  ) async {
    settings = sharedSettings(settings);
    final verified = await verify();
    if (verified['id'] != snapshot.repositoryId) {
      throw const FormatException('仓库身份已改变，已停止写入');
    }
    final groups = <String, List<TicketRecord>>{};
    for (final record in records) {
      groups
          .putIfAbsent(
            record.departure?.year?.toString() ?? 'unknown',
            () => [],
          )
          .add(record);
    }
    final previous = <String, List<TicketRecord>>{};
    for (final record in snapshot.records) {
      previous
          .putIfAbsent(
            record.departure?.year?.toString() ?? 'unknown',
            () => [],
          )
          .add(record);
    }
    final files = <String, String>{}, changes = <Map<String, dynamic>>[];
    for (final year in groups.keys.toList()..sort()) {
      final rows = groups[year]!..sort((a, b) => a.id.compareTo(b.id));
      previous[year]?.sort((a, b) => a.id.compareTo(b.id));
      final path = 'archive/$year.json';
      final unchanged = sameValue(
        rows.map((record) => record.toJson()).toList(),
        previous[year]?.map((record) => record.toJson()).toList(),
      );
      final content = unchanged && snapshot.contents.containsKey(path)
          ? snapshot.contents[path]!
          : const JsonEncoder.withIndent('  ')
                .convert(TicketArchive(rows).toJson());
      files[path] = sha256.convert(utf8.encode(content)).toString();
      if (content != snapshot.contents[path]) {
        changes.add({
          'path': path,
          'mode': '100644',
          'type': 'blob',
          'content': content,
        });
      }
    }
    final settingsChanged = !sameValue(settings, snapshot.settings);
    if (changes.isEmpty &&
        files.length == snapshot.contents.length &&
        !settingsChanged &&
        snapshot.initialized) {
      return snapshot.head;
    }
    changes.add({
      'path': 'archive/index.json',
      'mode': '100644',
      'type': 'blob',
      'content': const JsonEncoder.withIndent('  ').convert({
        'format': 'xingji-index',
        'schemaVersion': 1,
        'recordCount': records.length,
        'generation': snapshot.generation,
        'files': files,
        'settings': settings,
      }),
    });
    for (final path in snapshot.contents.keys) {
      if (!files.containsKey(path)) {
        changes.add({
          'path': path,
          'mode': '100644',
          'type': 'blob',
          'sha': null,
        });
      }
    }
    final tree = await _request(
      '/git/trees',
      method: 'POST',
      body: {'base_tree': snapshot.tree, 'tree': changes},
    );
    final commit = await _request(
      '/git/commits',
      method: 'POST',
      body: {
        'message': 'Sync private ticket metadata',
        'tree': tree['sha'],
        'parents': [snapshot.head],
      },
    );
    await _request(
      '/git/refs/heads/${Uri.encodeComponent(connection.branch)}',
      method: 'PATCH',
      body: {'sha': commit['sha'], 'force': false},
    );
    return commit['sha'] as String;
  }

  Future<void> assertDescendant(String previous, String current) async {
    if (previous.isEmpty || previous == current) return;
    final compared = await _request(
      '/compare/${Uri.encodeComponent(previous)}...${Uri.encodeComponent(current)}',
    );
    if (!['ahead', 'identical'].contains(compared['status'])) {
      throw const FormatException('云端历史被重置或分叉，已保留本机内容并停止写入');
    }
  }

  /// Replace the current tree atomically, preserving commit history and settings.
  Future<ArchiveSnapshot> reset(
    ArchiveSnapshot snapshot,
    Map<String, dynamic> settings,
  ) async {
    final verified = await verify();
    if (verified['id'] != snapshot.repositoryId) {
      throw const FormatException('仓库身份已改变，已停止重置');
    }
    final preserved = sharedSettings(settings), generation = newTicketId();
    final tree = await _request(
      '/git/trees',
      method: 'POST',
      body: {
        'tree': [
          {
            'path': 'archive/index.json',
            'mode': '100644',
            'type': 'blob',
            'content': const JsonEncoder.withIndent('  ').convert({
              'format': 'xingji-index',
              'schemaVersion': 1,
              'recordCount': 0,
              'generation': generation,
              'files': <String, String>{},
              'settings': preserved,
            }),
          },
        ],
      },
    );
    final commit = await _request(
      '/git/commits',
      method: 'POST',
      body: {
        'message': 'Reset private ticket archive, preserving personal settings',
        'tree': tree['sha'],
        'parents': [snapshot.head],
      },
    );
    await _request(
      '/git/refs/heads/${Uri.encodeComponent(connection.branch)}',
      method: 'PATCH',
      body: {'sha': commit['sha'], 'force': false},
    );
    return ArchiveSnapshot(
      records: [],
      settings: preserved,
      head: commit['sha'],
      tree: tree['sha'],
      generation: generation,
      repositoryId: snapshot.repositoryId,
    );
  }

  void close() => client.close();
}
