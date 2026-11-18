import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:isolate';

import 'package:flutter/services.dart';
import 'package:quickjs_engine/quickjs_engine.dart';

import 'ticket_runtime_fonts.dart';

// Font parsing and SVG generation run off the UI thread. This worker owns its
// engine, native resources and font caches for the lifetime of the application.
Future<_TicketWorker>? _worker;

class _TicketWorker {
  final SendPort commands;
  final Map<int, Completer<String>> requests;
  int next = 2;
  _TicketWorker(this.commands, this.requests);
  static Future<_TicketWorker> start() async {
    final source = await rootBundle.loadString('assets/renderer.js');
    final replies = ReceivePort(),
        ready = Completer<_TicketWorker>(),
        requests = <int, Completer<String>>{};
    SendPort? commands;
    replies.listen((dynamic raw) {
      final packet = raw as List, id = packet[0] as int;
      if (id == 0) {
        commands = packet[1] as SendPort;
        return;
      }
      final failure = packet[2] == true
          ? StateError('票面生成失败：${packet[1]}')
          : null;
      if (id == 1) {
        if (failure != null) {
          ready.completeError(failure);
        } else {
          ready.complete(_TicketWorker(commands!, requests));
        }
        return;
      }
      final request = requests.remove(id);
      if (request == null) return;
      if (failure != null) {
        request.completeError(failure);
      } else {
        request.complete(packet[1] as String);
      }
    });
    await Isolate.spawn(_ticketWorker, [replies.sendPort, source]);
    return ready.future;
  }

  Future<String> evaluate(String source) {
    final id = next++, request = Completer<String>();
    requests[id] = request;
    commands.send([id, source]);
    return request.future;
  }
}

void _ticketWorker(List<dynamic> input) {
  final replies = input[0] as SendPort, commands = ReceivePort();
  replies.send([0, commands.sendPort]);
  try {
    final runtime = getJavascriptRuntime(xhr: false),
        loaded = runtime.evaluate(input[1] as String);
    replies.send([1, loaded.stringResult, loaded.isError]);
    if (loaded.isError) {
      runtime.dispose();
      commands.close();
      return;
    }
    commands.listen((dynamic message) {
      final request = message as List;
      try {
        final result = runtime.evaluate(request[1] as String);
        replies.send([request[0], result.stringResult, result.isError]);
      } catch (error) {
        replies.send([request[0], error.toString(), true]);
      }
    });
  } catch (error) {
    replies.send([1, error.toString(), true]);
    commands.close();
  }
}

Future<String> renderOriginalTicket(String input) async {
  final elapsed = Stopwatch()..start();
  final worker = await (_worker ??= _TicketWorker.start());
  final engineMs = elapsed.elapsedMilliseconds;
  await prepareRenderFonts(
    jsonDecode(input)['template'],
    manifest: (template) => worker.evaluate(
      'JSON.stringify(XingjiTickets.fonts(${jsonEncode(template)}))',
    ),
    register: (family, bytes, file) async {
      await worker.evaluate(
        'XingjiTickets.registerFont(${jsonEncode(family)},${jsonEncode(bytes)},${jsonEncode(file)})',
      );
    },
  );
  final fontMs = elapsed.elapsedMilliseconds - engineMs;
  final svg = await worker.evaluate(
    'XingjiTickets.display(${jsonEncode(input)})',
  );
  final svgMs = elapsed.elapsedMilliseconds - fontMs - engineMs;
  if (elapsed.elapsedMilliseconds >= 180) {
    developer.log(
      'worker=${engineMs}ms fonts=${fontMs}ms svg=${svgMs}ms',
      name: 'Xingji.TicketRender',
    );
  }
  return svg;
}

Future<String> normalizeArchive(String input) async {
  final worker = await (_worker ??= _TicketWorker.start());
  return worker.evaluate(
    'XingjiTickets.normalizeArchive(${jsonEncode(input)})',
  );
}
