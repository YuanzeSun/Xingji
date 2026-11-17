import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:xingji/ticket_runtime_native.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'native engine produces the original renderer display vectors',
    () async {
      final archive = jsonDecode(
        await rootBundle.loadString('assets/demo.json'),
      );
      for (final record in archive['records']) {
        final expected = await rootBundle.loadString(
          'assets/tickets/${record['id']}.display.svg',
        );
        expect(await renderOriginalTicket(jsonEncode(record)), expected);
      }
    },
    skip: Platform.environment['LIBQUICKJSC_TEST_PATH'] == null
        ? 'Requires the native library built by flutter build windows/macos.'
        : false,
  );
}
