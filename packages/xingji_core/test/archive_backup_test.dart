import 'dart:convert';

import 'package:test/test.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  test('full backup accepts Web JSON and writes the shared ticket and GitHub fields', () {
    final record = TicketRecord.create({'id': 'train-1', 'service': 'G21'});
    final archive = TicketArchive([record]);
    final settings = sharedSettings({
      'flightMcpKey': 'test-mcp-key',
      'profile': {
        'chineseName': '测试旅客',
        'documents': [
          {'id': 'passport', 'type': 'passport', 'number': 'TEST123'},
        ],
      },
    });
    final gitHub = {
      'owner': 'test',
      'repo': 'private-data',
      'branch': 'tickets',
      'id': 77,
      'token': 'test-github-key',
    };
    final input = jsonEncode({
      ...archive.toJson(),
      'format': 'xingji-backup',
      'settings': settings,
      'connections': {
        'github': gitHub,
        'd1': {
          'id': '0' * 32,
          'url': 'https://archive.example',
          'token': 'test-d1-key',
        },
      },
    });
    final backup = FullArchiveBackup.fromJson(jsonDecode(input));
    expect(backup.archive.records.single.id, record.id);
    expect(backup.settings, settings);
    final output = backup.toJson();
    expect(output['settings'], settings);
    expect(output['connections']['github'], gitHub);
    expect(output['connections']['d1'], {
      'id': '0' * 32,
      'url': 'https://archive.example',
      'token': 'test-d1-key',
    });
    final cloud = sharedSettings({
      ...settings,
      'connections': output['connections'],
    });
    final forwarded = FullArchiveBackup(archive, cloud).toJson();
    expect(forwarded['settings'], settings);
    expect(forwarded['connections'], output['connections']);
    expect(output['format'], 'xingji-backup');
  });
}
