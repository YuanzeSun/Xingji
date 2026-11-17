import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:xingji_core/xingji_core.dart';

import 'ticket_runtime_native.dart'
    if (dart.library.js_interop) 'ticket_runtime_web.dart'
    as runtime;

// The UI does not define ticket layouts. Every face uses src/tickets.js unchanged.
Size ticketSize(TicketRecord record) => record.isFlight
    ? const Size(1230, 500)
    : record.text('template').contains('red')
    ? const Size(900, 600)
    : const Size(856, 540);
final _cache = <String, Future<String>>{};
final _ready = <String, String>{};
Future<void>? _fonts;
Map<String, dynamic> _renderValues(TicketRecord record) => {
  'id': record.id,
  for (final key in ticketFields)
    if (![
      'railRoute',
      'railJourney',
      'lookupValues',
      'fieldSources',
    ].contains(key))
      key: record[key],
};
String _renderKey(TicketRecord record) => canonicalJson(_renderValues(record));
Future<void> prepareTicketFaces(List<TicketRecord> examples) async {
  await (_fonts ??= _loadFonts());
  for (final record in examples) {
    final key = _renderKey(record);
    if (_cache.containsKey(key)) continue;
    final svg = await rootBundle.loadString(
      'assets/tickets/${record.id}.display.svg',
    );
    _cache[key] = Future.value(svg);
    _ready[key] = svg;
  }
}

Future<void> _loadFonts() async {
  await (FontLoader(
    'TicketSong',
  )..addFont(rootBundle.load('assets/fonts/brand-song.ttf'))).load();
}

Future<String> ticketSvg(TicketRecord record) {
  final key = _renderKey(record);
  if (_cache.containsKey(key)) return _cache[key]!;
  if (_cache.length >= 80) {
    final oldest = _cache.keys.first;
    _cache.remove(oldest);
    _ready.remove(oldest);
  }
  final future = runtime
      .renderOriginalTicket(jsonEncode(_renderValues(record)))
      .then((svg) {
        _ready[key] = svg;
        return svg;
      })
      .onError((Object error, StackTrace stack) {
        _cache.remove(key);
        Error.throwWithStackTrace(error, stack);
      });
  _cache[key] = future;
  return future;
}

class TicketFace extends StatelessWidget {
  final TicketRecord record;
  final ReferenceCatalog catalog;
  const TicketFace(this.record, this.catalog, {super.key});
  @override
  Widget build(BuildContext context) => Semantics(
    image: true,
    label:
        '${record.text('service')} ${record.text('origin')}至${record.text('destination')}',
    child: ExcludeSemantics(
      child: RepaintBoundary(
        child: AspectRatio(
          aspectRatio: ticketSize(record).aspectRatio,
          child: _ready.containsKey(_renderKey(record))
              ? SvgPicture.string(
                  _ready[_renderKey(record)]!,
                  fit: BoxFit.contain,
                )
              : FutureBuilder<String>(
                  future: ticketSvg(record),
                  builder: (context, snapshot) {
                    if (snapshot.hasError) {
                      return const Center(
                        child: Icon(Icons.broken_image_outlined),
                      );
                    }
                    if (!snapshot.hasData) {
                      return const Center(
                        child: SizedBox.square(
                          dimension: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      );
                    }
                    return SvgPicture.string(
                      snapshot.data!,
                      fit: BoxFit.contain,
                    );
                  },
                ),
        ),
      ),
    ),
  );
}

Future<Uint8List> ticketPng(
  TicketRecord record,
  ReferenceCatalog catalog,
) async {
  final info = await vg.loadPicture(
    SvgStringLoader(await ticketSvg(record)),
    null,
  );
  final size = ticketSize(record),
      recorder = ui.PictureRecorder(),
      canvas = Canvas(recorder)..scale(2);
  canvas.drawPicture(info.picture);
  final picture = recorder.endRecording(),
      image = await picture.toImage(
        (size.width * 2).round(),
        (size.height * 2).round(),
      );
  try {
    return (await image.toByteData(format: ui.ImageByteFormat.png))!.buffer
        .asUint8List();
  } finally {
    image.dispose();
    picture.dispose();
    info.picture.dispose();
  }
}
