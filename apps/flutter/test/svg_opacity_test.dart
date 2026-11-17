import 'dart:ui' as ui;

import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('SVG group opacity preserves the railway background watermark', () async {
    for (final shape in [
      '<path d="M0 0H100V100H0Z"/>',
      '<rect width="100" height="100"/>',
    ]) {
      final svg =
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#c6e2e7"/><g opacity=".065" fill="#3c9db9">$shape</g></svg>';
      final picture = await vg.loadPicture(SvgStringLoader(svg), null),
          image = await picture.picture.toImage(100, 100);
      final pixels = (await image.toByteData(
        format: ui.ImageByteFormat.rawRgba,
      ))!.buffer.asUint8List();
      final pixel = pixels.sublist(
        50 * 100 * 4 + 50 * 4,
        50 * 100 * 4 + 50 * 4 + 4,
      );
      expect(pixel[0], closeTo(189, 2));
      expect(pixel[1], closeTo(222, 2));
      expect(pixel[2], closeTo(228, 2));
      image.dispose();
      picture.picture.dispose();
    }
  });
}
