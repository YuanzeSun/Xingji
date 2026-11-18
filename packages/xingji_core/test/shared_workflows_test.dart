import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final catalog = ReferenceCatalog.fromJson(
    jsonDecode(
      File('../../apps/flutter/assets/reference.json').readAsStringSync(),
    ),
  );
  final profile = personalProfile({
    'chineseName': '示例旅客',
    'lastName': 'sun',
    'firstName': 'yuanze',
    'documents': [
      {'id': 'id', 'type': 'national-id', 'number': '11010119900101****'},
      {'id': 'passport', 'type': 'passport', 'number': 'E12345678'},
    ],
  });
  TicketRecord flight(String from, String to) => TicketRecord.create({
    'type': 'flight',
    'template': 'air-boarding-pass',
    'origin': from,
    'destination': to,
  });

  test('profile selects Chinese domestic names and passport names abroad', () {
    final domestic = applyProfileDefaults(
      flight('XNN', 'XIY'),
      profile,
      catalog,
    );
    expect(domestic.text('passenger'), '示例旅客');
    expect(domestic.text('identity'), '11010119900101****');
    final international = applyProfileDefaults(
      flight('PEK', 'VIE'),
      profile,
      catalog,
    );
    expect(international.text('passenger'), 'SUN/YUANZE');
    expect(international.text('identity'), 'E12345678');
    final changed = applyProfileDefaults(
      domestic.withChanges({'origin': 'PEK', 'destination': 'VIE'}),
      profile,
      catalog,
    );
    expect(changed.text('passenger'), 'SUN/YUANZE');
    final manual = domestic.withChanges({
      'passenger': '手动姓名',
      'fieldSources': {'passenger': 'manual'},
    });
    expect(
      applyProfileDefaults(manual, profile, catalog).text('passenger'),
      '手动姓名',
    );
    expect(
      applyProfileDefaults(flight('PEK', 'VIE'), {
        ...profile,
        'autoFill': false,
      }, catalog).text('passenger'),
      '',
    );
  });

  test('settings merge preserves independent changes and requires explicit conflicting choices', () {
    final base = sharedSettings({
      'profile': profile,
      'flightMcpKey': 'original',
    });
    final local = {
      ...base,
      'profile': personalProfile({...profile, 'chineseName': '新姓名'}),
    };
    final remote = {...base, 'flightMcpKey': 'new-key'};
    final merge = mergeSettings(base, local, remote);
    expect(merge.conflicts, isEmpty);
    expect(merge.settings['profile']['chineseName'], '新姓名');
    expect(merge.settings['flightMcpKey'], 'new-key');
    final conflict = mergeSettings(base, local, {
      ...base,
      'profile': personalProfile({...profile, 'chineseName': '另一姓名'}),
    });
    expect(() => conflict.resolve({}), throwsStateError);
    expect(
      conflict.resolve({'settings:profile': true})['profile']['chineseName'],
      '另一姓名',
    );
    expect(
      () => personalProfile({
        'documents': [
          {'id': 'x', 'type': 'passport', 'expiry': '2026-02-30'},
        ],
      }),
      throwsFormatException,
    );
  });

  test('exact railway station names beat city aliases and models group consistently', () {
    expect(catalog.resolve('北京', '', flight: false)?.name, '北京');
    expect(catalog.resolve('上海', '', flight: false)?.name, '上海');
    expect(catalog.resolve('北京南', '', flight: false)?.name, '北京南');
    expect(catalog.aircraft('DH8D'), 'DHC-8-400');
    expect(catalog.aircraft('DHC-8-400', family: true), 'DHC-8');
    expect(catalog.aircraft('737-800', family: true), '737');
    expect(catalog.aircraft('737-200', family: true), '737');
    expect(catalog.aircraft('A320-200', family: true), 'A320');
  });

  test(
    'CSV import preserves dates, snapshots, quotes and formula-like text',
    () {
      final record = TicketRecord.create({
        'id': 'csv-test',
        'service': 'G21',
        'origin': '北京南',
        'destination': '南京南',
        'departureDate': JourneyDate.calendar(2026, 11, 16).toJson(),
        'passenger': '=SUM(1,2)\n"名字"',
        'price': '-25',
        'railJourney': {
          'query': {'trainNum': 'G21'},
          'stops': [],
        },
        'railRoute': {
          'segments': [
            [
              [116, 39],
              [118, 32],
            ],
          ],
          'lineLabels': [
            {'name': '京沪高速线'},
          ],
        },
      });
      final csv = [
        'id,mergedIds,service,departureDate,passenger,price,railRoute,railJourney,boardingCode',
        [
          record.id,
          '[]',
          record.text('service'),
          jsonEncode(record['departureDate']),
          "'${record.text('passenger')}",
          "'${record.text('price')}",
          jsonEncode(record['railRoute']),
          jsonEncode(record['railJourney']),
          '""',
        ].map((cell) => '"${cell.replaceAll('"', '""')}"').join(','),
      ].join('\r\n');
      final decoded = parseTicketCsv(csv).single;
      for (final key in [
        'id',
        'service',
        'passenger',
        'price',
        'departureDate',
        'railRoute',
        'railJourney',
      ]) {
        expect(decoded[key], record[key], reason: key);
      }
      expect(
        () => parseTicketCsv('车次,出发日期\nG21,2026-02-30'),
        throwsFormatException,
      );
      expect(() => parseTicketCsv('车次\n"G21'), throwsFormatException);
    },
  );

  test('combined rail OCR retains QR bytes and berth without confusing actual flight times', () {
    final raw = base64Encode(utf8.encode('铁路原始数据'));
    final code = normalizeCodeData({
      'version': 1,
      'format': 'QRCode',
      'rawBytes': raw,
      'symbologyIdentifier': ']Q1',
      'gs1': false,
      'eci': [],
      'parameters': {
        'symbolVersion': '5',
        'errorCorrectionLevel': 'M',
        'mask': 3,
      },
    });
    final text =
        '北京南站 南京南站\n车次 G21\n2026年11月16日15:00开\n05车008号下铺 硬卧\n￥503.0元\n11010119900101**** 示例旅客\n仅供报销使用';
    RecognitionResult result(String value, {bool qr = false}) =>
        RecognitionResult.fromJson({
          'lines': [
            {
              'text': value,
              'x': 0,
              'y': 0,
              'width': 1,
              'height': 1,
              'confidence': 1,
            },
          ],
          'barcodes': qr
              ? [
                  {'rawBytes': raw, 'codeData': code},
                ]
              : [],
        });
    final record = parseRecognition(
      result(text, qr: true),
      catalog,
      flight: false,
    ).single;
    expect(record.text('origin'), '北京南');
    expect(record.text('destination'), '南京南');
    expect(record.text('seat'), '008号下铺');
    expect(record['ticketCode'], code);
    expect(record.departure!.calendarText, '2026-11-16');
    expect(record.text('departureTime'), '15:00');
    final actual = parseRecognition(
      result('航班 CA181\nPEK VIE\n实际起飞时间 15:42\n实际到达时间 20:03'),
      catalog,
      flight: true,
    ).single;
    expect(actual.text('departureTime'), '');
    expect(actual.text('arrivalTime'), '');
    expect(actual.text('actualDepartureTime'), '15:42');
    expect(actual.text('actualArrivalTime'), '20:03');
    expect(
      parseTicketText(
        '车次 G21\n\n出发日期 2026-11-16\n北京南 南京南\n\n票价 ￥503.0',
        catalog,
        flight: false,
      ),
      hasLength(1),
    );
  });

  test('RailGo uses an explicit previous-day start when the boarding date has no service', () async {
    final mainDates = <String>[];
    final client = MockClient((request) async {
      if (!request.url.path.endsWith('getTrainMain'))
        return http.Response('{}', 404);
      final date = request.url.queryParameters['date']!;
      mainDates.add(date);
      if (date != '20261116') return http.Response('{}', 404);
      return http.Response(
        jsonEncode({
          'success': true,
          'data': {
            'numberFull': ['Z83'],
            'rundays': ['20261116'],
            'timetable': [
              {'station': '北京', 'depart': '22:00', 'day': 0},
              {
                'station': '哈尔滨',
                'arrive': '06:10',
                'depart': '06:15',
                'day': 1,
              },
              {'station': '齐齐哈尔', 'arrive': '08:30', 'day': 1},
            ],
          },
        }),
        200,
        headers: {'content-type': 'application/json; charset=utf-8'},
      );
    });
    final api = RailGoClient(catalog, client: client);
    addTearDown(api.close);
    final boarding = JourneyDate.calendar(2026, 11, 17);
    final record = TicketRecord.create({
      'service': 'Z83',
      'origin': '哈尔滨',
      'destination': '齐齐哈尔',
      'departureDate': boarding.toJson(),
    });
    await expectLater(api.lookup(record), throwsFormatException);
    final result = await api.lookup(
      record,
      startDate: JourneyDate.calendar(2026, 11, 16),
    );
    expect(mainDates, ['20261117', '20261116']);
    expect(result['departureTime'], '06:15');
    expect(result['arrivalTime'], '08:30');
    expect(result['arrivalDate'], boarding.toJson());
  });

  for (final mismatch in [false, true]) {
    test(
      'RailGo validates mileage schedule and only retains single-car diagram links (mismatch=$mismatch)',
      () async {
        final requests = <Uri>[];
        final stops = [
          {
            'station': '北京南',
            'day': 0,
            'arrive': '--:--',
            'depart': '15:00',
            'distance': 0,
          },
          {
            'station': '南京南',
            'day': 0,
            'arrive': mismatch ? '18:25' : '18:24',
            'depart': '18:26',
            'distance': 1023,
          },
        ];
        final client = MockClient((request) async {
          requests.add(request.url);
          final dynamic data;
          if (request.url.path.endsWith('getTrainMain')) {
            data = {
              'success': true,
              'data': {
                'numberFull': ['G21'],
                'rundays': ['20261116'],
                'car': '25TDC600V',
                'timetable': [
                  {...stops[0]},
                  {...stops[1], 'arrive': '18:24'},
                ],
              },
            };
          } else if (request.url.path.endsWith('/train/query')) {
            data = {
              'data': {
                'numberFull': ['G21'],
                'rundays': ['20261116'],
                'timetable': stops,
              },
            };
          } else if (request.url.path.endsWith('getCoachPic')) {
            data = {
              'success': true,
              'data': {
                'coachPicList': [
                  {
                    'pictureName': '01车厢',
                    'pictureUrl': 'https://res.railgo.zenglingkun.cn/car.png',
                  },
                  {
                    'pictureName': '02车厢',
                    'pictureUrl': 'https://other.example/car.png',
                  },
                ],
                'carInfo': [
                  {'pictureName': '电源插座', 'pictureValue': '有'},
                  {'pictureName': '婴儿护理台', 'pictureValue': '有'},
                  {'pictureName': '无障碍卫生间', 'pictureValue': '有'},
                ],
              },
            };
          } else {
            return http.Response('{}', 404);
          }
          return http.Response(
            jsonEncode(data),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        });
        final api = RailGoClient(catalog, client: client);
        final values = await api.lookup(
          TicketRecord.create({
            'origin': '北京南',
            'destination': '南京南',
            'service': 'G21',
            'departureDate': JourneyDate.calendar(2026, 11, 16).toJson(),
          }),
        );
        expect(values['railMileage'], mismatch ? isNull : '1023');
        final coach = values['railJourney']['coaches'];
        expect(coach['cars'], hasLength(1));
        expect(coach['info'], [
          {'name': '电源插座', 'value': '有'},
        ]);
        expect(requests.any((uri) => uri.path.endsWith('.png')), false);
        api.close();
      },
    );
  }
}
