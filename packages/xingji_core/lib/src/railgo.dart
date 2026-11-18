import 'dart:convert';
import 'dart:math' as math;

import 'package:http/http.dart' as http;

import 'journey_date.dart';
import 'ticket_record.dart';
import 'reference_catalog.dart';
import 'rail_line_names.dart';

class RailGoClient {
  final http.Client client;
  final ReferenceCatalog catalog;
  late final _lineNames = RailLineNameClient(client);
  RailGoClient(this.catalog, {http.Client? client})
    : client = client ?? http.Client();
  Future<dynamic> _get(
    String host,
    String path,
    Map<String, String> query,
  ) async {
    final response = await client
        .get(Uri.https(host, path, query))
        .timeout(const Duration(seconds: 18));
    if (response.statusCode == 429) {
      throw const FormatException('RailGo 请求较频繁，请稍后再试');
    }
    if (response.statusCode != 200) {
      throw const FormatException('暂未取得列车资料，可手动填写');
    }
    if (response.bodyBytes.length > 5000000) {
      throw const FormatException('列车资料过大，未填入');
    }
    return jsonDecode(utf8.decode(response.bodyBytes));
  }

  Future<Map<String, dynamic>> lookup(
    TicketRecord record, {
    JourneyDate? startDate,
  }) async {
    final origin = catalog.endpoint(record, 'origin'),
        destination = catalog.endpoint(record, 'destination'),
        boarding = record.departure;
    final service = record.text('service').toUpperCase().split('/').first;
    if (record.isFlight ||
        record.text('template') == 'rail-refund-receipt' ||
        !RegExp(r'^[A-Z]?\d{1,5}$').hasMatch(service) ||
        origin == null ||
        destination == null ||
        origin.identity == destination.identity ||
        boarding?.complete != true) {
      throw const FormatException('请先填写车次、完整日期和起终站');
    }
    var start = startDate ?? boarding!;
    if (!start.complete || start.date!.isAfter(boarding!.date!)) {
      throw const FormatException('列车始发日期须完整，且不能晚于乘车日期');
    }
    Future<Map<String, dynamic>> main() async {
      final payload = await _get(
        'rg-api.zenglingkun.cn',
        '/api/v2/getTrainMain',
        {'trainNum': service, 'date': start.calendarText.replaceAll('-', '')},
      );
      if (payload['success'] != true || payload['data'] is! Map) {
        throw const FormatException('未查到该日期的列车资料');
      }
      final data = Map<String, dynamic>.from(payload['data']);
      if (!(data['numberFull'] as List? ?? []).contains(service) ||
          !(data['rundays'] as List? ?? []).contains(
            start.calendarText.replaceAll('-', ''),
          )) {
        throw const FormatException('返回车次或运行日期不匹配');
      }
      return data;
    }

    var data = await main();
    String station(dynamic value) => value
        .toString()
        .replaceAll(RegExp(r'\s'), '')
        .replaceFirst(RegExp(r'站$'), '');
    List<Map<String, dynamic>> timetable() {
      final rows = data['timetable'];
      if (rows is! List || rows.length < 2 || rows.length > 300) {
        throw const FormatException('列车时刻表无效');
      }
      return rows.map((raw) {
        final item = Map<String, dynamic>.from(raw), day = item['day'];
        if (day is! int || day < 0 || day > 7) {
          throw const FormatException('列车跨日资料无效');
        }
        String clock(dynamic raw) =>
            raw is String &&
                RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$').hasMatch(raw)
            ? raw
            : '';
        final arrival = clock(item['arrive']),
            departure = clock(item['depart']);
        Object shifted(int days) =>
            JourneyDate.fromDateTime(start.date!.add(Duration(days: days)))
                .toJson();
        return <String, dynamic>{
          'station': station(item['station']),
          'trainCode': (item['trainCode'] ?? '').toString(),
          'arrivalDate': arrival.isNotEmpty ? shifted(day) : '',
          'arrivalTime': arrival,
          'departureDate': departure.isNotEmpty
              ? shifted(
                  day +
                      (arrival.isNotEmpty && departure.compareTo(arrival) < 0
                          ? 1
                          : 0),
                )
              : '',
          'departureTime': departure,
          'stopMinutes': item['stopTime'] is int ? item['stopTime'] : null,
        };
      }).toList();
    }

    var stops = timetable();
    int from() =>
        stops.indexWhere((stop) => stop['station'] == station(origin.name));
    int to() => stops.indexWhere(
      (stop) => stop['station'] == station(destination.name),
    );
    if (from() < 0 || to() <= from()) throw const FormatException('未匹配到所乘区间');
    final actual = JourneyDate.fromJson(stops[from()]['departureDate']);
    if (actual?.calendarText != boarding.calendarText &&
        startDate == null &&
        actual?.date != null) {
      start = JourneyDate.fromDateTime(
        start.date!.subtract(actual!.date!.difference(boarding.date!)),
      );
      data = await main();
      stops = timetable();
    }
    if (from() < 0 ||
        to() <= from() ||
        JourneyDate.fromJson(stops[from()]['departureDate'])?.calendarText !=
            boarding.calendarText) {
      throw const FormatException('本站发车日期不匹配，请核对列车始发日');
    }
    if (stops.where((stop) => stop['station'] == station(origin.name)).length !=
            1 ||
        stops
                .where((stop) => stop['station'] == station(destination.name))
                .length !=
            1 ||
        stops[to()]['arrivalTime'] == '') {
      throw const FormatException('无法确认所乘区间的到发时刻');
    }
    var previous = '';
    for (final stop in stops)
      for (final side in ['arrival', 'departure']) {
        final date = JourneyDate.fromJson(stop['${side}Date']);
        if (date == null) continue;
        final time = '${date.calendarText}T${stop['${side}Time']}';
        if (time.compareTo(previous) < 0) {
          throw const FormatException('时刻表顺序异常，未填入');
        }
        previous = time;
      }
    const bureaus = {
      'B': '哈尔滨局',
      'C': '呼和浩特局',
      'F': '郑州局',
      'G': '南昌局',
      'H': '上海局',
      'J': '兰州局',
      'K': '济南局',
      'M': '昆明局',
      'N': '武汉局',
      'O': '青藏铁路公司',
      'P': '北京局',
      'Q': '广铁集团',
      'R': '乌鲁木齐局',
      'T': '沈阳局',
      'U': '广东城际铁路公司',
      'V': '太原局',
      'W': '成都局',
      'X': '香港铁路公司',
      'Y': '西安局',
      'Z': '南宁局',
    };
    final car = (data['car'] ?? '').toString().trim().toUpperCase(),
        at = utcNow();
    final supply =
        RegExp(r'(DC\d+V|AC\d+V|AC\d+KV)').firstMatch(car)?[0] ??
        (car.startsWith('CR') ? 'AC25KV' : '');
    final model = car.startsWith('BST') || car == '25TAC380V'
        ? '25T（BSP）'
        : car.replaceAll(RegExp(r'(DC\d+V|AC\d+V|AC\d+KV)'), '').trim();
    final query = {
      'trainNum': service,
      'startDate': start.toJson(),
      'boardingDate': boarding.toJson(),
      'origin': origin.name,
      'destination': destination.name,
    };
    final archived = record['railJourney'];
    final savedStops = archived is Map ? archived['stops'] : null;
    const timetableFields = [
      'trainCode',
      'arrivalDate',
      'arrivalTime',
      'departureDate',
      'departureTime',
    ];
    final sameJourney =
        archived is Map &&
        sameValue(archived['query'], query) &&
        savedStops is List &&
        savedStops.length == stops.length &&
        stops.indexed.every((entry) {
          final (i, stop) = entry;
          final saved = savedStops[i];
          return saved is Map &&
              station(saved['station']) == stop['station'] &&
              timetableFields.every((key) => sameValue(saved[key], stop[key]));
        });
    final saved = sameJourney ? archived : null;
    final savedRoute = sameJourney ? record['railRoute'] : null;
    final savedStocks = <String, Map>{
      if (saved != null)
        for (final row in (saved['trainsets'] as List? ?? []).whereType<Map>())
          if (row['id'] is String && row['id'] != '') row['id']: row,
    };
    final savedAccess = (saved?['access'] as List? ?? [])
        .whereType<Map>()
        .where(
          (row) =>
              station(row['station']) == station(origin.name) &&
              sameValue(row['date'], boarding.toJson()),
        )
        .firstOrNull;
    final journey = <String, dynamic>{
      'query': query,
      'queriedAt': at,
      'stops': stops,
      'distanceQueriedAt': '',
      'trainsets': <dynamic>[],
      'coupling': false,
      'coaches': '',
      'access': <dynamic>[],
    };
    final values = <String, dynamic>{
      'railBureau': bureaus[data['bureau']] ?? data['bureauShortName'] ?? '',
      'railModel': model,
      'railPowerSupply': supply,
      'railRunner': data['runner'] ?? '',
      'railCarOwner': data['carOwner'] ?? '',
      'departureTime': stops[from()]['departureTime'],
      'arrivalDate': stops[to()]['arrivalDate'],
      'arrivalTime': stops[to()]['arrivalTime'],
      'railJourney': journey,
      if (record['railRoute'] is Map && !sameJourney) 'railRoute': '',
      for (final key in [
        'railMileage',
        'railTrainsets',
        'gate',
        'railPlatform',
      ])
        if (record.isAutomatic(key)) key: '',
    };

    void useAccess(Map access) {
      values['gate'] = (access['gates'] as List? ?? [])
          .whereType<String>()
          .map(
            (value) =>
                RegExp(r'([A-Z]?\d+[A-Z]?(?:[-/、][A-Z]?\d+[A-Z]?)*)\s*检票口$')
                    .firstMatch(value)?[1] ??
                value,
          )
          .toSet()
          .join(' / ');
      values['railPlatform'] = access['platform'] ?? '';
      journey['access'] = [access];
    }

    void useStock(List<Map> stocks, bool coupling) {
      journey['trainsets'] = stocks;
      journey['coupling'] = coupling;
      values['railTrainsets'] = stocks.map((row) => row['id']).join(' / ');
      if (stocks.every((row) => (row['model'] ?? '') != '')) {
        values['railModel'] = stocks
            .map((row) => row['model'])
            .toSet()
            .join(' / ');
      }
    }

    void useDistances(List<num> distances, String queriedAt) {
      for (var i = 0; i < distances.length; i++) {
        stops[i]['distanceKm'] = distances[i];
      }
      final km = ((distances[to()] - distances[from()]) * 1000).round() / 1000;
      values['railMileage'] = km == km.roundToDouble()
          ? km.toInt().toString()
          : km.toString();
      journey['distanceQueriedAt'] = queriedAt;
    }

    Future<void> gate() async {
      final payload = await _get('rg-api.zenglingkun.cn', '/api/v2/getExit', {
        'trainNum': from() > 0 && stops[from() - 1]['trainCode'] != ''
            ? stops[from() - 1]['trainCode']
            : service,
        'stationTelecode': origin.code,
        'date': boarding.calendarText,
        'kind': 'departure',
      });
      if (payload['success'] != true || payload['data'] is! Map) return;
      final entrances = (payload['data']['entrance'] as List? ?? [])
              .map((value) => value.toString())
              .toList(),
          platform = (payload['data']['platform'] ?? '').toString();
      if (entrances.isEmpty && platform.isEmpty) return;
      useAccess({
        'station': origin.name,
        'date': boarding.toJson(),
        'platform': platform.isEmpty
            ? (savedAccess?['platform'] ?? '')
            : platform,
        'gates': entrances.isEmpty ? (savedAccess?['gates'] ?? []) : entrances,
      });
    }

    Future<void> route() async {
      final payload = await _get('rg-api.zenglingkun.cn', '/api/v2/mapLine', {
        'train': service,
      });
      final selected = selectRoute(
        payload,
        service,
        origin.name,
        destination.name,
      );
      if (selected == null) return;
      bool coversFullJourney(dynamic fullRoute) {
        final mapped = fullRoute is Map ? fullRoute['stops'] : null;
        return mapped is List &&
            mapped.length >= 2 &&
            station(mapped.first['name']) == stops.first['station'] &&
            station(mapped.last['name']) == stops.last['station'];
      }

      if (!coversFullJourney(selected['fullRoute'])) {
        selected.remove('fullRoute');
      }
      final named = await _lineNames.load(selected);
      if (savedRoute is Map &&
          sameValue(named['segments'], savedRoute['segments']) &&
          named['fullRoute'] is! Map &&
          coversFullJourney(savedRoute['fullRoute'])) {
        named['fullRoute'] = cloneJson(savedRoute['fullRoute']);
      }
      for (final key in ['', 'fullRoute']) {
        final current = key.isEmpty ? named : named[key];
        final previous = savedRoute is Map
            ? (key.isEmpty ? savedRoute : savedRoute[key])
            : null;
        if (current is Map &&
            previous is Map &&
            (current['lineLabels'] as List? ?? []).isEmpty &&
            previous['lineLabels'] is List &&
            canonicalJson(current['segments']) ==
                canonicalJson(previous['segments'])) {
          current['lineLabels'] = cloneJson(previous['lineLabels']);
        }
      }
      values['railRoute'] = named;
    }

    Future<void> stock() async {
      if (!car.startsWith('CR')) return;
      final payload = await _get('emu.railgo.zenglingkun.cn', '/api/query', {
        'keyword': service,
      });
      if (payload['success'] != true || payload['data'] is! List) return;
      final matching = (payload['data'] as List)
          .where(
            (row) =>
                row['runDate'].toString().startsWith(start.calendarText) &&
                row['trainNum'].toString().split('/').contains(service),
          )
          .toList();
      final ids = matching
          .where(
            (row) =>
                row['trainCode'] is List &&
                (row['trainCode'] as List).length <= 2,
          )
          .map((row) => (row['trainCode'] as List).join('/'))
          .toSet();
      if (ids.length != 1) return;
      final codes = ids.single.split('/');
      if (codes.length > 1 && matching.any((row) => row['coupling'] != true)) {
        return;
      }
      final validIds = codes.where(
        (id) => RegExp(r'^CR[A-Z\d-]{3,35}$').hasMatch(id),
      );
      final stocks = await Future.wait(
        validIds.map((id) async {
          final fallback = savedStocks[id] ?? {'id': id};
          try {
            final payload = await _get(
              'emu.railgo.zenglingkun.cn',
              '/api/car/info',
              {'id': id},
            );
            final row = payload['data'];
            if (payload['success'] != true || row is! Map || row['id'] != id) {
              return fallback;
            }
            final fresh = {
              'model': row['model'],
              'subModel': row['sub_model'],
              'manufactureMonth': row['manufacture_month'],
              'manufacturer': row['trainset_manufacturer'],
              'trailerManufacturer': row['trailer_manufacturer'],
              'depot': row['depot'],
              'trainDepot': row['train_depot'],
              'socket': row['socket_location'],
              'customType': row['custom_type'],
              'modelRemark': row['remark']?['model'],
              'carRemark': row['remark']?['car']?['note'],
            };
            return {
              ...fallback,
              for (final entry in fresh.entries)
                if (entry.value != null && entry.value != '')
                  entry.key: entry.value,
              'queriedAt': at,
            };
          } catch (_) {
            return fallback;
          }
        }),
      );
      if (stocks.isNotEmpty) useStock(stocks, stocks.length > 1);
    }

    Future<void> mileage() async {
      final payload = await _get(
        'data.railgo.zenglingkun.cn',
        '/api/train/query',
        {'train': service},
      );
      final row = payload['data'] ?? payload, rows = row['timetable'];
      if (row is! Map ||
          !(row['numberFull'] as List? ?? []).contains(service) ||
          !(row['rundays'] as List? ?? []).contains(
            start.calendarText.replaceAll('-', ''),
          ) ||
          rows is! List ||
          rows.length != stops.length) {
        return;
      }
      num previous = -1;
      for (var i = 0; i < rows.length; i++) {
        final raw = rows[i],
            stop = stops[i],
            distance = raw['distance'],
            day = raw['day'];
        if (station(raw['station']) != stop['station'] ||
            day is! int ||
            day < 0 ||
            day > 7 ||
            distance is! num ||
            !distance.isFinite ||
            distance < 0 ||
            distance > 100000 ||
            distance <= previous ||
            i == 0 && distance != 0) {
          return;
        }
        for (final (source, side) in [
          ('arrive', 'arrival'),
          ('depart', 'departure'),
        ]) {
          final time =
              raw[source] is String &&
                  RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$').hasMatch(raw[source])
              ? raw[source] as String
              : '';
          if (time != stop['${side}Time']) return;
          if (time.isNotEmpty) {
            final extra =
                side == 'departure' &&
                    (stop['arrivalTime'] as String).isNotEmpty &&
                    time.compareTo(stop['arrivalTime']) < 0
                ? 1
                : 0;
            final date = JourneyDate.fromDateTime(
              start.date!.add(Duration(days: day + extra)),
            );
            if (date.calendarText !=
                JourneyDate.fromJson(stop['${side}Date'])?.calendarText) {
              return;
            }
          }
        }
        previous = distance;
      }
      useDistances([for (final row in rows) row['distance'] as num], at);
    }

    Future<void> coaches() async {
      final payload = await _get(
            'rg-api.zenglingkun.cn',
            '/api/v2/getCoachPic',
            {'train': service},
          ),
          row = payload['data'];
      if (payload['success'] != true || row is! Map) return;
      String text(dynamic value) => value is String ? value.trim() : '';
      final cars = <Map<String, String>>[];
      for (final car in (row['coachPicList'] as List? ?? []).take(32)) {
        final uri = Uri.tryParse(text(car['pictureUrl']));
        if (uri == null ||
            uri.scheme != 'https' ||
            uri.host != 'res.railgo.zenglingkun.cn' ||
            uri.userInfo.isNotEmpty) {
          continue;
        }
        final name = text(car['pictureName']);
        cars.add({
          'name': name,
          'url': uri.toString(),
          'number': RegExp(r'^(\d{1,2})车').firstMatch(name)?[1] ?? '',
        });
      }
      final details = <String, dynamic>{
        'model': text(row['trainStyle']),
        'code': text(row['carCode']),
        'type': text(row['carType']),
        'queriedAt': at,
        'cars': cars,
        'info': [
          for (final item in (row['carInfo'] as List? ?? []).take(20))
            if (text(item['pictureName']).isNotEmpty &&
                text(item['pictureValue']).isNotEmpty &&
                !RegExp(r'婴儿|护理台|办公席|无障碍|卫生间|商务座')
                    .hasMatch(text(item['pictureName'])))
              {
                'name': text(item['pictureName']),
                'value': text(item['pictureValue']),
              },
        ],
      };
      const identifyingFields = ['model', 'code', 'type'];
      if (cars.isEmpty &&
          (details['info'] as List).isEmpty &&
          identifyingFields.every((key) => details[key] == ''))
        return;
      final archivedCoaches = saved?['coaches'];
      if (archivedCoaches is Map &&
          identifyingFields.every(
            (key) => details[key] == '' || details[key] == archivedCoaches[key],
          )) {
        for (final key in identifyingFields) {
          if (details[key] == '') details[key] = archivedCoaches[key] ?? '';
        }
        for (final key in ['cars', 'info']) {
          if ((details[key] as List).isEmpty)
            details[key] = archivedCoaches[key] ?? [];
        }
      }
      journey['coaches'] = details;
    }

    await Future.wait(
      [
        gate(),
        route(),
        stock(),
        mileage(),
        coaches(),
      ].map((future) => future.catchError((_) {})),
    );
    if (saved != null) {
      if ((journey['access'] as List).isEmpty && savedAccess != null)
        useAccess(savedAccess);
      if ((journey['trainsets'] as List).isEmpty &&
          (car.isEmpty || car.startsWith('CR')) &&
          savedStocks.isNotEmpty) {
        useStock(savedStocks.values.toList(), saved['coupling'] == true);
      }
      if (journey['coaches'] == '' && saved['coaches'] is Map) {
        journey['coaches'] = saved['coaches'];
      }
      if (journey['distanceQueriedAt'] == '') {
        final distances = (savedStops as List)
            .map((stop) => stop['distanceKm'])
            .toList();
        if (distances.indexed.every((entry) {
          final (i, km) = entry;
          return km is num &&
              km.isFinite &&
              km <= 100000 &&
              (i == 0
                  ? km == 0
                  : distances[i - 1] is num && km > distances[i - 1]);
        })) {
          useDistances(
            distances.cast<num>(),
            (saved['distanceQueriedAt'] ?? '').toString(),
          );
        }
      }
      if (savedRoute is Map) values.putIfAbsent('railRoute', () => savedRoute);
    }
    return values;
  }

  void close() => client.close();
}

Map<String, dynamic>? selectRoute(
  dynamic payload,
  String service,
  String origin,
  String destination,
) {
  if (payload is! Map ||
      payload['success'] != true ||
      payload['data'] is! Map) {
    return null;
  }
  final data = payload['data'];
  if (data['stations'] is! List || data['train'] is! Map) return null;
  String name(dynamic value) => value
      .toString()
      .replaceAll(RegExp(r'\s'), '')
      .replaceFirst(RegExp(r'站$'), '');
  bool point(dynamic value) =>
      value is List &&
      value.length == 2 &&
      value.every((value) => value is num && value.isFinite) &&
      (value[0] as num).abs() <= 180 &&
      (value[1] as num).abs() < 90;
  final stops = <Map<String, dynamic>>[];
  for (final row in data['stations']) {
    if (row is! Map || row.length != 1 || !point(row.values.first)) return null;
    stops.add({'name': name(row.keys.first), 'coordinates': row.values.first});
  }
  if (stops.length < 2 ||
      stops.length > 300 ||
      stops.map((row) => row['name']).toSet().length != stops.length) {
    return null;
  }
  final segments = <Map<String, dynamic>>[];
  for (final entry in (data['train'] as Map).entries) {
    final row = entry.value;
    if (row is! Map ||
        row['line'] is! List ||
        (row['line'] as List).length < 2 ||
        !(row['line'] as List).every(point) ||
        row['index'] is! int) {
      return null;
    }
    segments.add({
      'names': entry.key.toString().split('-').map(name).toList(),
      'line': row['line'],
      'index': row['index'],
    });
  }
  if (segments.length > 1000 ||
      segments.fold<int>(
            0,
            (total, row) => total + (row['line'] as List).length,
          ) >
          50000) {
    return null;
  }
  segments.sort((a, b) => (a['index'] as int).compareTo(b['index'] as int));
  double distance(List a, List b) =>
      math.sqrt(
        math.pow(
              ((a[0] as num) - (b[0] as num)) *
                  math.cos(((a[1] as num) + (b[1] as num)) / 2 * math.pi / 180),
              2,
            ) +
            math.pow((a[1] as num) - (b[1] as num), 2),
      ) *
      111;
  Map<String, dynamic>? section(String from, String to) {
    final start = stops.indexWhere((row) => row['name'] == from),
        end = stops.indexWhere((row) => row['name'] == to);
    if (start < 0 || end <= start) return null;
    for (var offset = 0; offset < segments.length; offset++) {
      if (!(segments[offset]['names'] as List).contains(from)) continue;
      var current = from;
      final selected = <dynamic>[], nodes = <String, List>{};
      for (final segment in segments.skip(offset)) {
        final names = segment['names'] as List;
        if (names.length != 2 || !names.contains(current)) break;
        final next = names.firstWhere((value) => value != current).toString(),
            expected = nodes[current] ?? stops[start]['coordinates'] as List,
            raw = segment['line'] as List;
        final line =
            distance(raw.first, expected) <= distance(raw.last, expected)
            ? raw
            : raw.reversed.toList();
        if (distance(line.first, expected) > 2) break;
        nodes[current] = List.from(line.first);
        nodes[next] = List.from(line.last);
        selected.add(line);
        current = next;
        if (current != to) continue;
        final matched = stops.sublist(start, end + 1);
        if (matched.any(
          (row) =>
              nodes[row['name']] == null ||
              distance(nodes[row['name']]!, row['coordinates']) > 2,
        )) {
          break;
        }
        return {
          'segments': selected,
          'stops': matched
              .map(
                (row) => {
                  'name': row['name'],
                  'coordinates': nodes[row['name']],
                },
              )
              .toList(),
        };
      }
    }
    return null;
  }

  final selected = section(name(origin), name(destination));
  if (selected == null) return null;
  final full = section(stops.first['name'], stops.last['name']);
  return {
    'service': service,
    'origin': name(origin),
    'destination': name(destination),
    ...selected,
    if (full != null) 'fullRoute': full,
    'queriedAt': utcNow(),
  };
}
