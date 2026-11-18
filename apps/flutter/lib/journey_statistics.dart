import 'dart:math' as math;

import 'package:xingji_core/xingji_core.dart';

class JourneyStatistics {
  final rails = <TicketRecord>[], flights = <TicketRecord>[];
  final airports = <String, Place>{}, stations = <String, Place>{};
  final countries = <String>{}, continents = <String>{};
  final models = <String, int>{},
      bureaus = <String, int>{},
      aircraft = <String, int>{},
      routes = <String, int>{};
  final buckets = <String, (int, int)>{};
  double railMileage = 0;
  int railMileageTrips = 0;

  JourneyStatistics(
    Iterable<TicketRecord> records,
    ReferenceCatalog catalog, {
    DateTime? from,
    required DateTime until,
    required bool monthly,
    required bool supply,
    required bool subtype,
    required bool owner,
    required bool mergeDirections,
  }) {
    final lower = from == null
        ? null
        : DateTime.utc(from.year, from.month, from.day);
    final upper = DateTime.utc(until.year, until.month, until.day);
    final periodKeys = <String, (int, int)>{};
    int? firstYear, lastYear;
    for (final record in records) {
      final departure = record.departure, year = departure?.year;
      if (!record.isJourney || year == null) continue;
      final day = departure?.date;
      final first = day ?? DateTime.utc(year),
          last = day ?? DateTime.utc(year, 12, 31);
      if ((lower != null && first.isBefore(lower)) || last.isAfter(upper)) {
        continue;
      }
      (record.isFlight ? flights : rails).add(record);
      if (!monthly || day != null) {
        firstYear = math.min(firstYear ?? year, year);
        lastYear = math.max(lastYear ?? year, year);
        final key = monthly ? _monthKey(year, day!.month) : '$year';
        final (rail, air) = periodKeys[key] ?? (0, 0);
        periodKeys[key] = record.isFlight ? (rail, air + 1) : (rail + 1, air);
      }

      final endpoints = [
        catalog.endpoint(record, 'origin'),
        catalog.endpoint(record, 'destination'),
      ];
      for (final place in endpoints.whereType<Place>()) {
        (place.flight ? airports : stations)[place.identity] = place;
        final region = place.text('country'),
            continent = place.text('continent');
        if (region.isNotEmpty) {
          countries.add(
            const ['HK', 'MO', 'TW'].contains(region) ? 'CN' : region,
          );
        }
        if (continent.isNotEmpty) continents.add(continent);
      }
      if (record.isFlight) {
        _count(
          aircraft,
          catalog.aircraft(record.text('aircraft'), family: !subtype),
        );
        if (endpoints.every((place) => place != null)) {
          final pair = endpoints.cast<Place>();
          if (mergeDirections) pair.sort((a, b) => a.code.compareTo(b.code));
          final joiner = mergeDirections ? ' ↔ ' : ' → ';
          _count(
            routes,
            pair.map((place) => '${place.name} ${place.code}').join(joiner),
          );
        }
      } else {
        for (final model in _railModels(record, catalog, supply)) {
          _count(models, model);
        }
        final bureau = _railBureau(record.text('railBureau'));
        final unit = record.text('railCarOwner').trim();
        final parts = [
          if (bureau.isNotEmpty) bureau,
          if (owner && unit.isNotEmpty)
            unit
          else if (owner && bureau.isNotEmpty)
            '单位未收录',
        ];
        _count(bureaus, parts.join(' · '));
        final distance = double.tryParse(record.text('railMileage'));
        if (distance != null && distance.isFinite && distance >= 0) {
          railMileage += distance;
          railMileageTrips++;
        }
      }
    }
    if (firstYear != null && lastYear != null) {
      for (var year = firstYear; year <= lastYear; year++) {
        if (monthly) {
          final firstMonth = from?.year == year ? from!.month : 1;
          final lastMonth = until.year == year ? until.month : 12;
          for (var month = firstMonth; month <= lastMonth; month++) {
            final key = _monthKey(year, month);
            buckets[key] = periodKeys[key] ?? (0, 0);
          }
        } else {
          buckets['$year'] = periodKeys['$year'] ?? (0, 0);
        }
      }
    }
  }
}

String _monthKey(int year, int month) =>
    '$year-${month.toString().padLeft(2, '0')}';

void _count(Map<String, int> counts, String value) {
  if (value.isNotEmpty) {
    counts.update(value, (previous) => previous + 1, ifAbsent: () => 1);
  }
}

String _widthNormalized(String value) => String.fromCharCodes(
  value.runes.map(
    (rune) => rune >= 0xff01 && rune <= 0xff5e ? rune - 0xfee0 : rune,
  ),
).replaceAll('　', ' ');

const _bureauAliases = {
  '哈尔滨局': ['哈局'],
  '呼和浩特局': ['呼局'],
  '郑州局': ['郑局'],
  '南昌局': ['南局'],
  '上海局': ['上局'],
  '兰州局': ['兰局'],
  '济南局': ['济局'],
  '昆明局': ['昆局'],
  '武汉局': ['武局'],
  '青藏铁路公司': ['青藏', '青藏集团'],
  '北京局': ['京局'],
  '广铁集团': ['广铁', '广州局'],
  '乌鲁木齐局': ['乌局'],
  '沈阳局': ['沈局'],
  '广东城际铁路公司': ['广东城际'],
  '太原局': ['太局'],
  '成都局': ['成局'],
  '香港铁路公司': ['港铁'],
  '西安局': ['西局'],
  '南宁局': ['宁局'],
};

String _railBureau(String source) {
  final text = _widthNormalized(source).trim().replaceAll(RegExp(r'\s+'), ' ');
  for (final entry in _bureauAliases.entries) {
    final name = entry.key;
    if (text == name || entry.value.contains(text)) return name;
    if (name.endsWith('局') &&
        [
          name.replaceFirst(RegExp(r'局$'), '铁路局'),
          '中国铁路$name集团有限公司',
          '$name集团',
        ].contains(text)) {
      return name;
    }
  }
  return text;
}

Iterable<String> _railModels(
  TicketRecord record,
  ReferenceCatalog catalog,
  bool bySupply,
) {
  final model = record.text('railModel').trim();
  final snapshot = record['railJourney'];
  final query = snapshot is Map ? snapshot['query'] : null;
  final matches =
      query is Map &&
      query['trainNum'] ==
          record.text('service').trim().toUpperCase().split('/').first &&
      sameValue(query['boardingDate'], record['departureDate']) &&
      ['origin', 'destination'].every(
        (side) =>
            (catalog.endpoint(record, side)?.name ?? record.text(side))
                .replaceFirst(RegExp(r'站$'), '') ==
            (query[side] ?? '').toString().replaceFirst(RegExp(r'站$'), ''),
      );
  final values = model.isNotEmpty
      ? [model]
      : [
          if (matches)
            for (final stock
                in (snapshot['trainsets'] as List? ?? []).whereType<Map>())
              if (stock['model'] is String) stock['model'] as String,
        ];
  final supply = _widthNormalized(record.text('railPowerSupply'))
      .toUpperCase()
      .replaceAll(RegExp(r'\s+'), '');
  final power = RegExp(r'(?:AC|DC)\s*\d+(?:\.\d+)?\s*K?V');
  final models = <String>{};
  for (final part in values.expand(
    (value) => _widthNormalized(value).split(RegExp(r'[/、,;；+]')),
  )) {
    var name = part
        .toUpperCase()
        .trim()
        .replaceAll(RegExp(r'[–—]'), '-')
        .replaceAll(RegExp(r'\s+'), ' ');
    if (power.stringMatch(name) == name) continue;
    if (name.startsWith(RegExp(r'25[A-Z]'))) {
      name = name
          .replaceAll(power, '')
          .replaceAll(RegExp(r'\(\s*\)'), '')
          .trim();
    }
    final compact = name.replaceAll(' ', '');
    if (RegExp(r'^[A-Z]{1,6}\d[A-Z\d-]*$').hasMatch(compact)) name = compact;
    if (name.isEmpty) continue;
    final emu = RegExp(r'^(?:CR(?:H|\d)|CJ\d|DJ\d)').hasMatch(name);
    models.add(
      bySupply && !emu ? "$name · ${supply.isEmpty ? '供电制式未知' : supply}" : name,
    );
  }
  return models;
}
