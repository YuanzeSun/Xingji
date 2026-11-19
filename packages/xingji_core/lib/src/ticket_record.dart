import 'dart:convert';
import 'dart:math';

import 'journey_date.dart';
import 'record_fields.dart';

dynamic cloneJson(dynamic value) => jsonDecode(jsonEncode(value));
String canonicalJson(dynamic value) {
  dynamic sorted(dynamic item) => item is Map
      ? {
          for (final key
              in (item.keys.map((key) => key.toString()).toList()..sort()))
            key: sorted(item[key]),
        }
      : item is List
      ? item.map(sorted).toList()
      : item;
  return jsonEncode(sorted(value));
}

bool sameValue(dynamic a, dynamic b) => canonicalJson(a) == canonicalJson(b);
String utcNow() => DateTime.fromMillisecondsSinceEpoch(
  DateTime.now().millisecondsSinceEpoch,
  isUtc: true,
).toIso8601String();
String newTicketId() {
  final random = Random.secure();
  final bytes = List.generate(16, (_) => random.nextInt(256));
  bytes[6] = bytes[6] & 15 | 64;
  bytes[8] = bytes[8] & 63 | 128;
  final text = bytes
      .map((byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${text.substring(0, 8)}-${text.substring(8, 12)}-${text.substring(12, 16)}-${text.substring(16, 20)}-${text.substring(20)}';
}

class TicketRecord {
  final Map<String, dynamic> _data;
  TicketRecord._(this._data);
  factory TicketRecord.fromJson(Map<String, dynamic> input) {
    if (input['id'] is! String ||
        !RegExp(r'^[a-zA-Z0-9_-]{1,100}$').hasMatch(input['id']))
      throw const FormatException('票据 ID 无效');
    if (!['rail', 'flight'].contains(input['type']))
      throw const FormatException('交通方式无效');
    if (!ticketTemplates.containsKey(input['template']) ||
        (input['type'] == 'flight') !=
            input['template'].toString().startsWith('air-'))
      throw const FormatException('票面与交通方式不匹配');
    final data = Map<String, dynamic>.from(cloneJson(input));
    data['railStanding'] =
        data['type'] == 'rail' && data['railStanding'] == true;
    if (data['railStanding'] == true) data['seat'] = '';
    for (final key in journeyDateFields) {
      JourneyDate.fromJson(data[key]);
    }
    for (final key in [
      'departureTime',
      'arrivalTime',
      'boardingTime',
      'actualDepartureTime',
      'actualArrivalTime',
      'actualBoardingTime',
    ]) {
      if ((data[key] ?? '') != '' &&
          !RegExp(r'^([01]\d|2[0-3]):[0-5]\d$').hasMatch(data[key]))
        throw const FormatException('时间须为 HH:mm');
    }
    for (final key in ['lookupValues', 'fieldSources']) {
      if (data[key] is! Map) throw FormatException('$key 格式无效');
    }
    for (final key in ['sources', 'lockedFields', 'mergedIds', 'ticketMarks']) {
      if (data[key] is! List) throw FormatException('$key 格式无效');
    }
    return TicketRecord._(data);
  }
  factory TicketRecord.create([Map<String, dynamic> values = const {}]) {
    final at = utcNow(), flight = values['type'] == 'flight';
    final defaults = <String, dynamic>{for (final key in ticketFields) key: ''};
    defaults.addAll({
      'id': newTicketId(),
      'type': 'rail',
      'template': 'rail-receipt',
      'departureZone': 'Asia/Shanghai',
      'arrivalZone': 'Asia/Shanghai',
      'provenance': 'commemorative',
      'offsetX': '0',
      'offsetY': '0',
      'deleted': false,
      'railStanding': false,
      'sources': [],
      'mergedIds': [],
      'lockedFields': [],
      'ticketMarks': [],
      'lookupValues': <String, dynamic>{},
      'fieldSources': <String, dynamic>{},
      'createdAt': at,
      'updatedAt': at,
    });
    if (flight)
      defaults.addAll({
        'template': 'air-boarding-pass',
        'flightStatus': 'normal',
        'seatClass': 'Y',
      });
    defaults.addAll(cloneJson(values) as Map<String, dynamic>);
    return TicketRecord.fromJson(defaults);
  }
  dynamic operator [](String key) => _data[key];
  String text(String key) => (_data[key] ?? '').toString();
  Map<String, dynamic> toJson() => Map<String, dynamic>.from(cloneJson(_data));
  String get id => text('id');
  bool get isFlight => text('type') == 'flight';
  bool get deleted => _data['deleted'] == true;
  bool get railStanding => _data['railStanding'] == true;
  bool get isJourney =>
      !deleted &&
      text('template') != 'rail-refund-receipt' &&
      (!isFlight || !['open', 'invalid'].contains(text('flightStatus')));
  JourneyDate? get departure => JourneyDate.fromJson(_data['departureDate']);
  List<String> get ids => [id, ...List<String>.from(_data['mergedIds'])];
  Set<String> get lockedFields => Set<String>.from(_data['lockedFields']);
  Map<String, dynamic> get fieldSources =>
      Map<String, dynamic>.from(_data['fieldSources']);
  bool barcodeLocked(String key) =>
      isFlight &&
      _data['boardingCode'] is Map &&
      text('boardingCodeSource') == 'original' &&
      fieldSources[key] == 'barcode' &&
      key != 'departureDate';
  bool isAutomatic(String key) =>
      (_data['lookupValues'] as Map).containsKey(key) &&
      sameValue((_data['lookupValues'] as Map)[key], _data[key]) &&
      !lockedFields.contains(key);
  TicketRecord withChanges(Map<String, dynamic> changes) =>
      TicketRecord.fromJson({
        ...toJson(),
        ...cloneJson(changes) as Map<String, dynamic>,
      });
  List<String> get missingFields {
    final required =
        isFlight && ['open', 'invalid'].contains(text('flightStatus'))
        ? ['origin', 'destination', 'passenger']
        : text('template') == 'rail-refund-receipt'
        ? [
            'origin',
            'destination',
            'service',
            'departureDate',
            'passenger',
            'identity',
            'price',
          ]
        : [
            'origin',
            'destination',
            'service',
            'departureDate',
            'departureTime',
            'passenger',
            'identity',
            if (!railStanding) 'seat',
            'seatClass',
            if (!isFlight && !railStanding) 'carriage',
          ];
    return required
        .where(
          (key) => key == 'departureDate'
              ? departure?.dayOfYear == null
              : text(key).trim().isEmpty ||
                    key == 'seatClass' &&
                        !isFlight &&
                        ['无座', '站票'].contains(text(key).trim()),
        )
        .toList();
  }
}

class TicketArchive {
  final List<TicketRecord> records;
  TicketArchive(this.records);
  factory TicketArchive.fromJson(dynamic json) {
    if (json is! Map ||
        json['format'] != 'xingji-archive' ||
        json['schemaVersion'] != schemaVersion ||
        json['records'] is! List)
      throw const FormatException('档案格式无效');
    final records = (json['records'] as List)
        .map((row) => TicketRecord.fromJson(Map<String, dynamic>.from(row)))
        .toList();
    if (records.map((record) => record.id).toSet().length != records.length)
      throw const FormatException('档案包含重复 ID');
    return TicketArchive(records);
  }
  Map<String, dynamic> toJson() => {
    'format': 'xingji-archive',
    'schemaVersion': schemaVersion,
    'exportedAt': utcNow(),
    'records': records.map((record) => record.toJson()).toList(),
  };
}
