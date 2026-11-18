import 'package:material_ui/material_ui.dart';

import 'design.dart';

class MapAnnotation {
  final String name;
  final Rect box;
  final TextPainter text;
  final TextPainter halo;
  final bool railway;
  MapAnnotation(this.name, this.box, this.text, this.halo, this.railway);
}

/// Place in viewport pixels, retaining every verified anchor until one fits.
/// The railway overlay prioritizes line names, then endpoints and other stations.
List<MapAnnotation> layoutMapAnnotations({
  required Map<String, Offset> stations,
  required Map<String, List<Offset>> lines,
  required Set<String> endpoints,
  required Rect bounds,
  double textScale = 1,
  List<Rect> reserved = const [],
}) {
  if (bounds.isEmpty) return [];
  final placed = <MapAnnotation>[], occupied = [...reserved];
  bool place(String name, Offset anchor, {bool railway = false}) {
    if (!bounds.contains(anchor)) return false;
    final text = TextPainter(
      text: TextSpan(
        text: name,
        style: TextStyle(
          fontFamily: 'UiSans',
          fontSize: 12 * textScale,
          color: ink,
          fontWeight: railway ? FontWeight.w600 : FontWeight.w500,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final halo = TextPainter(
      text: TextSpan(
        text: name,
        style: (text.text! as TextSpan).style!.copyWith(
          foreground: Paint()
            ..color = Colors.white.withValues(alpha: .85)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    final width = text.width + (railway ? 12 : 6),
        height = text.height + (railway ? 8 : 4),
        gap = railway ? 10.0 : 6.0;
    for (final offset in [
      Offset(gap, -height - gap),
      Offset(gap, gap),
      Offset(-width - gap, -height - gap),
      Offset(-width - gap, gap),
      Offset(-width / 2, -height - gap),
      Offset(-width / 2, gap),
    ]) {
      final box = (anchor + offset) & Size(width, height);
      if (!bounds.contains(box.topLeft) ||
          !bounds.contains(box.bottomRight) ||
          occupied.any((other) => other.inflate(3).overlaps(box))) {
        continue;
      }
      occupied.add(box);
      placed.add(MapAnnotation(name, box, text, halo, railway));
      return true;
    }
    return false;
  }

  for (final entry in lines.entries) {
    final anchors = [...entry.value]
      ..sort(
        (a, b) => (a - bounds.center).distanceSquared.compareTo(
          (b - bounds.center).distanceSquared,
        ),
      );
    for (final anchor in anchors) {
      if (place(entry.key, anchor, railway: true)) break;
    }
  }
  for (final name in endpoints) {
    final point = stations[name];
    if (point != null) place(name, point);
  }
  for (final entry in stations.entries.where(
    (entry) => !endpoints.contains(entry.key),
  )) {
    place(entry.key, entry.value);
  }
  return placed;
}

void paintMapAnnotations(Canvas canvas, List<MapAnnotation> annotations) {
  for (final annotation in annotations) {
    final position =
        annotation.box.topLeft +
        (annotation.railway ? const Offset(6, 4) : const Offset(3, 2));
    annotation.halo.paint(canvas, position);
    annotation.text.paint(canvas, position);
  }
}
