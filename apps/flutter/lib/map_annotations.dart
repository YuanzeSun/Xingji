import 'dart:math' as math;

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

/// Label density grows with the viewport and with zoom. Preserve the most
/// useful line names and endpoint labels before filling in intermediate stops.
List<MapAnnotation> layoutMapAnnotations({
  required Map<String, Offset> stations,
  required Map<String, List<Offset>> lines,
  required Set<String> endpoints,
  required Rect bounds,
  double textScale = 1,
  double zoom = 1,
  List<Rect> reserved = const [],
}) {
  if (bounds.isEmpty) return [];
  final placed = <MapAnnotation>[], occupied = [...reserved];
  final limit =
      (bounds.width *
              bounds.height *
              zoom.clamp(.5, 5) /
              (30000 * textScale * textScale))
          .round()
          .clamp(3, 60);
  final spacing = 3 + 4 / math.max(1, zoom);

  bool place(String name, List<Offset> anchors, {bool railway = false}) {
    if (anchors.isEmpty) return false;
    final style = TextStyle(
      fontFamily: 'UiSans',
      fontSize: 12 * textScale,
      color: ink,
      fontWeight: railway ? FontWeight.w600 : FontWeight.w500,
    );
    TextPainter measure(TextStyle style) => TextPainter(
      text: TextSpan(text: name, style: style),
      textDirection: TextDirection.ltr,
    )..layout();
    final text = measure(style);
    final width = text.width + (railway ? 12 : 6),
        height = text.height + (railway ? 8 : 4),
        gap = railway ? 10.0 : 6.0;
    final offsets = [
      Offset(gap, -height - gap),
      Offset(gap, gap),
      Offset(-width - gap, -height - gap),
      Offset(-width - gap, gap),
      Offset(-width / 2, -height - gap),
      Offset(-width / 2, gap),
    ];
    for (final anchor in anchors) {
      for (final offset in offsets) {
        final box = (anchor + offset) & Size(width, height);
        if (!bounds.contains(box.topLeft) ||
            !bounds.contains(box.bottomRight) ||
            occupied.any((other) => other.inflate(spacing).overlaps(box))) {
          continue;
        }
        final halo = measure(
          style.copyWith(
            foreground: Paint()
              ..color = Colors.white.withValues(alpha: .85)
              ..style = PaintingStyle.stroke
              ..strokeWidth = 2,
          ),
        );
        occupied.add(box);
        placed.add(MapAnnotation(name, box, text, halo, railway));
        return true;
      }
    }
    text.dispose();
    return false;
  }

  final visibleStations = stations.entries.where(
    (entry) => bounds.contains(entry.value),
  );
  final visibleLines =
      [
        for (final entry in lines.entries)
          MapEntry(entry.key, entry.value.where(bounds.contains).toList()),
      ]..sort((a, b) {
        final coverage = b.value.length.compareTo(a.value.length);
        return coverage != 0 ? coverage : a.key.compareTo(b.key);
      });
  final triedLines = <String>{};
  void placeLines(int budget) {
    for (final entry in visibleLines) {
      if (placed.length >= budget) break;
      if (!triedLines.add(entry.key) || entry.value.isEmpty) continue;
      final anchors = entry.value
        ..sort(
          (a, b) => (a - bounds.center).distanceSquared.compareTo(
            (b - bounds.center).distanceSquared,
          ),
        );
      place(entry.key, anchors, railway: true);
    }
  }

  final stops = visibleStations
      .where((entry) => endpoints.contains(entry.key))
      .toList();
  placeLines(limit - math.min(limit ~/ 2, stops.length));
  final distance = {for (final stop in stops) stop.key: double.infinity};
  while (placed.length < limit && stops.isNotEmpty) {
    // Spread overview labels across the map instead of filling a single hub.
    var farthest = 0;
    for (var i = 1; i < stops.length; i++) {
      if (distance[stops[i].key]! > distance[stops[farthest].key]!) {
        farthest = i;
      }
    }
    final stop = stops.removeAt(farthest);
    if (!place(stop.key, [stop.value])) continue;
    for (final other in stops) {
      distance[other.key] = math.min(
        distance[other.key]!,
        (other.value - stop.value).distanceSquared,
      );
    }
  }
  placeLines(limit);
  for (final entry in visibleStations.where(
    (entry) => !endpoints.contains(entry.key),
  )) {
    if (placed.length >= limit) break;
    place(entry.key, [entry.value]);
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
    annotation.halo.dispose();
    annotation.text.dispose();
  }
}
