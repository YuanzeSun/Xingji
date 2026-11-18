import 'dart:convert';
import 'dart:math' as math;

import 'package:http/http.dart' as http;

// Same projection and geometric matching rules as the browser implementation.
List<double> railWgs84Point(List coordinates) {
  final longitude = (coordinates[0] as num).toDouble(),
      latitude = (coordinates[1] as num).toDouble(),
      x = longitude - 105,
      y = latitude - 35,
      rad = latitude * math.pi / 180,
      sin = math.sin(rad);
  var lat =
      -100 + 2 * x + 3 * y + .2 * y * y + .1 * x * y + .2 * math.sqrt(x.abs());
  var lon = 300 + x + 2 * y + .1 * x * x + .1 * x * y + .1 * math.sqrt(x.abs());
  double wave(double a, double b) =>
      (20 * math.sin(6 * a * math.pi) +
          20 * math.sin(2 * a * math.pi) +
          20 * math.sin(b * math.pi) +
          40 * math.sin(b / 3 * math.pi)) *
      2 /
      3;
  lat +=
      wave(x, y) +
      (160 * math.sin(y / 12 * math.pi) + 320 * math.sin(y / 30 * math.pi)) *
          2 /
          3;
  lon +=
      wave(x, x) +
      (150 * math.sin(x / 12 * math.pi) + 300 * math.sin(x / 30 * math.pi)) *
          2 /
          3;
  final magic = 1 - .006693421622965943 * sin * sin;
  return [
    longitude -
        lon * 180 / (6378245 / math.sqrt(magic) * math.cos(rad) * math.pi),
    latitude -
        lat *
            180 /
            ((6378245 * (1 - .006693421622965943)) /
                math.pow(magic, 1.5) *
                math.pi),
  ];
}

String _station(dynamic value) =>
    value.toString().replaceAll(RegExp(r'\s|站$'), '');
String _lineName(String value) =>
    value.replaceAll(RegExp(r'[（(].*[）)]$'), '').trim();
bool _point(dynamic value) =>
    value is List &&
    value.length == 2 &&
    value.every((n) => n is num && n.isFinite) &&
    (value[0] as num).abs() <= 180 &&
    (value[1] as num).abs() < 90;
double _km(List a, List b) =>
    math.sqrt(
      math.pow((a[0] - b[0]) * math.cos((a[1] + b[1]) * math.pi / 360), 2) +
          math.pow(a[1] - b[1], 2),
    ) *
    111.32;

List<Map<String, dynamic>> candidateRailLines(Map route, Map catalog) {
  final names = ((route['fullRoute'] ?? route)['stops'] as List)
      .map((row) => _station(row['name']))
      .toSet();
  final ranked = <Map<String, dynamic>>[];
  for (final line in catalog.values) {
    if (line is! Map ||
        line['name'] is! String ||
        (line['name'] as String).length > 100 ||
        line['stations'] is! List ||
        (line['stations'] as List).length > 1000)
      continue;
    final matches = (line['stations'] as List)
        .where((name) => names.contains(_station(name)))
        .length;
    if (matches > 0)
      ranked.add({...Map<String, dynamic>.from(line), 'matches': matches});
  }
  ranked.sort((a, b) {
    final order = (b['matches'] as int).compareTo(a['matches']);
    return order != 0
        ? order
        : (a['stations'] as List).length.compareTo(
            (b['stations'] as List).length,
          );
  });
  final seen = <String>{};
  return ranked
      .where((line) {
        final name = _lineName(line['name']);
        return name.isNotEmpty && seen.add(name);
      })
      .take(12)
      .toList();
}

typedef _Segment = (String, List, List);
(int, int) _cell(List point) =>
    ((point[0] / .025).floor(), (point[1] / .025).floor());

Map<(int, int), List<_Segment>> _lineIndex(List<Map<String, dynamic>> lines) {
  final cells = <(int, int), List<_Segment>>{};
  for (final line in lines) {
    for (final points in line['segments']) {
      for (var i = 1; i < points.length; i++) {
        final a = points[i - 1] as List, b = points[i] as List;
        if (!_point(a) || !_point(b)) continue;
        final lo = _cell([
              math.min(a[0] as num, b[0] as num),
              math.min(a[1] as num, b[1] as num),
            ]),
            hi = _cell([
              math.max(a[0] as num, b[0] as num),
              math.max(a[1] as num, b[1] as num),
            ]);
        if ((hi.$1 - lo.$1 + 1) * (hi.$2 - lo.$2 + 1) > 400) continue;
        for (var x = lo.$1; x <= hi.$1; x++) {
          for (var y = lo.$2; y <= hi.$2; y++) {
            cells.putIfAbsent((x, y), () => []).add((line['name'], a, b));
          }
        }
      }
    }
  }
  return cells;
}

double _distanceToSegment(List point, List a, List b) {
  final cos = math.cos(point[1] * math.pi / 180),
      dx = (b[0] - a[0]) * cos,
      dy = b[1] - a[1],
      length = dx * dx + dy * dy;
  final t = length == 0
      ? 0
      : (((point[0] - a[0]) * cos * dx + (point[1] - a[1]) * dy) / length)
            .clamp(0, 1);
  return math.sqrt(
        math.pow((point[0] - a[0]) * cos - t * dx, 2) +
            math.pow(point[1] - a[1] - t * dy, 2),
      ) *
      111.32;
}

String _nearestLine(List coordinates, Map<(int, int), List<_Segment>> index) {
  final point = railWgs84Point(coordinates),
      cell = _cell(point),
      distances = <String, double>{};
  for (var dx = -1; dx <= 1; dx++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (final segment
          in index[(cell.$1 + dx, cell.$2 + dy)] ?? <_Segment>[]) {
        final distance = _distanceToSegment(point, segment.$2, segment.$3);
        if (distance < .12 &&
            distance < (distances[segment.$1] ?? double.infinity)) {
          distances[segment.$1] = distance;
        }
      }
    }
  }
  final ordered = distances.entries.toList()
    ..sort((a, b) => a.value.compareTo(b.value));
  return ordered.isNotEmpty &&
          (ordered.length == 1 || ordered[1].value - ordered[0].value > .01)
      ? ordered.first.key
      : '';
}

Iterable<(List<double>, double)> _samples(List segments) sync* {
  var base = 0.0, count = 0;
  for (final points in segments) {
    var walked = 0.0, next = 0.0;
    for (var i = 1; i < points.length; i++) {
      final a = points[i - 1] as List,
          b = points[i] as List,
          length = _km(a, b);
      if (length == 0) continue;
      while (next <= walked + length && count < 8000) {
        final t = (next - walked) / length;
        yield (
          [
            (a[0] + (b[0] - a[0]) * t).toDouble(),
            (a[1] + (b[1] - a[1]) * t).toDouble(),
          ],
          base + next,
        );
        next += 2;
        count++;
      }
      walked += length;
    }
    base += walked;
  }
}

class _Run {
  final String name;
  final List<(List<double>, double)> points;
  _Run(this.name, this.points);
  double get length => points.last.$2 - points.first.$2;
}

/// Station names only narrow downloads; the sustained geometry establishes identity.
List<Map<String, dynamic>> matchRailLineNames(
  Map geometry,
  List<Map<String, dynamic>> lines,
) {
  final index = _lineIndex(lines), runs = <_Run>[];
  for (final sample in _samples(geometry['segments'])) {
    final name = _nearestLine(sample.$1, index);
    if (name.isNotEmpty && runs.isNotEmpty && runs.last.name == name) {
      runs.last.points.add(sample);
    } else {
      runs.add(_Run(name, [sample]));
    }
  }
  final matched = <String, double>{};
  for (final run in runs.where((run) => run.name.isNotEmpty)) {
    matched.update(
      run.name,
      (value) => value + run.length,
      ifAbsent: () => run.length,
    );
  }
  final accepted = <String>{};
  for (final line in lines) {
    final stations = (line['stations'] as List).map(_station).toSet();
    final common = (geometry['stops'] as List)
        .where((stop) => stations.contains(_station(stop['name'])))
        .toList();
    final minimum = common.length >= 2
        ? math.max(
            12,
            _km(common.first['coordinates'], common.last['coordinates']) * .2,
          )
        : 40;
    if ((matched[line['name']] ?? 0) >= minimum) accepted.add(line['name']);
  }
  final labels = <Map<String, dynamic>>[];
  for (final run in runs) {
    if (!accepted.contains(run.name) || run.length < 12) continue;
    final count = math.max(1, (run.length / 30).ceil());
    for (var i = 0; i < count && labels.length < 400; i++) {
      final at = math.min(
        run.points.length - 1,
        ((i + .5) * run.points.length / count).floor(),
      );
      labels.add({'name': run.name, 'coordinates': run.points[at].$1});
    }
  }
  return labels;
}

class RailLineNameClient {
  final http.Client client;
  final _cache = <String, Future<dynamic>>{};
  RailLineNameClient(this.client);

  Future<dynamic> _json(String path, int maxBytes, Stopwatch deadline) {
    return _cache.putIfAbsent(path, () async {
      try {
        final remaining = const Duration(seconds: 15) - deadline.elapsed;
        if (remaining <= Duration.zero) throw StateError('线路名称查询超时');
        final response = await client
            .get(Uri.https('fog.vicc.wang', path))
            .timeout(remaining);
        if (response.statusCode != 200 || response.bodyBytes.length > maxBytes)
          throw StateError('暂未取得铁路线路名称');
        return jsonDecode(utf8.decode(response.bodyBytes));
      } catch (_) {
        _cache.remove(path);
        rethrow;
      }
    });
  }

  Future<Map<String, dynamic>> load(Map<String, dynamic> route) async {
    final deadline = Stopwatch()..start();
    try {
      final catalog = await _json(
        '/json/railsConfig/rails.json',
        300000,
        deadline,
      );
      if (catalog is! Map) return route;
      final candidates = candidateRailLines(route, catalog),
          lines = <Map<String, dynamic>>[];
      var next = 0;
      Future<void> worker() async {
        while (next < candidates.length &&
            deadline.elapsed < const Duration(seconds: 15)) {
          final candidate = candidates[next++];
          try {
            final data = await _json(
              '/json/rails/${candidate['name']}.geojson',
              2000000,
              deadline,
            );
            if (data is! Map ||
                data['features'] is! List ||
                (data['features'] as List).length > 1000)
              continue;
            final segments = <List>[];
            for (final feature in data['features']) {
              final geometry = feature['geometry'];
              if (geometry?['type'] == 'LineString')
                segments.add(geometry['coordinates']);
              if (geometry?['type'] == 'MultiLineString')
                segments.addAll((geometry['coordinates'] as List).cast<List>());
            }
            if (segments.any(
                  (line) => line.length < 2 || !line.every(_point),
                ) ||
                segments.fold<int>(0, (total, line) => total + line.length) >
                    100000)
              continue;
            lines.add({
              'name': _lineName(candidate['name']),
              'stations': candidate['stations'],
              'segments': segments,
            });
          } catch (_) {
            /* Optional names never discard the RailGo geometry. */
          }
        }
      }

      await Future.wait(
        List.generate(math.min(3, candidates.length), (_) => worker()),
      );
      if (lines.isEmpty) return route;
      return {
        ...route,
        'lineLabels': matchRailLineNames(route, lines),
        if (route['fullRoute'] is Map)
          'fullRoute': {
            ...route['fullRoute'],
            'lineLabels': matchRailLineNames(route['fullRoute'], lines),
          },
      };
    } catch (_) {
      return route;
    }
  }
}
