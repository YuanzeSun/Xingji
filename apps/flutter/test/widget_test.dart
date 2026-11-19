import 'package:flutter/foundation.dart'
    show TargetPlatform, debugDefaultTargetPlatformOverride;
import 'package:flutter/services.dart' show MethodCall, SystemChannels;
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji/main.dart';
import 'package:xingji/apple_navigation_bar.dart';
import 'package:xingji/app_store.dart';
import 'package:xingji/editor.dart';
import 'package:xingji/platform_services.dart';
import 'package:xingji/ticket_face.dart';
import 'package:xingji/ticket_detail.dart';
import 'package:xingji/settings_page.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<AppStore> store() async {
    SharedPreferences.setMockInitialValues({});
    return AppStore.load();
  }

  final addTicket = find.byWidgetPredicate(
    (widget) => widget is Icon && widget.semanticLabel == '录入票据',
  );
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

  testWidgets('welcome guide can swipe to maps and start the demo', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    final app = (await tester.runAsync(store))!;
    addTearDown(app.dispose);
    await tester.pumpWidget(XingjiApp(store: app));
    await settle(tester);

    await tester.tap(find.widgetWithText(TextButton, '使用引导'));
    await tester.pumpAndSettle();
    expect(find.text('收下第一张票'), findsOneWidget);
    await tester.drag(find.byType(PageView), const Offset(-320, 0));
    await tester.pumpAndSettle();
    expect(find.text('在地图上回看旅程'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '下一步'));
    await tester.pumpAndSettle();
    expect(find.text('做一本旅行纪念册'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, '浏览示例'));
    await settle(tester);
    expect(app.demo, isTrue);
    expect(app.privateRecords, isEmpty);
    expect(tester.takeException(), isNull);
  });

  testWidgets('welcome guide advances without motion and can be dismissed', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(320, 560);
    tester.view.devicePixelRatio = 1;
    final dispatcher = tester.binding.platformDispatcher;
    dispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(
      disableAnimations: true,
    );
    dispatcher.textScaleFactorTestValue = 2;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(dispatcher.clearAccessibilityFeaturesTestValue);
    addTearDown(dispatcher.clearTextScaleFactorTestValue);
    final app = (await tester.runAsync(store))!;
    addTearDown(app.dispose);
    await tester.pumpWidget(XingjiApp(store: app));
    await settle(tester);

    final entry = find.widgetWithText(TextButton, '使用引导');
    await tester.scrollUntilVisible(
      entry,
      96,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(entry);
    await tester.pumpAndSettle();
    expect(find.byType(TweenAnimationBuilder<double>), findsNothing);
    await tester.tap(find.widgetWithText(FilledButton, '下一步'));
    await tester.pump();
    await tester.pump();
    expect(find.text('在地图上回看旅程'), findsOneWidget);

    await tester.tap(find.byTooltip('关闭使用引导'));
    await tester.pumpAndSettle();
    expect(find.byType(PageView), findsNothing);
    expect(app.demo, isFalse);
    expect(app.privateRecords, isEmpty);
    expect(tester.takeException(), isNull);
  });

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
        expect(find.text('我的票夹'), findsOneWidget);
        expect(addTicket, findsOneWidget);
        expect(find.byKey(const ValueKey('nav-同步')), findsOneWidget);
        expect(find.text('先看看示例模式'), findsOneWidget);
        await tester.tap(find.byType(Switch));
        await settle(tester);
        expect(find.text('我的票夹'), findsOneWidget);
        expect(addTicket, findsNothing);
        expect(find.byKey(const ValueKey('nav-同步')), findsNothing);
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
        expect(find.text('我的票夹'), findsOneWidget);
        expect(find.text('先看看示例模式'), findsOneWidget);
        expect(addTicket, findsOneWidget);
        expect(tester.takeException(), isNull);
      },
    );
  }
  testWidgets('long pressing a ticket selects it in each layout', (
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
    expect(find.text('选择'), findsNothing);
    expect(find.text('导出纪念册'), findsNothing);
    final scroll = tester
        .widget<CustomScrollView>(find.byType(CustomScrollView).first)
        .controller!;
    final ticketCheckbox = find.byWidgetPredicate(
      (widget) =>
          widget is Checkbox && widget.semanticLabel?.startsWith('选择 ') == true,
    );

    for (final compact in [false, true]) {
      if (compact) {
        await tester.tap(find.byTooltip('紧凑尺寸'));
        await settle(tester);
      }
      final face = find.byType(TicketFace).first;
      await tester.ensureVisible(face);
      await tester.pumpAndSettle();
      await tester.longPress(face);
      await tester.pumpAndSettle();
      final checkbox = ticketCheckbox.first;
      final faceBounds = tester.getRect(face);
      final checkBounds = tester.getRect(checkbox);
      expect(checkBounds.topLeft, faceBounds.topLeft);
      expect(checkBounds.width, greaterThanOrEqualTo(44));
      expect(tester.widget<Checkbox>(checkbox).value, true);
      await tester.ensureVisible(checkbox);
      await tester.tap(checkbox);
      await tester.pumpAndSettle();
      expect(tester.widget<Checkbox>(checkbox).value, false);
      scroll.jumpTo(0);
      await tester.pumpAndSettle();
      await tester.tap(find.text('完成'));
      await tester.pumpAndSettle();
      expect(ticketCheckbox, findsNothing);
    }

    await tester.tap(find.byTooltip('网格展示'));
    await settle(tester);
    final row = find.textContaining(' → ').hitTestable().first;
    await tester.longPress(row);
    await tester.pumpAndSettle();
    expect(tester.widget<Checkbox>(ticketCheckbox.first).value, true);
  });

  testWidgets(
    'bound read-only library disables editing but keeps backup export',
    (tester) async {
      tester.view.physicalSize = const Size(320, 740);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final app = (await tester.runAsync(store))!;
      addTearDown(app.dispose);
      app.connection = const GitHubConnection(
        'user',
        'private',
        repositoryId: 1,
      );

      await tester.pumpWidget(XingjiApp(store: app));
      await tester.pumpAndSettle();
      expect(find.text('请重新登录 GitHub 后编辑'), findsOneWidget);
      final add = find.ancestor(
        of: addTicket,
        matching: find.byType(FilledButton),
      );
      expect(tester.widget<FilledButton>(add).onPressed, isNull);
      await tester.tap(find.text('查看同步'));
      await tester.pumpAndSettle();
      for (final label in ['姓名与常用证件', '导入票库']) {
        final button = find.widgetWithText(OutlinedButton, label);
        await tester.scrollUntilVisible(button, 180);
        expect(tester.widget<OutlinedButton>(button).onPressed, isNull);
      }
      final backup = find.widgetWithText(OutlinedButton, '导出备份');
      await tester.scrollUntilVisible(backup, 180);
      expect(tester.widget<OutlinedButton>(backup).onPressed, isNotNull);
    },
  );

  testWidgets(
    'first-binding choices disclose counts and confirm replacements',
    (tester) async {
      BindingChoice? selected;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async =>
                    selected = await chooseBinding(context, 2, 3),
                child: const Text('连接'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('连接'));
      await tester.pumpAndSettle();
      expect(find.text('本机有 2 张票据，GitHub 有 3 张票据。'), findsOneWidget);
      expect(find.text('用本机票据替换云端'), findsOneWidget);
      await tester.tap(find.text('用云端票据替换本机'));
      await tester.pumpAndSettle();
      expect(find.text('替换本机票库？'), findsOneWidget);
      await tester.tap(find.text('取消'));
      await tester.pumpAndSettle();
      expect(selected, isNull);
      await tester.tap(find.text('连接'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('合并两边的票据'));
      await tester.pumpAndSettle();
      expect(selected, BindingChoice.merge);
    },
  );

  testWidgets('sync is optional and reset is visible before authorization', (
    tester,
  ) async {
    final app = (await tester.runAsync(store))!;
    addTearDown(app.dispose);
    await tester.pumpWidget(XingjiApp(store: app));
    await settle(tester);
    await tester.tap(find.byKey(const ValueKey('nav-同步')));
    await settle(tester);
    expect(find.text('Cloudflare D1'), findsOneWidget);
    await tester.tap(find.text('连接 D1'));
    await tester.pumpAndSettle();
    expect(find.text('连接 Cloudflare D1'), findsOneWidget);
    await tester.tap(find.text('取消'));
    await tester.pumpAndSettle();
    final github = find.text('GitHub 私有仓库');
    await tester.scrollUntilVisible(github, 160);
    expect(
      tester.getTopLeft(find.text('Cloudflare D1')).dy,
      lessThan(tester.getTopLeft(github).dy),
    );
    await tester.scrollUntilVisible(find.text('连接 GitHub'), 100);
    await tester.tap(find.text('连接说明'));
    await tester.pumpAndSettle();
    expect(find.text('1. 新建私有仓库'), findsOneWidget);
    expect(find.textContaining('Contents 权限设为 Read and write'), findsOneWidget);
    await tester.tap(find.text('完成'));
    await tester.pumpAndSettle();
    final reset = find.text('重置 GitHub 仓库');
    await tester.scrollUntilVisible(reset, 200);
    expect(find.text('导出旅行手册'), findsNothing);
    expect(
      tester
          .widget<OutlinedButton>(
            find.widgetWithText(OutlinedButton, '重置 GitHub 仓库'),
          )
          .onPressed,
      isNull,
    );
    expect(app.connection, isNull);
  });

  testWidgets('the iOS tab bar remains visible and inactive under a dialog', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    final messenger = tester.binding.defaultBinaryMessenger;
    messenger.setMockMethodCallHandler(
      SystemChannels.platform_views,
      (_) async => null,
    );
    addTearDown(() {
      debugDefaultTargetPlatformOverride = null;
      messenger.setMockMethodCallHandler(SystemChannels.platform_views, null);
    });
    final app = (await tester.runAsync(store))!;
    addTearDown(app.dispose);
    await tester.pumpWidget(XingjiApp(store: app));
    await tester.pumpAndSettle();
    final bar = find.byType(AppleNavigationBar);
    expect(tester.widget<AppleNavigationBar>(bar).interactive, true);

    final shell = tester.element(find.byType(ArchiveShell));
    final dialog = showDialog<void>(
      context: shell,
      builder: (_) => const AlertDialog(title: Text('测试弹窗')),
    );
    await tester.pumpAndSettle();
    expect(tester.widget<AppleNavigationBar>(bar).interactive, false);
    expect(find.byType(UiKitView), findsOneWidget);
    Navigator.of(shell).pop();
    await tester.pumpAndSettle();
    await dialog;
    expect(tester.widget<AppleNavigationBar>(bar).interactive, true);
  });

  testWidgets('rail capture is opened by the shutter in the editor', (
    tester,
  ) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    addTearDown(() => debugDefaultTargetPlatformOverride = null);
    final app = (await tester.runAsync(store))!;
    addTearDown(app.dispose);
    final messenger = tester.binding.defaultBinaryMessenger;
    final pickerCalls = <String>[];
    messenger.setMockMethodCallHandler(AppleServices.channel, (call) async {
      pickerCalls.add(call.method);
      return null;
    });
    messenger.setMockMethodCallHandler(
      SystemRecognition.channel,
      (call) async => fail(
        'Unexpected recognition call before taking a photo: ${call.method}',
      ),
    );
    addTearDown(() {
      messenger.setMockMethodCallHandler(AppleServices.channel, null);
      messenger.setMockMethodCallHandler(SystemRecognition.channel, null);
    });
    await tester.pumpWidget(MaterialApp(home: TicketEditor(app)));
    await tester.pumpAndSettle();
    expect(pickerCalls, isEmpty);
    await tester.tap(find.text('拍照识别'));
    await tester.pumpAndSettle();
    expect(pickerCalls, ['captureTicketPhoto']);
    await tester.tap(find.text('拍照识别'));
    await tester.pumpAndSettle();
    expect(pickerCalls, ['captureTicketPhoto', 'captureTicketPhoto']);
    await tester.tap(find.text('机票'));
    await tester.pumpAndSettle();
    expect(find.text('拍照识别'), findsNothing);
    await tester.tap(find.text('相机扫码'));
    await tester.pumpAndSettle();
    expect(pickerCalls, [
      'captureTicketPhoto',
      'captureTicketPhoto',
      'scanBoardingCode',
    ]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('plus opens the three entry choices and paste fills the editor', (
    tester,
  ) async {
    final app = (await tester.runAsync(store))!;
    addTearDown(app.dispose);
    final messenger = tester.binding.defaultBinaryMessenger;
    const message = '航班 CA181，12月5日从北京首都飞东京羽田';
    messenger.setMockMethodCallHandler(SystemChannels.platform, (
      MethodCall call,
    ) async {
      return call.method == 'Clipboard.getData' ? {'text': message} : null;
    });
    messenger.setMockMethodCallHandler(SystemRecognition.channel, (call) async {
      if (call.method == 'capabilities') return {'appleIntelligence': true};
      expect(call.method, 'extractTicketText');
      expect(call.arguments['text'], message);
      return {
        'type': 'flight',
        'service': 'CA181',
        'origin': 'PEK',
        'destination': 'HND',
      };
    });
    addTearDown(() {
      messenger.setMockMethodCallHandler(SystemChannels.platform, null);
      messenger.setMockMethodCallHandler(SystemRecognition.channel, null);
    });
    await tester.pumpWidget(XingjiApp(store: app));
    await tester.pumpAndSettle();
    await tester.tap(addTicket);
    await tester.pumpAndSettle();
    for (final title in ['录入', '上传', '粘贴']) {
      expect(find.text(title), findsOneWidget);
    }
    await tester.tap(find.text('粘贴'));
    await tester.pumpAndSettle();
    expect(find.byType(TicketEditor), findsOneWidget);
    expect(find.text('CA181'), findsOneWidget);
    expect(find.text('票面样式'), findsNothing);
    expect(find.text('扫描'), findsNothing);
    expect(app.privateRecords, isEmpty);
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
      expect(find.text('扫描'), findsNothing);
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
