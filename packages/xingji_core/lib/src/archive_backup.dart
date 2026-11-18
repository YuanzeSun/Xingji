import 'github_archive.dart';
import 'shared_settings.dart';
import 'ticket_record.dart';

typedef GitHubBackupConnection = ({GitHubConnection target, String token});

class FullArchiveBackup {
  const FullArchiveBackup(this.archive, this.settings, {this.github});

  final TicketArchive archive;
  final Map<String, dynamic> settings;
  final GitHubBackupConnection? github;

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
    final github = (json['connections'] as Map)['github'];
    return FullArchiveBackup(
      archive,
      sharedSettings(json['settings'] as Map),
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

  Map<String, dynamic> toJson() => {
    ...archive.toJson(),
    'format': 'xingji-backup',
    'settings': sharedSettings(settings),
    'connections': {
      if (github case final value?)
        'github': {...value.target.toJson(), 'token': value.token},
    },
  };
}
