import 'ticket_record.dart';

String placeKey(String value) {
  var text = String.fromCharCodes(
    value.runes.map(
      (rune) => rune >= 0xff01 && rune <= 0xff5e ? rune - 0xfee0 : rune,
    ),
  ).toLowerCase();
  const accents = {
    'a': 'áàâäãå',
    'e': 'éèêë',
    'i': 'íìîï',
    'o': 'óòôöõ',
    'u': 'úùûü',
    'n': 'ñ',
    'c': 'ç',
    's': 'șş',
    't': 'țţ',
  };
  for (final entry in accents.entries) {
    for (final rune in entry.value.runes) {
      text = text.replaceAll(String.fromCharCode(rune), entry.key);
    }
  }
  return text
      .replaceAll('國際', '国际')
      .replaceAll('機場', '机场')
      .replaceAll(RegExp(r"[\s'’·._/–—-]"), '');
}

class Place {
  final Map<String, dynamic> data;
  final bool flight;
  const Place(this.data, this.flight);
  String text(String key) => (data[key] ?? '').toString();
  String get code => text('code');
  String get name => text('name');
  String get city =>
      (data['cities'] is List && (data['cities'] as List).isNotEmpty)
      ? (data['cities'] as List).join(' / ')
      : text('city');
  List<double>? get coordinates => data['coordinates'] is List
      ? (data['coordinates'] as List)
            .map((number) => (number as num).toDouble())
            .toList()
      : null;
  String get identity => '${flight ? 'flight' : 'rail'}:${text('id')}';
  List<String> get aliases => [
    code,
    name,
    text('pinyin'),
    text('fullName'),
    text('englishName'),
    text('municipality'),
    city,
    ...List<String>.from(data['aliases'] ?? []),
    if (!flight) name + '站',
  ].where((value) => value.isNotEmpty).toList();
}

class ReferenceCatalog {
  final List<Place> stations, airports;
  final List<Map<String, dynamic>> airlines;
  final Map<String, String> aircraftAliases;
  final Map<String, List<Place>> _rail = {}, _air = {};
  ReferenceCatalog.fromJson(Map<String, dynamic> json)
    : aircraftAliases = Map<String, String>.from(json['aircraftAliases'] ?? {}),
      stations = (json['stations'] as List)
          .map((row) => Place(Map<String, dynamic>.from(row), false))
          .toList(),
      airports = (json['airports'] as List)
          .map((row) => Place(Map<String, dynamic>.from(row), true))
          .toList(),
      airlines = (json['airlines'] as List)
          .map((row) => Map<String, dynamic>.from(row))
          .toList() {
    for (final place in [...stations, ...airports]) {
      for (final alias in place.aliases) {
        final key = placeKey(alias), index = place.flight ? _air : _rail;
        final matches = index.putIfAbsent(key, () => []);
        if (!matches.contains(place)) matches.add(place);
      }
    }
  }
  Place? resolve(String name, String code, {required bool flight}) {
    final index = flight ? _air : _rail;
    var matches = index[placeKey(name)] ?? index[placeKey(code)] ?? [];
    if (!flight && name.isNotEmpty) {
      final exact = matches
          .where((place) => placeKey(place.name) == placeKey(name))
          .toList();
      if (exact.isNotEmpty) matches = exact;
    }
    if (name.isNotEmpty &&
        code.isNotEmpty &&
        index.containsKey(placeKey(name)) &&
        index.containsKey(placeKey(code))) {
      matches = matches
          .where((place) => index[placeKey(code)]!.contains(place))
          .toList();
    }
    return matches.length == 1 ? matches.single : null;
  }

  Place? endpoint(TicketRecord record, String side) => resolve(
    record.text(side),
    record.text(side + 'Code'),
    flight: record.isFlight,
  );
  String identity(TicketRecord record, String side) =>
      endpoint(record, side)?.identity ??
      placeKey(
        record.text(side).isNotEmpty
            ? record.text(side)
            : record.text(side + 'Code'),
      ).replaceFirst(RegExp(r'站$'), '');
  List<Place> search(String query, {required bool flight, int limit = 8}) {
    final key = placeKey(query);
    if (key.isEmpty) return [];
    final ranked = <(Place, int)>[];
    for (final place in flight ? airports : stations) {
      var rank = 99;
      for (final alias in place.aliases) {
        final candidate = placeKey(alias);
        final score = candidate == key
            ? 0
            : candidate.startsWith(key)
            ? 1
            : candidate.contains(key)
            ? 2
            : 99;
        if (score < rank) rank = score;
      }
      if (rank < 99) ranked.add((place, rank));
    }
    ranked.sort((a, b) => a.$2.compareTo(b.$2));
    return ranked.take(limit).map((row) => row.$1).toList();
  }

  String airline(String code) {
    final key = placeKey(code);
    final matches = airlines.where(
      (row) => [
        row['name'],
        row['english'],
        ...row['codes'],
        ...row['aliases'],
      ].any((value) => placeKey(value.toString()) == key),
    );
    return matches.length == 1 ? matches.single['name'] as String : code;
  }

  String aircraft(String value, {bool family = false}) {
    final cleaned = value.trim().toUpperCase().replaceFirst(
      RegExp(r'^(?:AIRBUS|BOEING|空客|波音)\s*'),
      '',
    );
    final key = cleaned.replaceAll(RegExp(r'[\s.\-]'), '');
    var model = aircraftAliases[key];
    final dhc = RegExp(r'^(?:DHC|DASH)([678])(?:Q?([1-4]\d{2}))?$')
        .firstMatch(key);
    if (model == null && dhc != null) {
      model = 'DHC-${dhc[1]}${dhc[2] == null ? '' : '-${dhc[2]}'}';
    }
    model ??= value.trim();
    if (!family) return model;
    for (final pattern in [
      r'^(A\d{3}|7\d{2})',
      r'^(DHC-[678])',
      r'^(ATR (?:42|72))',
      r'^(E(?:170|175|190|195))',
      r'^(ERJ-(?:135|140|145))',
      r'^(SAAB (?:340|2000))',
      r'^(BAe 146)',
      r'^((?:MD|DC|IL|TU|AN|YAK)-\d{1,3})(?:-|$)',
    ]) {
      final match = RegExp(pattern).firstMatch(model);
      if (match != null) return match[1]!;
    }
    final crj = RegExp(r'^CRJ-(\d{3,4})').firstMatch(model);
    return crj == null
        ? model
        : 'CRJ-${['701', '702', '705'].contains(crj[1]) ? '700' : crj[1]}';
  }

  TicketRecord normalize(TicketRecord record, {TicketRecord? original}) {
    final changes = <String, dynamic>{};
    for (final side in ['origin', 'destination']) {
      if (original != null &&
          original[side] == record[side] &&
          original[side + 'Code'] == record[side + 'Code'])
        continue;
      final place = endpoint(record, side);
      if (place == null) continue;
      changes[side] = place.name;
      changes[side + 'Code'] = place.flight ? place.code : place.text('pinyin');
      changes[side + 'City'] = place.city;
      changes[side == 'origin' ? 'departureZone' : 'arrivalZone'] =
          place.text('zone').isEmpty ? 'Asia/Shanghai' : place.text('zone');
    }
    if (record.isFlight &&
        record.text('aircraft').isNotEmpty &&
        record['aircraft'] != original?['aircraft']) {
      changes['aircraft'] = aircraft(record.text('aircraft'));
    }
    return record.withChanges(changes);
  }
}
