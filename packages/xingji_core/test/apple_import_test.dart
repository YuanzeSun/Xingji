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

  test(
    '12306 notice infers New Year from delivery, with a narrow time window',
    () {
      const text = '【铁路12306】购票成功，1月2日 G21次 北京南站08:30开，上海虹桥站到，05车08F。';
      final result = parseTravelMessage(
        text,
        catalog,
        receivedAt: DateTime.utc(2026, 12, 28),
      );
      expect(result.automatic, isTrue);
      final row = result.records.single;
      expect(row.departure?.calendarText, '2027-01-02');
      expect(row.text('departureTime'), '08:30');
      expect(row.text('origin'), '北京南');
      expect(row.text('destination'), '上海虹桥');
      expect(parseTravelMessage(text, catalog).automatic, isFalse);
      expect(
        parseTravelMessage('【铁路12306】退票成功。$text', catalog).automatic,
        isFalse,
      );
      expect(
        parseTravelMessage('【铁路12306】您的验证码是 123456。', catalog).records,
        isEmpty,
      );
    },
  );

  test(
    'flight booking requires a clear single flight, date, airports and time',
    () {
      const text = '出票成功，航班号：CA181，2026-11-19，出发机场：PEK，到达机场：HND，起飞时间：08:30。';
      final result = parseTravelMessage(text, catalog);
      expect(result.automatic, isTrue);
      expect(result.records.single.text('originCode'), 'PEK');
      expect(result.records.single.text('destinationCode'), 'HND');
      expect(parseTravelMessage('$text 转乘 MU5201', catalog).automatic, isFalse);
    },
  );

  test(
    'OCR text does not pair unrelated locations or pick an arbitrary service',
    () {
      final fields = readTravelFields(
        '旅客可在北京南站换乘\n南京南站设有客服点\nG21 或 G22\n11010119900101****',
        catalog,
        flight: false,
      );
      expect(fields, isNot(contains('origin')));
      expect(fields, isNot(contains('destination')));
      expect(fields, isNot(contains('service')));
      expect(fields, isNot(contains('identity')));
    },
  );

  test('Apple Intelligence only fills blank fields found in OCR output', () {
    final current = TicketRecord.create({'type': 'flight', 'service': 'CA181'});
    final result = supplementRecognition(
      current,
      {
        'service': 'CA182',
        'origin': 'PEK',
        'destination': 'SFO',
        'departureDate': '2026-11-19',
        'departureTime': '08:30',
      },
      'CA181 CA182 PEK → HND 2026-11-19 08:30',
      catalog,
    );
    expect(result.text('service'), 'CA181');
    expect(result.text('originCode'), 'PEK');
    expect(result.text('destination'), isEmpty);
    expect(result.departure?.calendarText, '2026-11-19');
    expect(result.text('departureTime'), '08:30');
  });

  test(
    'scanned train layouts distinguish red, blue, and reimbursement tickets',
    () {
      for (final (color, footer, year, expected) in [
        ('red', '限乘当日当次车', 2012, 'rail-red-classic'),
        ('red', '限乘当日当次车', 2017, 'rail-red'),
        ('blue', '限 乘 当 日 当 次 车', 2019, 'rail-blue'),
        ('', '限乘当日当次车', 2019, 'rail-blue'),
        ('blue', '仅 供 报 销 使 用', 2023, 'rail-receipt'),
        ('blue', '报销凭证\n退 票 费', 2023, 'rail-refund-receipt'),
      ]) {
        final ticket = parseRecognition(
          RecognitionResult(
            paperColor: color,
            lines: [
              RecognitionLine(
                'X000001 检票:16A\n北 京 南 站 G21 南 京 南 站\n'
                '${year}年11月18日 15:00开 05车08F号\n￥503.0元 二等座\n$footer',
                0,
                0,
                1,
                1,
                .99,
              ),
            ],
          ),
          catalog,
          flight: false,
        ).single;
        expect(ticket.text('template'), expected);
        expect(ticket.text('origin'), '北京南');
        expect(ticket.text('destination'), '南京南');
        expect(ticket.text('service'), 'G21');
        expect(ticket.text('departureTime'), '15:00');
        expect(ticket.text('gate'), '16A');
        expect(ticket.text('seat'), '08F');
      }
    },
  );

  test('rail photo regions recover station names, serials and marks on a standing ticket', () {
    final record = parseRecognition(
      RecognitionResult(
        paperColor: 'blue',
        lines: [RecognitionLine('G21\n05车无座 二等座\n仅供报销使用', 0, 0, 1, 1, .88)],
        railRegions: {
          'origin': '北 京 南 站',
          'destination': 'Nanjingnan',
          'ticketNumber': 'Z123 P000001',
          'saleCode': '12345678900001 X000001 南京南站售',
          'ticketMarks': '网折\n孩',
        },
      ),
      catalog,
      flight: false,
    ).single;
    expect(record.text('origin'), '北京南');
    expect(record.text('destination'), '南京南');
    expect(record.text('ticketNumber'), 'Z123P000001');
    expect(record.text('saleCode'), '12345678900001X000001');
    expect((record['ticketMarks'] as List).map((mark) => mark['text']), [
      '网',
      '折',
      '孩',
    ]);
    expect(record.railStanding, true);
    expect(record.text('seatClass'), '二等座');
    expect(record.missingFields, isNot(contains('seat')));
  });

  test(
    'VariFlight negotiates session and maps MCP event results for review',
    () async {
      var requests = 0;
      final client = VariFlight(
        'test-key',
        client: MockClient((request) async {
          requests++;
          final rpc = jsonDecode(request.body) as Map;
          expect(request.url.host, 'c-gw.variflight.com');
          expect(request.headers['Authorization'], 'Bearer test-key');
          if (requests == 1) {
            expect(rpc['method'], 'initialize');
            return http.Response(
              '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}',
              200,
              headers: {'mcp-session-id': 'sample-session'},
            );
          }
          expect(request.headers['Mcp-Session-Id'], 'sample-session');
          if (requests == 2) {
            expect(rpc['method'], 'notifications/initialized');
            expect(rpc.containsKey('id'), isFalse);
            return http.Response('', 202);
          }
          expect(rpc['params'], {
            'name': 'queryUserHistoryTrip',
            'arguments': {'identityType': 0, 'year': '2024'},
          });
          final response = jsonEncode({
            'id': 2,
            'result': {
              'structuredContent': {
                'kind': 'collection',
                'items': [
                  {
                    'FlightNo': 'CA181',
                    'FlightDepcode': 'PEK',
                    'FlightArrcode': 'HND',
                    'FlightDeptimePlanDate': '2024-11-01 08:30:00',
                  },
                  {'unexpected': 'payload'},
                ],
              },
            },
          });
          return http.Response(
            'data: $response\n\n',
            200,
            headers: {'content-type': 'text/event-stream'},
          );
        }),
      );
      addTearDown(client.close);
      final result = parseVariFlightTrips(
        await client.trips(year: 2024),
        catalog,
      );
      expect(result.complete, isFalse);
      final row = result.records.single;
      expect(row.departure?.calendarText, '2024-11-01');
      expect(row.text('departureTime'), '08:30');
      expect(row.text('originCode'), 'PEK');
      expect(requests, 3);
    },
  );
}
