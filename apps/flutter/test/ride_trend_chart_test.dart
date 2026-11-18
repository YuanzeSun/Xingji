import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji/design.dart';
import 'package:xingji/ride_trend_chart.dart';

void main() {
  final annual = {
    for (var year = 2014; year <= 2026; year++)
      '$year': (year == 2026 ? 9 : 2, year == 2026 ? 4 : 0),
  };
  final monthly = {
    for (var month = 1; month <= 12; month++)
      '2026-${month.toString().padLeft(2, '0')}': (month, 0),
  };
  Future<void> open(
    WidgetTester tester, {
    bool empty = false,
    double textScale = 1,
    bool reduced = false,
  }) async {
    var byMonth = false;
    await tester.pumpWidget(
      MaterialApp(
        theme: archiveTheme(),
        home: MediaQuery(
          data: MediaQueryData(
            textScaler: TextScaler.linear(textScale),
            disableAnimations: reduced,
          ),
          child: Scaffold(
            body: SingleChildScrollView(
              child: StatefulBuilder(
                builder: (context, update) => RideTrendChart(
                  data: empty
                      ? {}
                      : byMonth
                      ? monthly
                      : annual,
                  monthly: byMonth,
                  onMonthlyChanged: (value) => update(() => byMonth = value),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  String readout(WidgetTester tester) => tester
      .widget<Semantics>(find.byKey(const ValueKey('ride-trend-reader')))
      .properties
      .value!;

  void focusChart(WidgetTester tester) {
    final focus = find
        .ancestor(
          of: find.byKey(const ValueKey('ride-trend-reader')),
          matching: find.byType(Focus),
        )
        .first;
    tester.widget<Focus>(focus).focusNode!.requestFocus();
  }

  testWidgets(
    'selected counts, keyboard navigation and zoom share the same data',
    (tester) async {
      await open(tester);
      expect(readout(tester), '2026年，火车9次，飞机4次');
      final plot = find.byKey(const ValueKey('ride-trend-plot'));
      final initialWidth = tester.getSize(plot).width;
      focusChart(tester);
      await tester.pump();
      await tester.sendKeyEvent(LogicalKeyboardKey.equal);
      await tester.pumpAndSettle();
      expect(tester.getSize(plot).width, greaterThan(initialWidth));
      expect(readout(tester), '2026年，火车9次，飞机4次');
      await tester.sendKeyEvent(LogicalKeyboardKey.minus);
      await tester.pumpAndSettle();
      expect(tester.getSize(plot).width, initialWidth);
      final viewport = tester.getRect(
        find.byKey(const ValueKey('ride-trend-reader')),
      );
      await tester.tapAt(viewport.center);
      await tester.pumpAndSettle();
      await tester.sendKeyEvent(LogicalKeyboardKey.home);
      await tester.pumpAndSettle();
      expect(readout(tester), '2014年，火车2次，飞机0次');
      await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
      await tester.pumpAndSettle();
      expect(readout(tester), '2015年，火车2次，飞机0次');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'monthly switch selects latest month and zero flight counts remain zero',
    (tester) async {
      await open(tester);
      await tester.tap(find.text('按月'));
      await tester.pumpAndSettle();
      expect(readout(tester), '2026年12月，火车12次，飞机0次');
      await tester.tap(find.text('按年'));
      await tester.pumpAndSettle();
      expect(readout(tester), '2026年，火车9次，飞机4次');
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('pinch changes spacing without changing period counts', (
    tester,
  ) async {
    await open(tester);
    final rect = tester.getRect(
      find.byKey(const ValueKey('ride-trend-reader')),
    );
    final plot = find.byKey(const ValueKey('ride-trend-plot'));
    final initialWidth = tester.getSize(plot).width;
    final a = await tester.startGesture(
      rect.center - const Offset(40, 0),
      pointer: 1,
    );
    final b = await tester.startGesture(
      rect.center + const Offset(40, 0),
      pointer: 2,
    );
    await tester.pump();
    await a.moveBy(const Offset(-40, 0));
    await b.moveBy(const Offset(40, 0));
    await tester.pump();
    await a.up();
    await b.up();
    await tester.pumpAndSettle();
    expect(tester.getSize(plot).width, closeTo(initialWidth * 2, 1));
    expect(tester.takeException(), isNull);
  });

  testWidgets('pinching in reaches the full date range in one viewport', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await open(tester);
    final plot = find.byKey(const ValueKey('ride-trend-plot'));
    final scrollable = find.byWidgetPredicate(
      (widget) =>
          widget is SingleChildScrollView &&
          widget.scrollDirection == Axis.horizontal,
    );
    final viewport = tester.getRect(scrollable);
    expect(tester.getSize(plot).width, viewport.width);
    focusChart(tester);
    await tester.pump();
    await tester.sendKeyEvent(LogicalKeyboardKey.equal);
    await tester.pumpAndSettle();
    expect(tester.getSize(plot).width, greaterThan(viewport.width));

    final first = await tester.startGesture(
      viewport.center - const Offset(68, 0),
      pointer: 3,
    );
    final second = await tester.startGesture(
      viewport.center + const Offset(68, 0),
      pointer: 4,
    );
    await tester.pump();
    await first.moveBy(const Offset(48, 0));
    await second.moveBy(const Offset(-48, 0));
    await tester.pump();
    await first.up();
    await second.up();
    await tester.pumpAndSettle();

    expect(tester.getSize(plot).width, viewport.width);
    expect(readout(tester), '2026年，火车9次，飞机4次');
    expect(tester.takeException(), isNull);
  });

  for (final size in [
    const Size(375, 812),
    const Size(812, 375),
    const Size(1440, 900),
  ]) {
    testWidgets(
      'chart and empty state fit $size with large text and reduced motion',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        await open(tester, textScale: 2, reduced: true);
        expect(tester.takeException(), isNull);
        await open(tester, empty: true, reduced: true);
        expect(find.text('这段时间还没有行程'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
