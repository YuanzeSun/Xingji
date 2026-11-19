import 'd1_archive.dart';
import 'github_archive.dart';
import 'shared_settings.dart';
import 'ticket_record.dart';

typedef GitHubBackupConnection = ({GitHubConnection target, String token});
typedef D1BackupConnection = ({D1Connection target, String token});

class FullArchiveBackup {
  const FullArchiveBackup(
    this.archive,
    this.settings, {
    this.github,
    this.d1,
    this.connections = const {},
  });

  final TicketArchive archive;
  final Map<String, dynamic> settings;
  final GitHubBackupConnection? github;
  final D1BackupConnection? d1;
  final Map<String, dynamic> connections;

  factory FullArchiveBackup.fromJson(Object? json) {
    if (json is! Map ||
        json['format'] != 'xingji-backup' ||
        json['settings'] is! Map ||
        json['connections'] is! Map) {
      throw const FormatException('请选择行迹导出的完整 JSON 备份');
    }
    final archive = TicketArchive.fromJson({
      ...json,
      'format': 'xingji-archive',
    });
    final connections = archiveConnections(json['connections']);
    final github = connections['github'];
    final d1 = connections['d1'];
    return FullArchiveBackup(
      archive,
      sharedSettings(json['settings'] as Map)..remove('connections'),
      connections: connections,
      d1: d1 == null
          ? null
          : (
              target: D1Connection.fromJson(d1 as Map),
              token: d1['token'] as String,
            ),
      github: github == null
          ? null
          : (
              target: GitHubConnection.fromJson(
                Map<String, dynamic>.from(github as Map),
              ),
              token: github['token'] as String,
            ),
    );
  }

  Map<String, dynamic> toJson() {
    final preferences = sharedSettings(settings);
    final savedConnections = preferences.remove('connections');
    return {
      ...archive.toJson(),
      'format': 'xingji-backup',
      'settings': preferences,
      'connections': archiveConnections({
        ...?savedConnections as Map?,
        ...connections,
        if (github case final value?)
          'github': {...value.target.toJson(), 'token': value.token},
        if (d1 case final value?)
          'd1': {...value.target.toJson(), 'token': value.token},
      }),
    };
  }
}
