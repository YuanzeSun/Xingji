import 'dart:convert';
import 'dart:async';

import 'package:flutter/services.dart';

final _templates = <String>{}, _files = <String>{};
Future<void> _queue = Future.value();
Future<void> prepareRenderFonts(
  String template, {
  required FutureOr<String> Function(String) manifest,
  required FutureOr<void> Function(String, String, String) register,
}) {
  final next = _queue.then((_) async {
    if (_templates.contains(template)) return;
    final definitions = jsonDecode(await manifest(template)) as List;
    for (final definition in definitions) {
      final family = definition[0] as String, file = definition[1] as String;
      final bytes = _files.contains(file)
          ? ''
          : base64Encode(
              (await rootBundle.load('assets/fonts/$file')).buffer
                  .asUint8List(),
            );
      await register(family, bytes, file);
      _files.add(file);
    }
    _templates.add(template);
  });
  _queue = next.onError((_, _) {});
  return next;
}
