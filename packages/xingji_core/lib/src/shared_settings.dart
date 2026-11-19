import 'identity.dart';
import 'journey_date.dart';
import 'reference_catalog.dart';
import 'ticket_record.dart';

const documentTypes = {
  'national-id': '居民身份证',
  'passport': '护照',
  'hk-macau-permit': '港澳通行证',
  'taiwan-permit': '台湾通行证',
  'residence-permit': '居留证',
  'other': '其他证件',
};

Map<String, dynamic> personalProfile([Map value = const {}]) {
  if (value['autoFill'] != null && value['autoFill'] is! bool) {
    throw const FormatException('预填设置格式无效');
  }
  String text(dynamic raw, int max) {
    if (raw == null) return '';
    if (raw is! String || raw.length > max) {
      throw const FormatException('个人资料格式无效或过长');
    }
    return raw.trim();
  }

  final docs = <Map<String, dynamic>>[], ids = <String>{};
  final rawDocs = value['documents'] ?? [];
  if (rawDocs is! List || rawDocs.length > 20) {
    throw const FormatException('最多保存20份常用证件');
  }
  for (final (index, raw) in rawDocs.indexed) {
    if (raw is! Map) throw const FormatException('证件资料格式无效');
    final id = text(raw['id'], 100).isEmpty
            ? 'document-$index'
            : text(raw['id'], 100),
        type = raw['type'] ?? 'other',
        expiry = text(raw['expiry'], 10);
    if (!RegExp(r'^[A-Za-z0-9_-]{1,100}$').hasMatch(id) ||
        !ids.add(id) ||
        !documentTypes.containsKey(type)) {
      throw const FormatException('证件编号重复或类型无效');
    }
    if (expiry.isNotEmpty) {
      final date = DateTime.tryParse(expiry);
      if (date == null ||
          !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(expiry) ||
          date.year < 1800 ||
          date.year > 2200 ||
          JourneyDate.fromDateTime(date).calendarText != expiry) {
        throw const FormatException('证件有效期无效');
      }
    }
    final number = text(raw['number'], 128);
    requireCompleteIdentity(number);
    final doc = {
      'id': id,
      'type': type,
      'label': text(raw['label'], 80),
      'number': number,
      'expiry': expiry,
    };
    if (doc['label'] != '' || doc['number'] != '' || expiry.isNotEmpty) {
      docs.add(doc);
    }
  }
  String choice(String key) =>
      value[key] == 'none' || docs.any((doc) => doc['id'] == value[key])
      ? value[key]
      : '';
  return {
    'autoFill': value['autoFill'] != false,
    'chineseName': text(value['chineseName'], 100),
    'firstName': text(value['firstName'], 150),
    'lastName': text(value['lastName'], 100),
    'gender': switch (text(value['gender'], 40).toLowerCase()) {
      '男' || 'male' || 'm' => '男',
      '女' || 'female' || 'f' => '女',
      _ => '',
    },
    'documents': docs,
    'railDocument': choice('railDocument'),
    'flightDocument': choice('flightDocument'),
  };
}

Map<String, dynamic> archiveConnections([Object? value = const {}]) {
  if (value is! Map) {
    throw const FormatException('备份中的账号信息无效');
  }
  String secret(Map connection) {
    final token = connection['token'];
    if (token is! String || RegExp(r'\s').hasMatch(token)) {
      throw const FormatException('备份中的访问凭证格式无效');
    }
    return token;
  }

  final connections = <String, dynamic>{};
  final github = value['github'], d1 = value['d1'];
  if (github != null) {
    final slug = RegExp(r'^[A-Za-z0-9_.-]+$');
    if (github is! Map ||
        github['owner'] is! String ||
        !slug.hasMatch(github['owner']) ||
        github['repo'] is! String ||
        !slug.hasMatch(github['repo']) ||
        github['id'] is! int ||
        github['branch'] is! String ||
        (github['branch'] as String).isEmpty) {
      throw const FormatException('备份中的 GitHub 仓库信息无效');
    }
    connections['github'] = {
      for (final key in ['owner', 'repo', 'branch', 'id']) key: github[key],
      'token': secret(github),
    };
  }
  if (d1 != null) {
    if (d1 is! Map ||
        d1['id'] is! String ||
        !RegExp(r'^[0-9a-f]{32}$').hasMatch(d1['id']) ||
        d1['url'] is! String) {
      throw const FormatException('备份中的 D1 数据库信息无效');
    }
    final url = Uri.tryParse(d1['url']);
    if (url == null ||
        url.host.isEmpty ||
        (url.scheme != 'https' &&
            !(url.scheme == 'http' &&
                ['localhost', '127.0.0.1', '::1'].contains(url.host))) ||
        url.userInfo.isNotEmpty ||
        url.hasQuery ||
        url.hasFragment ||
        (url.path.isNotEmpty && url.path != '/')) {
      throw const FormatException('请输入 Worker 的根地址');
    }
    connections['d1'] = {
      'id': d1['id'],
      'url': url.origin,
      'token': secret(d1),
    };
  }
  if (connections.isEmpty && value['unlinked'] == true) {
    return {'unlinked': true};
  }
  return connections;
}

Map<String, dynamic> sharedSettings([Map value = const {}]) {
  if (value.keys.any(
    (key) => !['profile', 'flightMcpKey', 'connections'].contains(key),
  )) {
    throw const FormatException('云端设置字段无效');
  }
  final key = value['flightMcpKey'] ?? '';
  if (key is! String ||
      key.length > 8192 ||
      RegExp(r'[\x00-\x20\x7f]').hasMatch(key)) {
    throw const FormatException('飞常准设置格式无效');
  }
  if (value['profile'] != null && value['profile'] is! Map) {
    throw const FormatException('个人资料格式无效');
  }
  final profile = personalProfile(value['profile'] as Map? ?? {});
  final connections = archiveConnections(value['connections'] ?? {});
  return {
    'flightMcpKey': key,
    if (!sameValue(profile, personalProfile())) 'profile': profile,
    if (connections.isNotEmpty) 'connections': connections,
  };
}

Map<String, String> profileDefaults(
  TicketRecord record,
  Map value,
  ReferenceCatalog catalog,
) {
  final profile = personalProfile(value);
  if (profile['autoFill'] == false) return {};
  final a = catalog.endpoint(record, 'origin'),
      b = catalog.endpoint(record, 'destination');
  final chinese =
      !record.isFlight ||
      a?.text('country') == 'CN' && b?.text('country') == 'CN';
  final name = chinese
      ? profile['chineseName'] as String
      : [
          profile['lastName'],
          profile['firstName'],
        ].where((value) => value != '').join('/').toUpperCase();
  final choice = profile[record.isFlight ? 'flightDocument' : 'railDocument'];
  final doc = (profile['documents'] as List)
      .where(
        (doc) => choice == 'none'
            ? false
            : choice != ''
            ? doc['id'] == choice
            : doc['type'] == (chinese ? 'national-id' : 'passport') &&
                  doc['number'] != '',
      )
      .firstOrNull;
  return {'passenger': name, 'identity': doc?['number'] ?? ''};
}

TicketRecord applyProfileDefaults(
  TicketRecord record,
  Map profile,
  ReferenceCatalog catalog,
) {
  final changes = <String, dynamic>{},
      sources = Map<String, dynamic>.from(record.fieldSources);
  for (final entry in profileDefaults(record, profile, catalog).entries) {
    if (record.barcodeLocked(entry.key) ||
        record.lockedFields.contains(entry.key)) {
      continue;
    }
    if (entry.value.isEmpty && sources[entry.key] != 'profile') continue;
    if (record.text(entry.key).isEmpty || sources[entry.key] == 'profile') {
      changes[entry.key] = entry.value;
      sources[entry.key] = 'profile';
    }
  }
  return record.withChanges({...changes, 'fieldSources': sources});
}

class SettingsConflict {
  final String field;
  final dynamic base, local, remote;
  SettingsConflict(this.field, this.base, this.local, this.remote);
}

class SettingsMerge {
  final Map<String, dynamic> settings;
  final Map<String, dynamic> remote;
  final List<SettingsConflict> conflicts;
  SettingsMerge(this.settings, this.conflicts, this.remote);
  Map<String, dynamic> resolve(Map<String, bool> choices) {
    final next = Map<String, dynamic>.from(settings);
    for (final conflict in conflicts) {
      final choice = choices['settings:${conflict.field}'];
      if (choice == null) throw StateError('请选择所有设置冲突项');
      final value = choice ? conflict.remote : conflict.local;
      if (value == null) {
        next.remove(conflict.field);
      } else {
        next[conflict.field] = cloneJson(value);
      }
    }
    return sharedSettings(next);
  }
}

SettingsMerge mergeSettings(Map base, Map local, Map remote) {
  final b = sharedSettings(base),
      l = sharedSettings(local),
      r = sharedSettings(remote),
      result = Map<String, dynamic>.from(l),
      conflicts = <SettingsConflict>[];
  for (final key in {...b.keys, ...l.keys, ...r.keys}) {
    if (sameValue(l[key], r[key]) || sameValue(r[key], b[key])) continue;
    if (sameValue(l[key], b[key])) {
      if (r[key] == null) {
        result.remove(key);
      } else {
        result[key] = cloneJson(r[key]);
      }
    } else {
      conflicts.add(SettingsConflict(key, b[key], l[key], r[key]));
    }
  }
  return SettingsMerge(sharedSettings(result), conflicts, r);
}
