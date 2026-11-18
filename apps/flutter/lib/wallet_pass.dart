import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:xingji_core/xingji_core.dart';

const walletPassLimit = 8 * 1024 * 1024;

List<TicketRecord> readWalletBoardingPass(
  Uint8List bytes,
  ReferenceCatalog catalog,
) {
  if (bytes.isEmpty || bytes.length > walletPassLimit) {
    throw const FormatException('请选择 8 MB 以内的电子登机牌');
  }

  Map pass;
  try {
    final zip = ZipDecoder().decodeBytes(bytes, throwOnError: true);
    final entry = zip.find('pass.json');
    if (entry == null ||
        !entry.isFile ||
        entry.isSymbolicLink ||
        entry.size <= 0 ||
        entry.size > 256 * 1024) {
      throw const FormatException('pass.json 无效');
    }
    final content = entry.content;
    if (content.length != entry.size) {
      throw const FormatException('pass.json 长度不一致');
    }
    pass = jsonDecode(utf8.decode(content)) as Map;
  } catch (_) {
    throw const FormatException('无法打开这个钱包票券文件');
  }

  final boarding = pass['boardingPass'];
  if (boarding is! Map || boarding['transitType'] != 'PKTransitTypeAir') {
    throw const FormatException('这个钱包票券不是电子登机牌');
  }
  final tags = pass['semantics'] is Map ? pass['semantics'] as Map : {};
  String text(Map map, String key) {
    final raw = map[key];
    return raw is String && raw.length <= 300 ? raw.trim() : '';
  }

  final rows = <Map>[
    for (final group in [
      'headerFields',
      'primaryFields',
      'secondaryFields',
      'auxiliaryFields',
      'backFields',
    ])
      if (boarding[group] case final List list) ...list.whereType<Map>(),
  ];
  final labelText = [
    for (final row in rows)
      if (text(row, 'label').isNotEmpty && text(row, 'value').isNotEmpty)
        '${text(row, 'label')}: ${text(row, 'value')}',
  ].join('\n');
  final fields = readTravelFields(labelText, catalog, flight: true);

  // Older passes often name their boarding fields instead of including semantic tags.
  Map? field(String key) {
    final entries = rows.where((row) => row['key'] == key).toList();
    return entries.length == 1 ? entries.single : null;
  }

  for (final (passKey, key) in [
    ('depart', 'origin'),
    ('arrive', 'destination'),
  ]) {
    if (field(passKey) case final row?) {
      final value = text(row, 'value').toUpperCase();
      if (RegExp(r'^[A-Z]{3}$').hasMatch(value)) fields[key] ??= value;
    }
  }
  final flightDate = text(field('flightDate') ?? {}, 'value');
  if (parsePrintedJourneyDate(flightDate) case final day?) {
    fields['departureDate'] ??= day.toJson();
  }
  final seatNumber = text(field('seat') ?? {}, 'value');
  if (RegExp(r'^[0-9]{1,3}[A-Z]?$').hasMatch(seatNumber)) {
    fields['seat'] ??= seatNumber;
  }
  final cabin = text(field('cabin') ?? {}, 'value');
  if (RegExp(r'^[A-Z][0-9]{0,2}$').hasMatch(cabin)) {
    fields['seatClass'] ??= cabin;
  }
  final terminal = RegExp(r'(T[0-9]{1,2}[A-Z]?)$')
      .firstMatch(text(field('depart') ?? {}, 'label'));
  if (terminal != null) fields['terminal'] ??= terminal[1];
  for (final (tag, key) in [
    ('flightCode', 'service'),
    ('departureAirportCode', 'origin'),
    ('destinationAirportCode', 'destination'),
    ('departureGate', 'gate'),
    ('departureTerminal', 'terminal'),
    ('confirmationNumber', 'pnr'),
    ('departureCityName', 'originCity'),
    ('destinationCityName', 'destinationCity'),
  ]) {
    final value = text(tags, tag);
    if (value.isNotEmpty) fields[key] = value;
  }
  if (fields['service'] == null && tags['flightNumber'] is int) {
    final airline = text(tags, 'airlineCode');
    if (airline.isNotEmpty) {
      fields['service'] = '$airline${tags['flightNumber']}';
    }
  }
  final passenger = tags['passengerName'];
  if (passenger is Map) {
    final name = [
      text(passenger, 'familyName'),
      text(passenger, 'givenName'),
    ].where((value) => value.isNotEmpty).join('/');
    if (name.isNotEmpty) fields['passenger'] = name;
  } else if (text(tags, 'passengerName') case final name when name.isNotEmpty) {
    fields['passenger'] = name;
  }
  if (tags['seats'] case [final Map seat]) {
    final number = text(seat, 'seatNumber');
    if (number.isNotEmpty) fields['seat'] = number;
  }
  for (final (key, tag) in [
    ('departure', 'originalDepartureDate'),
    ('arrival', 'originalArrivalDate'),
    ('boarding', 'boardingStartDate'),
  ]) {
    final local = RegExp(
      r'^(\d{4}-\d{2}-\d{2})T((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:[+-]\d{2}:?\d{2})?$',
    ).firstMatch(text(tags, tag));
    if (local == null) continue;
    final date = parsePrintedJourneyDate(local[1]);
    if (date == null) continue;
    if (key != 'boarding') fields['${key}Date'] = date.toJson();
    fields['${key}Time'] = local[2];
  }
  final sources = [
    {'kind': 'import', 'label': 'Apple 钱包登机牌', 'at': utcNow()},
  ];
  final supplement = <String, dynamic>{
    ...fields,
    'fieldSources': {for (final key in fields.keys) key: 'import'},
    'sources': sources,
  };
  final readable = <String, List<int>>{};
  final barcodes = [
    if (pass['barcodes'] case final List rows) ...rows.whereType<Map>(),
    if (pass['barcode'] case final Map row) row,
  ];
  for (final code in barcodes) {
    final message = code['message'];
    if (message is! String || message.length > 8192) continue;
    final label = text(code, 'messageEncoding').toLowerCase();
    final encoding = label.isEmpty ? ascii : Encoding.getByName(label);
    if (encoding == null) continue;
    try {
      final bytes = encoding.encode(message);
      if (decodeBoardingBytes(bytes) != null) {
        readable[base64Encode(bytes)] = bytes;
      }
    } on FormatException {
      // Leave unreadable barcodes to the explicit ticket fields.
    } on ArgumentError {
      // The text doesn't fit the declared character encoding.
    }
  }
  if (readable.length > 1) {
    throw const FormatException('该钱包文件包含不同的登机条码，请分别导入');
  }
  if (readable.isNotEmpty) {
    return boardingRecords(
      readable.values.single,
      catalog,
      supplement: supplement,
    );
  }

  if (fields['service'] == null &&
      (fields['origin'] == null || fields['destination'] == null)) {
    throw const FormatException('登机牌里没有可识别的航班信息');
  }
  return [
    catalog.normalize(TicketRecord.create({'type': 'flight', ...supplement})),
  ];
}
