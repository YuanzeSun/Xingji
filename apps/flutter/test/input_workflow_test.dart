import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji/input_formatters.dart';
import 'package:xingji/design.dart';
import 'package:xingji/seat_input.dart';

void main() {
  testWidgets(
    'field labels stay above typed and programmatically filled values without waiting for animation',
    (tester) async {
      final controller = TextEditingController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        MaterialApp(
          theme: archiveTheme(),
          home: Scaffold(
            body: TextField(
              controller: controller,
              decoration: const InputDecoration(labelText: '证件号码'),
            ),
          ),
        ),
      );
      void labelIsAboveValue() {
        expect(
          tester.getTopLeft(find.text('证件号码')).dy,
          lessThan(tester.getTopLeft(find.byType(EditableText)).dy),
        );
      }

      labelIsAboveValue();
      await tester.enterText(find.byType(TextField), '11010119900101****');
      await tester.pump();
      labelIsAboveValue();
      controller.text = 'E12345678';
      await tester.pump();
      labelIsAboveValue();
      expect(tester.takeException(), isNull);
    },
  );
  test('uppercase preserves IME composition and transforms committed cursor positions', () {
    final formatter = UppercaseInput();
    const composing = TextEditingValue(
      text: 'sun',
      composing: TextRange(start: 0, end: 3),
      selection: TextSelection.collapsed(offset: 3),
    );
    expect(
      formatter.formatEditUpdate(TextEditingValue.empty, composing),
      composing,
    );
    final committed = formatter.formatEditUpdate(
      composing,
      composing.copyWith(composing: TextRange.empty),
    );
    expect(committed.text, 'SUN');
    expect(committed.selection.baseOffset, 3);
    final beforeExpansion = formatter.formatEditUpdate(
      TextEditingValue.empty,
      const TextEditingValue(
        text: 'abc',
        selection: TextSelection.collapsed(offset: 1),
      ),
    );
    expect(beforeExpansion.text, 'ABC');
    expect(beforeExpansion.selection.baseOffset, 1);
  });

  testWidgets(
    'sleeper berth survives class switches but is not saved on seated tickets',
    (tester) async {
      final controller = TextEditingController(text: '015号下铺');
      addTearDown(controller.dispose);
      Widget input(String seatClass) => MaterialApp(
        home: Scaffold(
          body: SeatInput(
            controller: controller,
            seatClass: seatClass,
            required: true,
            locked: false,
            onChanged: () {},
          ),
        ),
      );
      await tester.pumpWidget(input('硬卧'));
      expect(find.text('下铺'), findsOneWidget);
      await tester.pumpWidget(input('硬座'));
      expect(controller.text, '015');
      expect(find.byType(DropdownButtonFormField<String>), findsNothing);
      await tester.pumpWidget(input('软卧'));
      expect(controller.text, '015号下铺');
      expect(tester.takeException(), isNull);
    },
  );
}
