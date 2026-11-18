import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final catalog = ReferenceCatalog.fromJson({
    'stations': [
      {'id': 'VNP', 'name': '北京南', 'code': 'VNP'},
      {'id': 'JGK', 'name': '济南西', 'code': 'JGK'},
      {'id': 'NKH', 'name': '南京南', 'code': 'NKH'},
    ],
    'airports': [],
    'airlines': [],
  });
  final date = JourneyDate.calendar(2026, 11, 16).toJson();
  const stations = ['北京南', '济南西', '南京南'];
  const positions = [
    [116.38, 39.86],
    [116.90, 36.67],
    [118.79, 31.97],
  ];
  final route = {
    'service': 'G21',
    'origin': '济南西',
    'destination': '南京南',
    'segments': [positions.sublist(1)],
    'stops': [
      for (var i = 1; i < 3; i++)
        {'name': stations[i], 'coordinates': positions[i]},
    ],
    'fullRoute': {
      'segments': [positions.sublist(0, 2), positions.sublist(1)],
      'stops': [
        for (var i = 0; i < 3; i++)
          {'name': stations[i], 'coordinates': positions[i]},
      ],
    },
  };
  final archived = TicketRecord.create({
    'origin': '济南西',
    'destination': '南京南',
    'service': 'G21',
    'departureDate': date,
    'railRoute': route,
    'railMileage': '617',
    'railTrainsets': 'CR400BF-5099',
    'gate': '16A',
    'railPlatform': '13',
    'lookupValues': {
      'railMileage': '617',
      'railTrainsets': 'CR400BF-5099',
      'gate': '16A',
      'railPlatform': '13',
    },
    'railJourney': {
      'query': {
        'trainNum': 'G21',
        'startDate': date,
        'boardingDate': date,
        'origin': '济南西',
        'destination': '南京南',
      },
      'queriedAt': '2026-11-16T00:00:00Z',
      'stops': [
        for (final (station, arrival, departure, distance) in [
          ('北京南', '', '15:00', 0),
          ('济南西', '16:23', '16:25', 406),
          ('南京南', '18:24', '', 1023),
        ])
          {
            'station': station,
            'trainCode': 'G21',
            'arrivalTime': arrival,
            'departureTime': departure,
            'arrivalDate': arrival.isEmpty ? '' : date,
            'departureDate': departure.isEmpty ? '' : date,
            'distanceKm': distance,
          },
      ],
      'distanceQueriedAt': '2026-11-16T00:00:00Z',
      'trainsets': [
        {'id': 'CR400BF-5099', 'model': 'CR400BF-B'},
      ],
      'coaches': {
        'model': 'CR400BF',
        'cars': [
          {'name': '01车厢', 'url': 'https://res.railgo.zenglingkun.cn/car.png'},
        ],
      },
      'access': [
        {
          'station': '济南西',
          'date': date,
          'platform': '13',
          'gates': ['16A'],
        },
      ],
    },
  });

  for (final changed in [false, true]) {
    test(
      'refresh retains only matching saved travel data (timetable changed: $changed)',
      () async {
        final client = RailGoClient(
          catalog,
          client: MockClient((request) async {
            if (request.url.path.endsWith('getTrainMain')) {
              return http.Response.bytes(
                utf8.encode(
                  jsonEncode({
                    'success': true,
                    'data': {
                      'numberFull': ['G21'],
                      'rundays': ['20261116'],
                      'car': 'CR400BF',
                      'timetable': [
                        for (final (station, arrival, departure) in [
                          ('北京南', '', '15:00'),
                          ('济南西', '16:23', '16:25'),
                          ('南京南', changed ? '18:30' : '18:24', ''),
                        ])
                          {
                            'station': station,
                            'day': 0,
                            'trainCode': 'G21',
                            'arrive': arrival,
                            'depart': departure,
                          },
                      ],
                    },
                  }),
                ),
                200,
              );
            }
            if (!changed && request.url.path.endsWith('mapLine')) {
              return http.Response.bytes(
                utf8.encode(
                  jsonEncode({
                    'success': true,
                    'data': {
                      'stations': [
                        for (var i = 1; i < 3; i++) {stations[i]: positions[i]},
                      ],
                      'train': {
                        '济南西-南京南': {'line': positions.sublist(1), 'index': 0},
                      },
                    },
                  }),
                ),
                200,
              );
            }
            if (!changed && request.url.path.endsWith('getCoachPic')) {
              return http.Response.bytes(
                utf8.encode(
                  jsonEncode({
                    'success': true,
                    'data': {'trainStyle': 'CR400BF'},
                  }),
                ),
                200,
              );
            }
            return http.Response('{}', 503);
          }),
        );
        addTearDown(client.close);
        final result = await client.lookup(archived);
        final journey = result['railJourney'];
        expect(result['arrivalTime'], changed ? '18:30' : '18:24');
        expect(result['railMileage'], changed ? '' : '617');
        expect(result['railTrainsets'], changed ? '' : 'CR400BF-5099');
        expect(result['gate'], changed ? '' : '16A');
        expect(result['railPlatform'], changed ? '' : '13');
        if (changed) {
          expect(result['railRoute'], '');
          expect(journey['trainsets'], isEmpty);
          expect(journey['access'], isEmpty);
          expect(journey['coaches'], '');
        } else {
          expect(result['railRoute']['fullRoute'], route['fullRoute']);
          expect(journey['trainsets'], archived['railJourney']['trainsets']);
          expect(
            journey['distanceQueriedAt'],
            archived['railJourney']['distanceQueriedAt'],
          );
          expect(
            journey['coaches']['cars'],
            archived['railJourney']['coaches']['cars'],
          );
        }
      },
    );
  }
}
