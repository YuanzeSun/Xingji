import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final record = TicketRecord.create({
    'id': 'test',
    'origin': '北京南',
    'destination': '南京南',
    'departureDate': JourneyDate.calendar(2026, 11, 16).toJson(),
  });
  late Map<String, dynamic> manifest;
  late String content;
  late List<http.Request> writes;
  late MockClient client;
  setUp(() {
    content = jsonEncode(TicketArchive([record]).toJson());
    manifest = {
      'format': 'xingji-index',
      'schemaVersion': 1,
      'generation': 'reset-id',
      'recordCount': 1,
      'settings': {
        'flightMcpKey': 'secret-key',
        'profile': personalProfile({'chineseName': '张三'}),
      },
      'files': {
        'archive/2026.json': sha256.convert(utf8.encode(content)).toString(),
      },
    };
    writes = [];
    client = MockClient((request) async {
      dynamic response;
      if (request.method != 'GET') {
        writes.add(request);
        response = {
          'sha': request.url.path.endsWith('trees') ? 'new-tree' : 'new-head',
        };
      } else if (request.url.path == '/repos/user/archive') {
        response = {
          'id': 123,
          'private': true,
          'permissions': {'push': true},
        };
      } else if (request.url.path.endsWith('/git/ref/heads/main')) {
        response = {
          'object': {'sha': 'head'},
        };
      } else if (request.url.path.endsWith('/git/commits/head')) {
        response = {
          'tree': {'sha': 'tree'},
        };
      } else if (request.url.path.endsWith('/git/trees/tree')) {
        expect(request.url.queryParameters, {'recursive': '1'});
        response = {
          'truncated': false,
          'tree': [
            {'type': 'blob', 'path': 'archive/index.json', 'sha': 'index'},
            {'type': 'blob', 'path': 'archive/2026.json', 'sha': 'year'},
          ],
        };
      } else if (request.url.path.contains('/git/blobs/')) {
        response = {
          'encoding': 'base64',
          'content': base64Encode(
            utf8.encode(
              request.url.path.endsWith('/index')
                  ? jsonEncode(manifest)
                  : content,
            ),
          ),
        };
      } else if (request.url.path.contains('/compare/')) {
        response = {'status': 'ahead'};
      } else {
        return http.Response('{}', 404);
      }
      return http.Response(jsonEncode(response), 200);
    });
  });
  GitHubArchive archive() => GitHubArchive(
    const GitHubConnection('user', 'archive', repositoryId: 123),
    'not-a-real-token',
    client: client,
  );
  test(
    'reads index checksums, settings and canonical year partition',
    () async {
      final result = await archive().read();
      expect(result.records.single.toJson(), record.toJson());
      expect(result.settings['flightMcpKey'], 'secret-key');
      expect(result.generation, 'reset-id');
    },
  );
  test('unchanged snapshot creates no commit', () async {
    final api = archive(), snapshot = await api.read();
    expect(
      await api.write(snapshot.records, snapshot, snapshot.settings),
      'head',
    );
    expect(writes, isEmpty);
  });
  test('publishes one atomic fast-forward preserving personal settings and generation', () async {
    final api = archive(), snapshot = await api.read();
    await api.write(
      [
        record.withChanges({'gate': '16A'}),
      ],
      snapshot,
      snapshot.settings,
    );
    expect(writes.map((r) => r.method), ['POST', 'POST', 'PATCH']);
    final tree = jsonDecode(writes.first.body);
    expect(tree['base_tree'], 'tree');
    final index = jsonDecode(
      (tree['tree'] as List).firstWhere(
        (e) => e['path'] == 'archive/index.json',
      )['content'],
    );
    expect(index['settings'], manifest['settings']);
    expect(index['generation'], 'reset-id');
    expect(jsonDecode(writes.last.body)['force'], false);
  });
  test(
    'replacement changes the archive generation and keeps the existing tree',
    () async {
      final api = archive(), snapshot = await api.read();
      await api.replaceTickets(
        [],
        snapshot,
        snapshot.settings,
        'replacement-generation',
      );
      expect(writes.map((r) => r.method), ['POST', 'POST', 'PATCH']);
      final tree = jsonDecode(writes.first.body);
      expect(tree['base_tree'], 'tree');
      final changes = tree['tree'] as List;
      final index = jsonDecode(
        changes.firstWhere((e) => e['path'] == 'archive/index.json')['content'],
      );
      expect(index['generation'], 'replacement-generation');
      expect(index['settings'], snapshot.settings);
      expect(
        changes.firstWhere((e) => e['path'] == 'archive/2026.json')['sha'],
        isNull,
      );
      expect(jsonDecode(writes[1].body)['parents'], ['head']);
      expect(jsonDecode(writes.last.body)['force'], false);
    },
  );

  test('reset removes the current tree but preserves profile, key and commit history', () async {
    final api = archive(), before = await api.read();
    final after = await api.reset(before, before.settings);
    expect(after.records, isEmpty);
    expect(after.generation, isNot(before.generation));
    expect(after.settings, before.settings);
    expect(writes, hasLength(3));
    final tree = jsonDecode(writes[0].body);
    expect(tree.containsKey('base_tree'), false);
    expect(tree['tree'], hasLength(1));
    expect(tree['tree'][0]['path'], 'archive/index.json');
    final index = jsonDecode(tree['tree'][0]['content']);
    expect(index['recordCount'], 0);
    expect(index['files'], isEmpty);
    expect(index['settings'], before.settings);
    expect(jsonDecode(writes[1].body)['parents'], ['head']);
    expect(jsonDecode(writes[2].body)['force'], false);
  });
  test(
    'reset reads preserved settings even when the ticket schema is outdated',
    () async {
      final api = archive();
      manifest['schemaVersion'] = 0;
      (manifest['settings'] as Map)['obsoleteSetting'] = 'ignored';
      await expectLater(api.read(), throwsFormatException);
      final target = await api.resetTarget();
      expect(writes, isEmpty);
      final reset = await api.reset(target, target.settings);
      expect(reset.settings['flightMcpKey'], 'secret-key');
      expect(reset.settings['profile']['chineseName'], '张三');
      expect(reset.settings.containsKey('obsoleteSetting'), false);
      expect(reset.records, isEmpty);
      expect(jsonDecode(writes[1].body)['parents'], ['head']);
      expect(jsonDecode(writes[2].body)['force'], false);
    },
  );
  test('checksum mismatch aborts without any write', () async {
    manifest['files']['archive/2026.json'] = 'bad';
    await expectLater(archive().read(), throwsFormatException);
    expect(writes, isEmpty);
  });
  test('public repository is rejected before reading ticket blobs', () async {
    final api = GitHubArchive(
      const GitHubConnection('user', 'archive'),
      'x',
      client: MockClient(
        (r) async => http.Response(
          jsonEncode({
            'id': 123,
            'private': false,
            'permissions': {'push': true},
          }),
          200,
        ),
      ),
    );
    await expectLater(api.read(), throwsFormatException);
  });
  test('rewritten history is not silently accepted', () async {
    final api = GitHubArchive(
      const GitHubConnection('user', 'archive'),
      'x',
      client: MockClient(
        (r) async => http.Response('{"status":"diverged"}', 200),
      ),
    );
    await expectLater(
      api.assertDescendant('old', 'new'),
      throwsFormatException,
    );
  });
  test('failed fast-forward does not retry with force', () async {
    final api = archive(), snapshot = await api.read();
    final failing = GitHubArchive(
      const GitHubConnection('user', 'archive', repositoryId: 123),
      'x',
      client: MockClient((r) async {
        if (r.method == 'PATCH') {
          writes.add(r);
          return http.Response('{}', 422);
        }
        return client
            .send(
              http.Request(r.method, r.url)
                ..headers.addAll(r.headers)
                ..bodyBytes = r.bodyBytes,
            )
            .then(http.Response.fromStream);
      }),
    );
    await expectLater(
      failing.write(
        [
          record.withChanges({'gate': 'A'}),
        ],
        snapshot,
        snapshot.settings,
      ),
      throwsA(isA<ArchiveApiException>()),
    );
    expect(jsonDecode(writes.last.body)['force'], false);
  });
}
