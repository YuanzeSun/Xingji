import 'dart:convert';
import 'dart:js_interop';

import 'ticket_runtime_fonts.dart';

@JS('XingjiTickets.display')
external JSString _render(JSString input);
@JS('XingjiTickets.fontManifest')
external JSString _manifest(JSString template);
@JS('XingjiTickets.registerFont')
external void _register(JSString family, JSString bytes, JSString file);
Future<String> renderOriginalTicket(String input) async {
  await prepareRenderFonts(
    jsonDecode(input)['template'],
    manifest: (template) => _manifest(template.toJS).toDart,
    register: (family, bytes, file) =>
        _register(family.toJS, bytes.toJS, file.toJS),
  );
  return _render(input.toJS).toDart;
}
