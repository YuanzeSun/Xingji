import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji/main.dart';
import 'package:xingji/app_store.dart';
import 'package:xingji/editor.dart';
import 'package:xingji/ticket_face.dart';
import 'package:xingji/ticket_detail.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<AppStore> store() async {
    SharedPreferences.setMockInitialValues({});
    return AppStore.load();
  }

  Future<void> settle(WidgetTester tester) async {
    // SVG decoding uses a real worker; let its result reach the fake test clock.
    for (var i = 0; i < 6; i++) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 100)),
      );
      await tester.pump(const Duration(milliseconds: 100));
    }
    await tester.pumpAndSettle();
  }

  testWidgets(
    'saved train journey shows station names, mileage and ridden interval',
    (tester) async {
      final app = (await tester.runAsync(store))!;
      addTearDown(app.dispose);
      app.setDemo(true);
      await tester.pumpWidget(
        MaterialApp(home: TicketDetail(app, app.examples.first)),
      );
      await settle(tester);
      final table = tester.widget<DataTable>(find.byType(DataTable));
      expect(find.text('济南西'), findsOneWidget);
      expect(find.text('406'), findsOneWidget);
      expect(table.rows.take(3).every((row) => row.color != null), isTrue);
      expect(table.rows.skip(3).every((row) => row.color == null), isTrue);
    },
  );

  for (final size in [
    const Size(320, 740),
    const Size(375, 812),
    const Size(768, 1024),
    const Size(1440, 960),
    const Size(812, 375),
  ]) {
    testWidgets(
      'example navigation fits $size without exposing private records',
      (tester) async {
        tester.view.physicalSize = size;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        final app = (await tester.runAsync(store))!;
        addTearDown(app.dispose);
        await tester.pumpWidget(XingjiApp(store: app));
        await settle(tester);
        expect(find.text('先看看示例模式'), findsOneWidget);
        await tester.ensureVisible(find.text('先看看示例模式'));
        await tester.tap(find.text('先看看示例模式'));
        await settle(tester);
        expect(find.text('我的票夹'), findsOneWidget);
        expect(find.text('录入票据'), findsNothing);
        expect(app.privateRecords, isEmpty);
        if (size.height > 500) expect(find.byType(TicketFace), findsWidgets);
        for (final label in ['地图', '统计', '票夹']) {
          await tester.tap(find.byKey(ValueKey('nav-$label')));
          await settle(tester);
          if (label == '统计') {
            final start = tester.getRect(
              find.widgetWithText(TextButton, '起始日期'),
            );
            final end = tester.getRect(find.widgetWithText(TextButton, '截止日期'));
            expect(start.center.dy, closeTo(end.center.dy, 1));
            expect(start.right, lessThan(end.left));
            expect(start.height, greaterThanOrEqualTo(48));
            expect(end.height, greaterThanOrEqualTo(48));
          }
          expect(tester.takeException(), isNull);
        }
        await tester.tap(find.byType(Switch));
        await settle(tester);
        expect(find.text('先看看示例模式'), findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('ticket selection stays at the top left in both grid sizes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final app = (await tester.runAsync(store))!;
    app.setDemo(true);
    addTearDown(app.dispose);
    await tester.pumpWidget(XingjiApp(store: app));
    await settle(tester);
    await tester.tap(find.text('选择'));
    await settle(tester);

    for (final compact in [false, true]) {
      if (compact) {
        tester
            .widget<CustomScrollView>(find.byType(CustomScrollView).first)
            .controller!
            .jumpTo(0);
        await tester.pumpAndSettle();
        await tester.tap(find.text('整理'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('紧凑尺寸'));
        await tester.pumpAndSettle();
        await tester.tap(find.widgetWithText(FilledButton, '完成'));
        await settle(tester);
      }
      final face = find.byType(TicketFace).first;
      await tester.ensureVisible(face);
      await tester.pumpAndSettle();
      final checkbox = find
          .byWidgetPredicate(
            (widget) =>
                widget is Checkbox &&
                widget.semanticLabel?.startsWith('选择 ') == true,
          )
          .first;
      final faceBounds = tester.getRect(face);
      final checkBounds = tester.getRect(checkbox);
      expect(checkBounds.topLeft, faceBounds.topLeft);
      expect(checkBounds.width, greaterThanOrEqualTo(44));
      await tester.ensureVisible(checkbox);
      await tester.tap(checkbox);
      await tester.pumpAndSettle();
      expect(tester.widget<Checkbox>(checkbox).value, !compact);
    }
  });

  testWidgets(
    'empty submission keeps form and displays explicit required errors',
    (tester) async {
      final app = (await tester.runAsync(store))!;
      addTearDown(app.dispose);
      await tester.pumpWidget(
        MaterialApp(theme: ThemeData(), home: TicketEditor(app)),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('保存票据'));
      await tester.pumpAndSettle();
      expect(find.text('请补全下方标红的必填项'), findsOneWidget);
      expect(app.privateRecords, isEmpty);
      final service = find
          .byType(TextFormField)
          .evaluate()
          .map((e) => e.widget as TextFormField)
          .firstWhere((w) => w.controller?.text == '');
      service.controller?.text = 'G21';
      await tester.tap(find.text('机票'));
      await tester.pumpAndSettle();
      expect(find.text('票面样式'), findsNothing);
      expect(find.text('登机牌条码或电子登机牌二维码'), findsOneWidget);
      expect(find.text('G21'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets('large system text does not overflow archive chrome', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(375, 812);
    tester.view.devicePixelRatio = 1;
    tester.platformDispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    final app = (await tester.runAsync(store))!;
    app.setDemo(true);
    addTearDown(app.dispose);
    await tester.pumpWidget(XingjiApp(store: app));
    await settle(tester);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const ValueKey('nav-统计')));
    await settle(tester);
    final start = tester.getRect(find.widgetWithText(TextButton, '起始日期'));
    final end = tester.getRect(find.widgetWithText(TextButton, '截止日期'));
    expect(start.center.dy, closeTo(end.center.dy, 1));
    expect(tester.takeException(), isNull);
  });
}
