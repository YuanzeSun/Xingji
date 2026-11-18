import 'dart:ui';

import 'package:xingji_core/xingji_core.dart';

const mapWorldWidth = 1000.0;

class MapLongitudeFrame {
  final double center;
  const MapLongitudeFrame._(this.center);

  factory MapLongitudeFrame(Iterable<Offset> points) {
    final xs = points.map((point) => point.dx % mapWorldWidth).toList()..sort();
    if (xs.isEmpty) return const MapLongitudeFrame._(800);
    var gap = -1.0, start = xs.first;
    for (var i = 0; i < xs.length; i++) {
      final next = i + 1 < xs.length ? xs[i + 1] : xs.first + mapWorldWidth;
      if (next - xs[i] > gap) {
        gap = next - xs[i];
        start = next;
      }
    }
    return MapLongitudeFrame._(
      (start + (mapWorldWidth - gap) / 2) % mapWorldWidth,
    );
  }

  Offset wrap(Offset point) => Offset(
    center +
        (point.dx - center + mapWorldWidth / 2) % mapWorldWidth -
        mapWorldWidth / 2,
    point.dy,
  );
}

Offset nearestMapCopy(Offset point, Offset anchor) => Offset(
  point.dx - ((point.dx - anchor.dx) / mapWorldWidth).round() * mapWorldWidth,
  point.dy,
);

class MapLink {
  final Offset from, to;
  final Offset? control;
  const MapLink(this.from, this.to, {this.control});

  factory MapLink.flight(Offset from, Offset to, int index, int repeats) {
    final end = nearestMapCopy(to, from);
    final vector = end - from;
    final midpoint = (from + end) / 2;
    final bend = repeats == 1 ? .14 : .05 + .24 * index / (repeats - 1);
    // The normal points north for horizontal routes. Canonical airport order
    // keeps both directions in the same set of curves.
    var normal = Offset(vector.dy, -vector.dx);
    if (normal.dy > 0) normal = -normal;
    return MapLink(from, end, control: midpoint + normal * bend);
  }

  Path get path {
    final path = Path()..moveTo(from.dx, from.dy);
    if (control case final point?) {
      path.quadraticBezierTo(point.dx, point.dy, to.dx, to.dy);
    } else {
      path.lineTo(to.dx, to.dy);
    }
    return path;
  }
}

Map? matchingRailRoute(TicketRecord record, ReferenceCatalog catalog) {
  final route = record['railRoute'];
  if (record.isFlight || !record.isJourney || route is! Map) return null;
  String service(Object? value) =>
      (value ?? '').toString().trim().toUpperCase().split('/').first;
  if (service(record['service']) != service(route['service'])) return null;
  for (final side in ['origin', 'destination']) {
    final name = catalog.endpoint(record, side)?.name ?? record.text(side);
    if (placeKey(name).replaceFirst(RegExp(r'站$'), '') !=
        placeKey('${route[side] ?? ''}')) {
      return null;
    }
  }
  return route;
}
