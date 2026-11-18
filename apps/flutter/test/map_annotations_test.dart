import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji/map_annotations.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
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
