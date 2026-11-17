import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:xingji/app_store.dart';
import 'package:xingji/export_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
    'travel book generates all example ticket types with bundled fonts',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = await AppStore.load();
      final bytes = await travelBook(store.examples, store.catalog);
      expect(ascii.decode(bytes.take(5).toList()), '%PDF-');
      expect(bytes.length, greaterThan(10000));
      final preview = Platform.environment['XINGJI_PDF_PREVIEW'];
      if (preview != null) await File(preview).writeAsBytes(bytes);
      store.dispose();
    },
  );
}
