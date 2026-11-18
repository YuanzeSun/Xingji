import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji/app_store.dart';
import 'package:xingji/editor.dart';
import 'package:xingji_core/xingji_core.dart';

void main() {
  Future<(AppStore, TicketRecord)> open(
    WidgetTester tester, {
    bool withCode = true,
  }) async {
    SharedPreferences.setMockInitialValues({});
    final app = (await tester.runAsync(AppStore.load))!;
    addTearDown(app.dispose);
    final existing = app.examples.firstWhere((record) => record.isFlight);
    final sample = withCode
        ? existing
        : existing.withChanges({
            'boardingCode': '',
            'boardingCodeSource': '',
            'boardingLegIndex': '',
          });
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () => openEditor(context, app, record: sample),
              child: const Text('打开示例编辑'),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('打开示例编辑'));
    await tester.pumpAndSettle();
    return (app, sample);
  }

  Finder barcodeField(String label) => find.byWidgetPredicate(
    (widget) =>
        widget is TextField &&
        widget.decoration?.label is Text &&
        (widget.decoration!.label as Text).textSpan?.toPlainText() ==
            '$label *',
  );

  testWidgets(
    'valid barcode inputs generate a code and incomplete inputs do not block saving',
    (tester) async {
      final (app, _) = await open(tester, withCode: false);
      expect(find.byType(CheckboxListTile), findsNothing);
      final sequence = barcodeField('值机序号');
      final status = barcodeField('旅客状态代码');
      expect(find.text('条码已自动生成'), findsNothing);
      final label =
          tester.widget<TextField>(sequence).decoration!.label as Text;
      final star = (label.textSpan as TextSpan).children!.last as TextSpan;
      expect(star.style?.color, const Color(0xFF32658D));

      final englishName = barcodeField('英文姓名（姓/名）');
      await tester.ensureVisible(englishName);
      await tester.enterText(englishName, 'DOE/JANE');
      await tester.pumpAndSettle();
      await tester.ensureVisible(sequence);
      await tester.enterText(sequence, 'a25');
      await tester.pumpAndSettle();
      expect(find.text('条码已自动生成'), findsNothing);
      await tester.ensureVisible(status);
      await tester.enterText(status, '1');
      await tester.pumpAndSettle();
      expect(find.text('条码已自动生成'), findsOneWidget);

      await tester.tap(find.text('保存票据'));
      await tester.pumpAndSettle();
      final saved = app.records.single;
      expect(saved.text('boardingCodeSource'), 'generated');
      expect(saved.fieldSources['boardingCode'], 'generated');
      final decoded = decodeBoardingBytes(
        base64Decode(saved['boardingCode']['rawBytes']),
      )!;
      expect(decoded['sequence'], 'A25');
      expect(decoded['status'], '1');

      await tester.tap(find.text('打开示例编辑'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('保存票据'));
      await tester.pumpAndSettle();
      expect(app.records.single['boardingCode'], '');
    },
  );

  testWidgets(
    'clearing a barcode-only field discards the previous generated code',
    (tester) async {
      final (app, _) = await open(tester);
      final status = barcodeField('旅客状态代码');
      await tester.ensureVisible(status);
      await tester.enterText(status, '');
      await tester.pumpAndSettle();
      expect(find.text('条码已自动生成'), findsNothing);
      await tester.tap(find.text('保存票据'));
      await tester.pumpAndSettle();
      expect(app.records.single['boardingCode'], '');
      expect(app.records.single.text('boardingCodeSource'), '');
      expect(
        app.records.single.fieldSources.containsKey('boardingCode'),
        false,
      );
    },
  );

  testWidgets('editing a generated boarding pass also updates its barcode', (
    tester,
  ) async {
    final (app, sample) = await open(tester);
    final seat = find.byWidgetPredicate(
      (w) => w is TextFormField && w.controller?.text == sample.text('seat'),
    );
    await tester.ensureVisible(seat);
    await tester.enterText(seat, '33B');
    await tester.pumpAndSettle();
    await tester.tap(find.text('保存票据'));
    await tester.pumpAndSettle();
    final saved = app.records.single;
    final decoded = decodeBoardingBytes(
      base64Decode(saved['boardingCode']['rawBytes']),
    )!;
    expect(saved.text('seat'), '33B');
    final old = decodeBoardingBytes(
      base64Decode(sample['boardingCode']['rawBytes']),
    )!;
    expect(decoded['seat'], '33B');
    expect(decoded['sequence'], old['sequence']);
    expect(decoded['status'], old['status']);
  });

  testWidgets(
    'rescanning preserves the year and other locally entered fields',
    (tester) async {
      final (app, sample) = await open(tester);
      final field = find.byWidgetPredicate(
        (w) => w is TextField && w.decoration?.labelText == '粘贴解码后的条码内容',
      );
      await tester.ensureVisible(field);
      await tester.enterText(
        field,
        ascii.decode(base64Decode(sample['boardingCode']['rawBytes'])),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('解码并填入'));
      await tester.pumpAndSettle();
      final fields = tester
          .widgetList<TextFormField>(find.byType(TextFormField))
          .map((w) => w.controller?.text)
          .toList();
      expect(fields, contains('${sample.departure!.year}'));
      expect(fields, contains(sample.text('identity')));
      expect(fields, contains(sample.text('departureTime')));
      final seat = find.byWidgetPredicate(
        (w) => w is EditableText && w.controller.text == sample.text('seat'),
      );
      expect(tester.widget<EditableText>(seat).readOnly, true);
      expect(find.text('条码内容已填入并锁定。年份可以补充。'), findsOneWidget);
      expect(find.text('已使用原条码'), findsOneWidget);
      expect(tester.widget<TextField>(barcodeField('值机序号')).enabled, false);
      await tester.tap(find.text('保存票据'));
      await tester.pumpAndSettle();
      expect(app.records.single.id, sample.id);
      expect(app.records.single.text('boardingCodeSource'), 'original');
      expect(app.records.single.text('identity'), sample.text('identity'));
      expect(
        app.records.single.text('departureTime'),
        sample.text('departureTime'),
      );
    },
  );

  testWidgets('closing a modified editor offers to keep or discard the draft', (
    tester,
  ) async {
    final (app, sample) = await open(tester);
    final seat = find.byWidgetPredicate(
      (w) => w is TextFormField && w.controller?.text == sample.text('seat'),
    );
    await tester.ensureVisible(seat);
    await tester.enterText(seat, '33B');
    await tester.pumpAndSettle();
    await tester.tap(find.byType(CloseButton));
    await tester.pumpAndSettle();
    expect(find.text('放弃未保存的修改？'), findsOneWidget);
    await tester.tap(find.text('继续编辑'));
    await tester.pumpAndSettle();
    expect(find.text('33B'), findsOneWidget);
    await tester.tap(find.byType(CloseButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('放弃修改'));
    await tester.pumpAndSettle();
    expect(find.text('打开示例编辑'), findsOneWidget);
    expect(app.records, isEmpty);
  });
}
