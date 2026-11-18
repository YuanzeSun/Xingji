import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final fixtures = jsonDecode(
    File('../../specs/fixtures/rail-line-names.json').readAsStringSync(),
  ) as List;
  for (final row in fixtures) {
    test('browser and Dart agree on ${row['name']}', () {
      final labels = matchRailLineNames(
        row['geometry'],
        (row['lines'] as List)
            .map((line) => Map<String, dynamic>.from(line))
            .toList(),
      );
      final expected = row['expected'] as List;
      expect(labels.length, expected.length);
      for (var i = 0; i < labels.length; i++) {
        expect(labels[i]['name'], expected[i]['name']);
        for (var side = 0; side < 2; side++) {
          expect(
            labels[i]['coordinates'][side],
            closeTo(expected[i]['coordinates'][side], 1e-9),
          );
        }
      }
    });
  }

  test('catalog directions deduplicate and repeated reads reuse optional source data', () async {
    final route = Map<String, dynamic>.from(fixtures[0]['geometry']),
        points = (route['segments'] as List).first as List;
    final requests = <Uri>[];
    final client = MockClient((request) async {
      requests.add(request.url);
      return http.Response(
        jsonEncode(
          request.url.path.endsWith('rails.json')
              ? {
                  'a': {
                    'name': '示例客专(甲-丙)',
                    'stations': ['甲站', '乙站', '丙站'],
                  },
                  'b': {
                    'name': '示例客专(丙-甲)',
                    'stations': ['丙站', '乙站', '甲站'],
                  },
                }
              : {
                  'features': [
                    {
                      'geometry': {
                        'type': 'LineString',
                        'coordinates': points
                            .map((p) => railWgs84Point(p))
                            .toList(),
                      },
                    },
                  ],
                },
        ),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final loader = RailLineNameClient(client);
    final named = await loader.load({...route, 'fullRoute': route});
    expect((named['lineLabels'] as List).first['name'], '示例客专');
    expect(named['fullRoute']['lineLabels'], named['lineLabels']);
    await loader.load(route);
    expect(requests, hasLength(2));
    client.close();
  });

  test(
    'an unavailable name source retains the route and is retried later',
    () async {
      final route = Map<String, dynamic>.from(fixtures[0]['geometry']);
      var requests = 0;
      final client = MockClient((request) async {
        requests++;
        return http.Response('unavailable', 503);
      });
      final loader = RailLineNameClient(client);
      expect(await loader.load(route), same(route));
      expect(await loader.load(route), same(route));
      expect(requests, 2);
      client.close();
    },
  );

  test(
    'RailGo lookup saves verified names for selected and complete routes',
    () async {
      final points = [
            [116.0, 39.0],
            [116.2, 39.0],
            [116.4, 39.0],
          ],
          names = ['北京', '哈尔滨', '齐齐哈尔'];
      var offline = false;
      final client = MockClient((request) async {
        if (request.url.host == 'fog.vicc.wang' && offline)
          return http.Response('', 503);
        final dynamic payload;
        if (request.url.path.endsWith('getTrainMain')) {
          payload = {
            'success': true,
            'data': {
              'numberFull': ['Z83'],
              'rundays': ['20261118'],
              'car': '25TDC600V',
              'timetable': [
                for (var i = 0; i < names.length; i++)
                  {
                    'station': names[i],
                    'trainCode': 'Z83',
                    'arrive': '${10 + i}:00',
                    'depart': '${10 + i}:00',
                    'day': 0,
                  },
              ],
            },
          };
        } else if (request.url.path.endsWith('mapLine')) {
          payload = {
            'success': true,
            'data': {
              'stations': [
                for (var i = 0; i < names.length; i++) {names[i]: points[i]},
              ],
              'train': {
                for (var i = 0; i < 2; i++)
                  '${names[i]}-${names[i + 1]}': {
                    'line': [points[i], points[i + 1]],
                    'index': i,
                  },
              },
            },
          };
        } else if (request.url.path.endsWith('rails.json')) {
          payload = {
            'a': {'name': '示例铁路', 'stations': names},
          };
        } else if (request.url.path.endsWith('.geojson')) {
          payload = {
            'features': [
              {
                'geometry': {
                  'type': 'LineString',
                  'coordinates': points.map(railWgs84Point).toList(),
                },
              },
            ],
          };
        } else {
          payload = {
            'success': true,
            'data': {'entrance': [], 'platform': ''},
          };
        }
        return http.Response(
          jsonEncode(payload),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      });
      final catalog = ReferenceCatalog.fromJson(
        jsonDecode(
          File('../../apps/flutter/assets/reference.json').readAsStringSync(),
        ),
      );
      final lookup = RailGoClient(catalog, client: client);
      final record = TicketRecord.create({
        'type': 'rail',
        'origin': '北京',
        'originCode': 'beijing',
        'destination': '齐齐哈尔',
        'destinationCode': 'qiqihaer',
        'service': 'Z83',
        'departureDate': JourneyDate.calendar(2026, 11, 18).toJson(),
      });
      final values = await lookup.lookup(record);
      expect(values['railRoute']['lineLabels'], isNotEmpty);
      expect(values['railRoute']['fullRoute']['lineLabels'], isNotEmpty);
      final saved = TicketArchive.fromJson(
        TicketArchive([record.withChanges(values)]).toJson(),
      ).records.single;
      expect(
        saved['railRoute']['lineLabels'],
        values['railRoute']['lineLabels'],
      );
      // Refreshing identical geometry during a source outage preserves verified labels.
      offline = true;
      final refresh = RailGoClient(catalog, client: client);
      expect(
        (await refresh.lookup(saved))['railRoute']['lineLabels'],
        values['railRoute']['lineLabels'],
      );
      lookup.close();
    },
  );
}
