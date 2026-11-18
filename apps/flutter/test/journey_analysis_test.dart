import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji/app_store.dart';
import 'package:xingji/journey_statistics.dart';
import 'package:xingji/map_page.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  final catalog = ReferenceCatalog.fromJson({
    'stations': [],
    'airports': [
      {
        'id': 'PEK',
        'code': 'PEK',
        'name': '北京首都',
        'aliases': ['首都机场'],
        'coordinates': [116.6, 40.1],
      },
      {
        'id': 'SFO',
        'code': 'SFO',
        'name': 'San Francisco International Airport',
        'aliases': ['San Francisco'],
        'coordinates': [-122.4, 37.6],
      },
    ],
    'airlines': [],
  });
  final date = JourneyDate.calendar(2025, 10, 1).toJson();
  final outbound = TicketRecord.create({
    'type': 'flight',
    'departureDate': date,
    'origin': '首都机场',
    'destination': 'San Francisco',
    'aircraft': '737-800',
  });
  final inbound = TicketRecord.create({
    'type': 'flight',
    'departureDate': date,
    'origin': 'SFO',
    'destination': 'PEK',
    'aircraft': '737-200',
  });

  test('statistics use known date intervals, deduplicated models, and canonical routes', () {
    final rails = [
      TicketRecord.create({
        'departureDate': JourneyDate(2024, null).toJson(),
        'railModel': '25G / 25T / 25G',
        'railPowerSupply': ' dc 600v ',
        'railMileage': '12.25',
        'railBureau': '北京铁路局',
        'railCarOwner': '北京车辆段',
      }),
      TicketRecord.create({
        'departureDate': date,
        'railModel': '25Ｔ',
        'railBureau': '中国铁路北京局集团有限公司',
      }),
      TicketRecord.create({
        'template': 'rail-refund-receipt',
        'departureDate': date,
        'railMileage': '500',
      }),
    ];
    JourneyStatistics statistics({
      bool monthly = false,
      bool merge = true,
      DateTime? from,
    }) => JourneyStatistics(
      [
        ...rails,
        outbound,
        inbound,
        inbound.withChanges({'flightStatus': 'open'}),
      ],
      catalog,
      until: DateTime(2025, 12, 31),
      from: from,
      monthly: monthly,
      supply: true,
      subtype: false,
      owner: true,
      mergeDirections: merge,
    );

    final aggregated = statistics();
    expect(aggregated.railMileage, 12.25);
    expect(aggregated.railMileageTrips, 1);
    expect(aggregated.models, {
      '25G · DC600V': 1,
      '25T · DC600V': 1,
      '25T · 供电制式未知': 1,
    });
    expect(aggregated.bureaus, {'北京局 · 北京车辆段': 1, '北京局 · 单位未收录': 1});
    expect(aggregated.buckets, {'2024': (1, 0), '2025': (1, 2)});
    expect(aggregated.routes.values, [2]);
    expect(statistics(merge: false).routes.values, [1, 1]);
    expect(statistics(from: DateTime(2024, 6)).railMileageTrips, 0);
    expect(statistics(monthly: true).buckets['2025-10'], (1, 2));
    expect(statistics(monthly: true).buckets.containsKey('2024-01'), false);
  });

  testWidgets(
    'cross-Pacific arcs meet their markers and repeats have distinct curves',
    (tester) async {
      SharedPreferences.setMockInitialValues({});
      final store = AppStore(
        await SharedPreferences.getInstance(),
        catalog,
        [],
        {},
      );
      addTearDown(store.dispose);
      final transform = TransformationController();
      addTearDown(transform.dispose);
      JourneyPainter painter({required bool routes}) => JourneyPainter(
        JourneyCanvas(
          store,
          [outbound, inbound],
          airRoutes: routes,
          flights: !routes,
        ),
        Path(),
        Path(),
        Path(),
        transform,
        1,
      );
      final routes = painter(routes: true).geometry;
      final flights = painter(routes: false).geometry;
      expect(routes.links, hasLength(1));
      expect(flights.links, hasLength(2));
      expect(flights.links.map((link) => link.control).toSet(), hasLength(2));
      for (final link in flights.links) {
        expect(link.from, flights.nodes['北京首都']);
        expect(link.to, flights.nodes['San Francisco International Airport']);
        expect((link.to.dx - link.from.dx).abs(), lessThan(400));
      }
      expect(flights.bounds.width, lessThan(400));
    },
  );
}
