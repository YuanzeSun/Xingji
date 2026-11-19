import 'dart:convert';

import 'package:http/http.dart' as http;

import 'github_archive.dart';
import 'record_fields.dart';
import 'shared_settings.dart';
import 'ticket_record.dart';

class D1Connection {
  D1Connection(String url, {this.id}) : url = d1WorkerOrigin(url) {
    if (id != null && !RegExp(r'^[0-9a-f]{32}$').hasMatch(id!)) {
      throw const FormatException('D1 数据库身份无效');
    }
  }

  factory D1Connection.fromJson(Map data) =>
      D1Connection(data['url'] as String, id: data['id'] as String?);

  final String url;
  final String? id;
  Map<String, dynamic> toJson() => {'url': url, if (id != null) 'id': id};
}

class D1Archive implements ArchiveRemote {
  D1Archive(
    this.connection,
    this.token, {
    http.Client? client,
    this.normalizeRecords,
  }) : client = client ?? http.Client(),
       _verifiedId = connection.id {
    if (token.isEmpty || RegExp(r'\s').hasMatch(token) || token.length > 1017) {
      throw const FormatException('请填写 Worker 的访问凭证');
    }
  }

  final D1Connection connection;
  final String token;
  final http.Client client;
  final NormalizeArchiveRecords? normalizeRecords;
  String? _verifiedId;
  ArchiveSnapshot? _cached;

  D1Connection get verifiedConnection =>
      D1Connection(connection.url, id: _verifiedId);

  Future<Map<String, dynamic>?> _request({
    Map<String, dynamic>? body,
    ArchiveSnapshot? cached,
  }) async {
    final request = http.Request(
      body == null ? 'GET' : 'POST',
      Uri.parse('${connection.url}/v1/archive'),
    )..followRedirects = false;
    request.headers['Authorization'] = 'Bearer $token';
    if (cached != null) {
      request.headers['If-None-Match'] =
          '"${cached.databaseId}:${cached.head}"';
    }
    if (body != null) {
      request.headers['Content-Type'] = 'application/json';
      request.bodyBytes = utf8.encode(jsonEncode(body));
    }
    final response = await client
        .send(request)
        .then(http.Response.fromStream)
        .timeout(const Duration(seconds: 30));
    if (response.statusCode == 304 && cached != null) return null;
    final Map<String, dynamic>? result;
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      result = decoded is Map<String, dynamic> ? decoded : null;
    } on FormatException {
      if (response.statusCode >= 200 && response.statusCode < 300) rethrow;
      throw ArchiveApiException(
        'D1 请求失败（${response.statusCode}）',
        response.statusCode,
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = switch (response.statusCode) {
        400 => 'D1 拒绝了票库更新，请核对票据和设置',
        401 => 'D1 访问凭证无效，请退出后重新连接',
        409 => '另一台设备刚更新了 D1 票库，请重新核对',
        413 => 'D1 票据或设置超过大小限制',
        429 => 'D1 请求额度已用尽，请稍后再试',
        503 => switch (result?['code']) {
          'D1_BINDING_MISSING' => 'Worker 缺少名为 ARCHIVE 的 D1 数据库绑定',
          'D1_SCHEMA_MISSING' => 'D1 尚未初始化，请执行行迹的初始化 SQL',
          'D1_DATABASE_NOT_FOUND' => 'Worker 绑定的 D1 数据库不存在',
          _ => 'D1 暂时不可用，请检查 Worker 日志',
        },
        _ => 'D1 请求失败（${response.statusCode}）',
      };
      throw ArchiveApiException(message, response.statusCode);
    }
    final id = result?['id'], head = result?['head'];
    if (id is! String ||
        !RegExp(r'^[0-9a-f]{32}$').hasMatch(id) ||
        head is! String ||
        head.isEmpty ||
        result == null) {
      throw const FormatException('Worker 票库接口返回无效');
    }
    if (_verifiedId != null && id != _verifiedId) {
      throw const FormatException('D1 数据库身份已变化，已保留本机缓存');
    }
    _verifiedId = id;
    return result;
  }

  @override
  Future<ArchiveSnapshot> read() async {
    final previous = _cached;
    final result = await _request(cached: previous);
    if (result == null) return previous!;
    return _cached = ArchiveSnapshot(
      databaseId: result['id'],
      head: result['head'],
      tree: '',
      generation: result['generation'] as String? ?? '',
      records: TicketArchive.fromJson({
        'format': 'xingji-archive',
        'schemaVersion': schemaVersion,
        'records': result['records'],
      }).records,
      settings: sharedSettings(result['settings'] as Map),
    );
  }

  @override
  Future<String> head() async => (await read()).head;

  @override
  Future<List<TicketRecord>> canonicalRecords(
    List<TicketRecord> records,
  ) async =>
      normalizeRecords == null ? records : await normalizeRecords!(records);

  @override
  Future<String> write(
    List<TicketRecord> records,
    ArchiveSnapshot snapshot,
    Map<String, dynamic> settings,
  ) async {
    records = await canonicalRecords(records);
    final previous = {for (final row in snapshot.records) row.id: row.toJson()};
    final changes = [
      for (final row in records)
        if (!sameValue(row.toJson(), previous.remove(row.id))) row.toJson(),
    ];
    final preferences = sharedSettings(settings);
    final changedSettings = !sameValue(snapshot.settings, preferences);
    if (changes.isEmpty && previous.isEmpty && !changedSettings)
      return snapshot.head;
    return (await _writeSnapshot(snapshot, records, preferences, {
      'records': changes,
      'removed': previous.keys.toList(),
      if (changedSettings) 'settings': preferences,
    })).head;
  }

  Future<ArchiveSnapshot> replace(
    ArchiveSnapshot snapshot,
    List<TicketRecord> records,
    Map<String, dynamic> settings, {
    String? resetId,
  }) async {
    records = await canonicalRecords(records);
    final preferences = sharedSettings(settings);
    return _writeSnapshot(snapshot, records, preferences, {
      'records': records.map((row) => row.toJson()).toList(),
      'removed': <String>[],
      'settings': preferences,
      'replace': true,
      if (resetId != null) 'resetId': resetId,
    });
  }

  Future<ArchiveSnapshot> _writeSnapshot(
    ArchiveSnapshot snapshot,
    List<TicketRecord> records,
    Map<String, dynamic> settings,
    Map<String, dynamic> body,
  ) async {
    if (snapshot.databaseId == null || snapshot.databaseId != _verifiedId) {
      throw const FormatException('D1 数据库身份无效，已停止写入');
    }
    final result = (await _request(
      body: {'id': snapshot.databaseId, 'head': snapshot.head, ...body},
    ))!;
    return _cached = ArchiveSnapshot(
      databaseId: result['id'],
      head: result['head'],
      tree: '',
      generation: result['generation'] as String? ?? snapshot.generation,
      records: records,
      settings: settings,
    );
  }

  // D1 checks the expected head on write, and the store checks the generation on read.
  @override
  Future<void> assertDescendant(String previous, String current) async {}

  @override
  void close() => client.close();
}
