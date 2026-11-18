import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:xingji_core/xingji_core.dart';

class _LoopbackGitHub extends http.BaseClient {
  final Uri origin;
  final http.Client client;
  _LoopbackGitHub(this.origin, this.client);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    final copy = http.Request(
      request.method,
      origin.resolve(request.url.path).replace(query: request.url.query),
    )..headers.addAll(request.headers);
    if (request is http.Request) copy.bodyBytes = request.bodyBytes;
    return client.send(copy);
  }
}

Future<void> main(List<String> args) async {
  final origin = Uri.parse(args.single);
  if (origin.host != '127.0.0.1') throw ArgumentError('Use a loopback fixture');
  final command = jsonDecode(await stdin.transform(utf8.decoder).join()) as Map;
  final client = http.Client();
  final github = GitHubArchive(
    const GitHubConnection('user', 'data', repositoryId: 77),
    'flutter-test',
    client: _LoopbackGitHub(origin, client),
    normalizeRecords: (rows) async {
      final archive = TicketArchive(rows).toJson();
      final response = await client.post(
        origin.resolve('/normalize'),
        body: jsonEncode(archive),
      );
      final result = jsonDecode(utf8.decode(response.bodyBytes));
      if (response.statusCode != 200) throw FormatException(result['error']);
      return TicketArchive.fromJson({...archive, 'records': result}).records;
    },
  );
  try {
    final base = await github.read();
    if (command['edit'] != null || command['add'] != null) {
      final catalog = ReferenceCatalog.fromJson(
        jsonDecode(
          File('../../apps/flutter/assets/reference.json').readAsStringSync(),
        ),
      );
      final edit = command['edit'] as Map? ?? {};
      final wanted = await github.canonicalRecords([
        for (final row in base.records)
          if (edit[row.id] case final Map changes)
            row.withChanges(Map<String, dynamic>.from(changes))
          else
            row,
        if (command['add'] case final Map entry)
          TicketRecord.create(Map<String, dynamic>.from(entry)),
      ]);
      var snapshot = base;
      for (var attempt = 0; ; attempt++) {
        await github.assertDescendant(base.head, snapshot.head);
        if (!snapshot.initialized || snapshot.generation != base.generation) {
          throw const FormatException('Archive reset');
        }
        final result = mergeTickets(
          base.records,
          wanted,
          snapshot.records,
          catalog: catalog,
        );
        if (result.conflicts.isNotEmpty) {
          stdout.write(
            jsonEncode({
              'conflicts': [
                for (final row in result.conflicts)
                  {
                    'id': row.id,
                    'field': row.field,
                    'local': row.local,
                    'remote': row.remote,
                  },
              ],
            }),
          );
          return;
        }
        try {
          await github.write(result.records, snapshot, snapshot.settings);
          break;
        } on ArchiveApiException catch (error) {
          if (error.status != 422 || attempt != 0) rethrow;
          snapshot = await github.read();
        }
      }
    }
    final snapshot = await github.read();
    stdout.write(
      jsonEncode({
        'records': snapshot.records.map((record) => record.toJson()).toList(),
        'settings': snapshot.settings,
        'head': snapshot.head,
        'generation': snapshot.generation,
      }),
    );
  } finally {
    client.close();
  }
}
