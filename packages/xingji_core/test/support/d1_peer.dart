import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:xingji_core/xingji_core.dart';

class LoopbackGitHub extends http.BaseClient {
  LoopbackGitHub(this.origin);
  final Uri origin;
  final client = http.Client();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    final copy = http.Request(
      request.method,
      origin.resolveUri(
        Uri(
          path: request.url.path,
          query: request.url.hasQuery ? request.url.query : null,
        ),
      ),
    )..headers.addAll(request.headers);
    if (request is http.Request) copy.bodyBytes = request.bodyBytes;
    return client.send(copy);
  }

  @override
  void close() => client.close();
}

Future<void> main(List<String> args) async {
  final origin = Uri.parse(args.single);
  if (origin.host != '127.0.0.1') throw ArgumentError('Use a loopback fixture');
  final command = jsonDecode(await stdin.transform(utf8.decoder).join()) as Map;
  const githubTarget = GitHubConnection('user', 'data', repositoryId: 77);
  final github = GitHubArchive(
    githubTarget,
    'github-test',
    client: LoopbackGitHub(origin),
  );
  final d1 = D1Archive(D1Connection(origin.origin), 'test-worker-credential');
  Map<String, dynamic>? journal;
  try {
    final snapshot = await d1.read();
    final pair = CloudPair(github, githubTarget, d1, d1.verifiedConnection);
    switch (command['action']) {
      case 'bind':
        final source = CloudSource.values.byName(command['source'] as String);
        await pair.bind(await github.read(), snapshot, source);
      case 'edit':
        final records = [
          for (final row in snapshot.records)
            row.withChanges({'gate': command['gate'] as String}),
        ];
        await d1.write(
          records,
          snapshot,
          sharedSettings({...snapshot.settings, 'flightMcpKey': 'flutter-key'}),
        );
      case 'backup':
        await pair.backup();
      case 'reset':
        if (command['journal'] case final Map saved) {
          journal = Map<String, dynamic>.from(saved);
        } else {
          final targets = await pair.resetTargets();
          journal = pair.prepareReset(
            targets.github,
            targets.d1,
            keep: CloudSource.d1,
          );
        }
        await pair.continueReset(journal, (updated) async => journal = updated);
    }
    final current = await d1.read();
    stdout.write(
      jsonEncode({
        'records': current.records.map((row) => row.toJson()).toList(),
        'settings': current.settings,
        'head': current.head,
        'generation': current.generation,
      }),
    );
  } catch (failure) {
    stdout.write(
      jsonEncode({
        'error': failure.toString(),
        if (journal != null) 'journal': journal,
      }),
    );
  } finally {
    d1.close();
    github.close();
  }
}
