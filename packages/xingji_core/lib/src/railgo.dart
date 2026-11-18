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
    if (response.statusCode == 429)
      throw const FormatException('RailGo 请求较频繁，请稍后再试');
    if (response.statusCode != 200)
      throw const FormatException('暂未取得列车资料，可手动填写');
    if (response.bodyBytes.length > 5000000)
      throw const FormatException('列车资料过大，未填入');
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
        !RegExp(r'^[A-Z]?\d{1,5}$').hasMatch(service) ||
        origin == null ||
        destination == null ||
        boarding?.complete != true)
      throw const FormatException('请先填写车次、完整日期和起终站');
    var start = startDate ?? boarding!;
    Future<Map<String, dynamic>> main() async {
      final payload = await _get(
        'rg-api.zenglingkun.cn',
        '/api/v2/getTrainMain',
        {'trainNum': service, 'date': start.calendarText.replaceAll('-', '')},
      );
      if (payload['success'] != true || payload['data'] is! Map)
        throw const FormatException('未查到该日期的列车资料');
      final data = Map<String, dynamic>.from(payload['data']);
      if (!(data['numberFull'] as List? ?? []).contains(service) ||
          !(data['rundays'] as List? ?? []).contains(
            start.calendarText.replaceAll('-', ''),
          ))
        throw const FormatException('返回车次或运行日期不匹配');
      return data;
    }

    var data = await main();
    String station(dynamic value) => value
        .toString()
        .replaceAll(RegExp(r'\s'), '')
        .replaceFirst(RegExp(r'站$'), '');
    List<Map<String, dynamic>> timetable() {
      final rows = data['timetable'];
      if (rows is! List || rows.length < 2 || rows.length > 300)
        throw const FormatException('列车时刻表无效');
      return rows.map((raw) {
        final item = Map<String, dynamic>.from(raw), day = item['day'];
        if (day is! int || day < 0 || day > 7)
          throw const FormatException('列车跨日资料无效');
        final arrival = (item['arrive'] ?? '').toString(),
            departure = (item['depart'] ?? '').toString();
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
    if (actual?.calendarText != boarding!.calendarText &&
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
            boarding.calendarText)
      throw const FormatException('本站发车日期不匹配，请核对列车始发日');
    var previous = '';
    for (final stop in stops)
      for (final side in ['arrival', 'departure']) {
        final date = JourneyDate.fromJson(stop['${side}Date']);
        if (date == null) continue;
        final time = '${date.calendarText}T${stop['${side}Time']}';
        if (time.compareTo(previous) < 0)
          throw const FormatException('时刻表顺序异常，未填入');
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
    final journey = <String, dynamic>{
      'query': {
        'trainNum': service,
        'startDate': start.toJson(),
        'boardingDate': boarding.toJson(),
        'origin': origin.name,
        'destination': destination.name,
      },
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
    };
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
      values['gate'] = entrances
          .map(
            (value) =>
                RegExp(r'([A-Z]?\d+[A-Z]?(?:[-/、][A-Z]?\d+[A-Z]?)*)\s*检票口$')
                    .firstMatch(value)?[1] ??
                value,
          )
          .toSet()
          .join(' / ');
      values['railPlatform'] = platform;
      journey['access'] = [
        {
          'station': origin.name,
          'date': boarding.toJson(),
          'platform': platform,
          'gates': entrances,
        },
      ];
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
      final named = await _lineNames.load(selected),
          saved = record['railRoute'];
      for (final key in ['', 'fullRoute']) {
        final current = key.isEmpty ? named : named[key];
        final previous = saved is Map
            ? (key.isEmpty ? saved : saved[key])
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
      if (codes.length > 1 && matching.any((row) => row['coupling'] != true))
        return;
      final stocks = <Map<String, dynamic>>[];
      for (final id in codes) {
        if (!RegExp(r'^CR[A-Z\d-]{3,35}$').hasMatch(id)) continue;
        final payload = await _get(
              'emu.railgo.zenglingkun.cn',
              '/api/car/info',
              {'id': id},
            ),
            row = payload['data'];
        if (payload['success'] != true || row is! Map || row['id'] != id) {
          stocks.add({'id': id});
          continue;
        }
        stocks.add({
          'id': id,
          'model': row['model'] ?? '',
          'subModel': row['sub_model'] ?? '',
          'manufactureMonth': row['manufacture_month'] ?? '',
          'manufacturer': row['trainset_manufacturer'] ?? '',
          'trailerManufacturer': row['trailer_manufacturer'] ?? '',
          'depot': row['depot'] ?? '',
          'trainDepot': row['train_depot'] ?? '',
          'socket': row['socket_location'] ?? '',
          'customType': row['custom_type'] ?? '',
          'modelRemark': row['remark']?['model'] ?? '',
          'carRemark': row['remark']?['car']?['note'] ?? '',
          'queriedAt': at,
        });
      }
      values['railTrainsets'] = stocks.map((row) => row['id']).join(' / ');
      journey['trainsets'] = stocks;
      journey['coupling'] = codes.length > 1;
    }

    await Future.wait(
      [gate(), route(), stock()].map((future) => future.catchError((_) {})),
    );
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
  if (payload is! Map || payload['success'] != true || payload['data'] is! Map)
    return null;
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
      stops.map((row) => row['name']).toSet().length != stops.length)
    return null;
  final segments = <Map<String, dynamic>>[];
  for (final entry in (data['train'] as Map).entries) {
    final row = entry.value;
    if (row is! Map ||
        row['line'] is! List ||
        (row['line'] as List).length < 2 ||
        !(row['line'] as List).every(point) ||
        row['index'] is! int)
      return null;
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
          50000)
    return null;
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
        ))
          break;
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
