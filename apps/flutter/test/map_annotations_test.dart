import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji/apple_journey_map.dart';
import 'package:xingji/map_annotations.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'Apple Maps receives the complete list of railway label anchors',
    () async {
      final catalog = ReferenceCatalog.fromJson(
        jsonDecode(await rootBundle.loadString('assets/reference.json')),
      );
      final demo = TicketArchive.fromJson(
        jsonDecode(await rootBundle.loadString('assets/demo.json')),
      );
      final trip = demo.records.firstWhere(
        (record) => record.text('service') == 'G21',
      );
      final labels = appleMapOptions(catalog, [trip])['lineLabels'] as List;
      final railway =
          labels.singleWhere((label) => label['name'] == '京沪高速线') as Map;
      final anchors = railway['coordinates'] as List;
      expect(anchors.length, greaterThan(1));
      expect(anchors, everyElement(hasLength(2)));
      expect(
        appleMapOptions(catalog, [trip], railway: false)['lineLabels'],
        isEmpty,
      );
    },
  );

  test(
    'dense labels leave room in the overview and reveal stops at higher zoom',
    () {
      final stations = {
        for (var i = 0; i < 16; i++)
          '站$i': Offset(35 + (i % 4) * 84, 55 + (i ~/ 4) * 106),
      };
      List<MapAnnotation> labels(double zoom) => layoutMapAnnotations(
        stations: stations,
        endpoints: {'站0', '站3'},
        lines: {
          '京沪高速线': [const Offset(170, 280)],
        },
        bounds: const Rect.fromLTWH(0, 0, 360, 480),
        zoom: zoom,
      );
      final overview = labels(1), detail = labels(3);
      expect(
        overview.map((label) => label.name),
        containsAll(['京沪高速线', '站0', '站3']),
      );
      expect(overview.length, lessThan(stations.length));
      expect(detail.length, greaterThan(overview.length));
    },
  );

  test('a blocked first anchor cannot hide other visible anchors of the same railway', () {
    final labels = layoutMapAnnotations(
      stations: {'北京南': const Offset(60, 80)},
      endpoints: {'北京南'},
      lines: {
        '京沪高速线': [
          const Offset(60, 80),
          const Offset(200, 200),
          const Offset(290, 260),
        ],
      },
      bounds: const Rect.fromLTWH(8, 8, 360, 400),
      reserved: [const Rect.fromLTWH(0, 0, 150, 150)],
    );
    expect(labels.where((label) => label.railway).map((label) => label.name), [
      '京沪高速线',
    ]);
    expect(
      labels.last.box.overlaps(const Rect.fromLTWH(0, 0, 150, 150)),
      false,
    );
  });

  test('line names deduplicate, stay in bounds and do not overlap station or other line labels', () {
    final labels = layoutMapAnnotations(
      stations: {'北京南': const Offset(100, 100), '南京南': const Offset(240, 400)},
      endpoints: {'北京南', '南京南'},
      lines: {
        '京沪高速线': [const Offset(100, 100), const Offset(200, 250)],
        '宁杭高速线': [const Offset(210, 300)],
      },
      bounds: const Rect.fromLTWH(8, 8, 360, 480),
    );
    expect(labels.where((label) => label.railway), hasLength(2));
    for (var i = 0; i < labels.length; i++) {
      expect(
        const Rect.fromLTWH(8, 8, 360, 480).contains(labels[i].box.topLeft),
        true,
      );
      for (var j = i + 1; j < labels.length; j++) {
        expect(labels[i].box.overlaps(labels[j].box), false);
      }
    }
  });
}
