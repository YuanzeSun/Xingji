import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:path_drawing/path_drawing.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'map_page_header.dart';
import 'map_annotations.dart';
import 'map_projection.dart';

class MapPage extends StatefulWidget {
  final AppStore store;
  const MapPage(this.store, {super.key});
  @override
  State<MapPage> createState() => _MapPageState();
}

class _MapPageState extends State<MapPage> {
  final layers = {'railway', 'routes'};
  @override
  Widget build(BuildContext context) => Stack(
    children: [
      Positioned.fill(
        child: JourneyCanvas(
          widget.store,
          widget.store.records,
          railway: layers.contains('railway'),
          airRoutes: layers.contains('routes'),
          flights: layers.contains('flight'),
          rail: layers.contains('rail'),
          controlBottom: 110,
          annotationInsets: EdgeInsets.fromLTRB(
            12,
            150 * MediaQuery.textScalerOf(context).scale(1),
            12,
            110,
          ),
        ),
      ),
      MapOverlay(
        layers,
        (id, value) => setState(() {
          if (value) {
            layers.add(id);
            if (id == 'rail') layers.remove('railway');
            if (id == 'railway') layers.remove('rail');
            if (id == 'flight') layers.remove('routes');
            if (id == 'routes') layers.remove('flight');
          } else {
            layers.remove(id);
          }
        }),
      ),
    ],
  );
}

class JourneyCanvas extends StatefulWidget {
  final AppStore store;
  final List<TicketRecord> records;
  final bool railway, airRoutes, flights, rail, showFullRailRoute;
  final double controlBottom;
  final EdgeInsets annotationInsets;
  const JourneyCanvas(
    this.store,
    this.records, {
    super.key,
    this.railway = true,
    this.airRoutes = true,
    this.flights = false,
    this.rail = false,
    this.showFullRailRoute = false,
    this.controlBottom = 12,
    this.annotationInsets = const EdgeInsets.all(8),
  });
  @override
  State<JourneyCanvas> createState() => _JourneyCanvasState();
}

class _JourneyCanvasState extends State<JourneyCanvas> {
  final transform = TransformationController();
  late final land = parseSvgPathData(widget.store.mapData['land'])
    ..fillType = PathFillType.evenOdd;
  late final countries = parseSvgPathData(widget.store.mapData['countries']);
  late final provinces = parseSvgPathData(widget.store.mapData['provinces']);
  @override
  void dispose() {
    transform.dispose();
    super.dispose();
  }

  void zoom(double factor) {
    final center = context.size?.center(Offset.zero);
    if (center == null) return;
    final current = transform.value.getMaxScaleOnAxis();
    final ratio = (current * factor).clamp(.5, 12) / current;
    transform.value = Matrix4.translationValues(center.dx, center.dy, 0)
      ..scaleByDouble(ratio, ratio, 1, 1)
      ..translateByDouble(-center.dx, -center.dy, 0, 1)
      ..multiply(transform.value);
  }

  @override
  Widget build(BuildContext context) => Stack(
    children: [
      Positioned.fill(
        child: ColoredBox(
          color: const Color(0xFFE8EFF0),
          child: InteractiveViewer(
            transformationController: transform,
            minScale: .5,
            maxScale: 12,
            boundaryMargin: const EdgeInsets.all(600),
            trackpadScrollCausesScale: true,
            child: CustomPaint(
              size: Size.infinite,
              painter: JourneyPainter(
                widget,
                land,
                countries,
                provinces,
                transform,
                MediaQuery.textScalerOf(context).scale(12) / 12,
              ),
            ),
          ),
        ),
      ),
      Positioned(
        right: 12,
        bottom: widget.controlBottom,
        child: Material(
          type: MaterialType.transparency,
          borderRadius: BorderRadius.circular(16),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                tooltip: '放大地图',
                color: ink,
                onPressed: () => zoom(1.25),
                icon: const Icon(Icons.add),
              ),
              IconButton(
                tooltip: '缩小地图',
                color: ink,
                onPressed: () => zoom(.8),
                icon: const Icon(Icons.remove),
              ),
              IconButton(
                tooltip: '恢复地图视野',
                color: ink,
                onPressed: () => transform.value = Matrix4.identity(),
                icon: const Icon(Icons.center_focus_strong_outlined),
              ),
            ],
          ),
        ),
      ),
    ],
  );
}

Offset project(List coordinates) => Offset(
  ((coordinates[0] as num).toDouble() + 180) / 360 * mapWorldWidth,
  (90 - (coordinates[1] as num).toDouble()) / 360 * mapWorldWidth,
);

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

class JourneyPainter extends CustomPainter {
  final JourneyCanvas view;
  final Path land, countries, provinces;
  final TransformationController transform;
  final double textScale;
  JourneyPainter(
    this.view,
    this.land,
    this.countries,
    this.provinces,
    this.transform,
    this.textScale,
  ) : super(repaint: transform);
  late final geometry = _buildGeometry();

  _JourneyGeometry _buildGeometry() {
    final tracks = <List<Offset>>[],
        full = <List<Offset>>[],
        surfaceLinks = <(Offset, Offset)>[],
        flightPairs = <(String, String), (Offset, Offset, int)>{},
        labels = <String, List<Offset>>{},
        nodes = <String, Offset>{},
        endpoints = <String>{},
        all = <Offset>[];
    final seenEdges = <(Offset, Offset)>{};
    void addSegments(dynamic segments, List<List<Offset>> target) {
      if (segments is! List) return;
      for (final raw in segments) {
        if (raw is! List || raw.length < 2) continue;
        final points = raw
            .map((point) => project(railWgs84Point(point)))
            .toList();
        if (identical(target, tracks)) {
          var run = <Offset>[points.first];
          for (var i = 1; i < points.length; i++) {
            final from = points[i - 1], to = points[i];
            final fresh =
                !seenEdges.contains((to, from)) && seenEdges.add((from, to));
            if (fresh) {
              run.add(to);
            } else {
              if (run.length > 1) target.add(run);
              run = [to];
            }
          }
          if (run.length > 1) target.add(run);
        } else {
          target.add(points);
        }
        all.addAll(points);
      }
    }

    for (final record in view.records.where((row) => row.isJourney)) {
      final route = view.railway
          ? matchingRailRoute(record, view.store.catalog)
          : null;
      if (route != null) {
        addSegments(route['segments'], tracks);
        if (view.showFullRailRoute && route['fullRoute'] is Map) {
          addSegments(route['fullRoute']['segments'], full);
        }
        for (final item in route['lineLabels'] as List? ?? []) {
          if (item['coordinates'] is List) {
            labels
                .putIfAbsent(item['name'], () => [])
                .add(project(railWgs84Point(item['coordinates'])));
          }
        }
        for (final stop in route['stops'] as List? ?? []) {
          if (stop['coordinates'] is List) {
            nodes[stop['name']] = project(railWgs84Point(stop['coordinates']));
          }
        }
        endpoints.addAll([record.text('origin'), record.text('destination')]);
      }
      if (record.isFlight && (view.airRoutes || view.flights) ||
          !record.isFlight && view.rail) {
        final a = view.store.catalog.endpoint(record, 'origin'),
            b = view.store.catalog.endpoint(record, 'destination');
        if (a?.coordinates == null || b?.coordinates == null) continue;
        final from = project(a!.coordinates!), to = project(b!.coordinates!);
        if (record.isFlight) {
          final forward = a.identity.compareTo(b.identity) <= 0;
          final key = forward
              ? (a.identity, b.identity)
              : (b.identity, a.identity);
          final count = view.airRoutes ? 1 : (flightPairs[key]?.$3 ?? 0) + 1;
          flightPairs[key] = forward ? (from, to, count) : (to, from, count);
        } else {
          surfaceLinks.add((from, to));
        }
        all.addAll([from, to]);
        nodes[a.name] = from;
        nodes[b.name] = to;
        endpoints.addAll([a.name, b.name]);
      }
    }
    final frame = MapLongitudeFrame(all);
    final fitted = all.isEmpty
        ? [const Offset(700, 70), const Offset(900, 230)]
        : all.map(frame.wrap).toList();
    final links = [
      for (final (from, to) in surfaceLinks)
        MapLink(
          frame.wrap(from),
          nearestMapCopy(frame.wrap(to), frame.wrap(from)),
        ),
      for (final (from, to, repeats) in flightPairs.values)
        for (var i = 0; i < repeats; i++)
          MapLink.flight(frame.wrap(from), frame.wrap(to), i, repeats),
    ];
    for (final link in links) {
      if (link.control != null &&
          (frame.wrap(link.to).dx - link.to.dx).abs() < 0.001) {
        fitted.add(link.control!);
      }
    }
    List<Offset> wrapTrack(List<Offset> points) {
      final line = [frame.wrap(points.first)];
      for (final point in points.skip(1)) {
        line.add(nearestMapCopy(frame.wrap(point), line.last));
      }
      return line;
    }

    return _JourneyGeometry(
      tracks: tracks.map(wrapTrack).toList(),
      full: full.map(wrapTrack).toList(),
      links: links,
      nodes: nodes.map((name, point) => MapEntry(name, frame.wrap(point))),
      labels: labels.map(
        (name, anchors) => MapEntry(name, anchors.map(frame.wrap).toList()),
      ),
      endpoints: endpoints,
      bounds: Rect.fromLTRB(
        fitted.map((point) => point.dx).reduce(math.min),
        fitted.map((point) => point.dy).reduce(math.min),
        fitted.map((point) => point.dx).reduce(math.max),
        fitted.map((point) => point.dy).reduce(math.max),
      ),
    );
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty || !size.width.isFinite || !size.height.isFinite) return;
    final bounds = geometry.bounds;
    final scale = math.min(
          size.width / math.max(30, bounds.width + 25),
          size.height / math.max(25, bounds.height + 25),
        ),
        center = bounds.center;
    final pixelScale = scale * transform.value.getMaxScaleOnAxis();
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale);
    canvas.translate(-center.dx, -center.dy);
    final viewport = canvas.getLocalClipBounds();
    final worlds = [
      for (final shift in [-mapWorldWidth, 0.0, mapWorldWidth])
        if (viewport.left <= shift + mapWorldWidth && viewport.right >= shift)
          shift,
    ];
    final landPaint = Paint()..color = const Color(0xFFF8FAF5);
    final borders = Paint()
      ..color = const Color(0xFFBBCBC5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = .7 / pixelScale;
    final provinceBorders = Paint()
      ..color = const Color(0xFFD8E1DA)
      ..style = PaintingStyle.stroke
      ..strokeWidth = .4 / pixelScale;
    for (final shift in worlds) {
      canvas.save();
      canvas.translate(shift, 0);
      canvas.drawPath(land, landPaint);
      canvas.drawPath(countries, borders);
      canvas.drawPath(provinces, provinceBorders);
      canvas.restore();
    }

    void drawCopies(Path path, Paint paint) {
      final bounds = path.getBounds();
      for (final shift in [-mapWorldWidth, 0.0, mapWorldWidth]) {
        if (bounds.left + shift > viewport.right ||
            bounds.right + shift < viewport.left) {
          continue;
        }
        canvas.save();
        canvas.translate(shift, 0);
        canvas.drawPath(path, paint);
        canvas.restore();
      }
    }

    Path path(List<Offset> points) {
      final result = Path()..moveTo(points.first.dx, points.first.dy);
      for (final point in points.skip(1)) {
        result.lineTo(point.dx, point.dy);
      }
      return result;
    }

    final trackPaint = Paint()
      ..color = ink
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 2 / pixelScale;
    for (final line in geometry.full) {
      drawCopies(
        dashPath(
          path(line),
          dashArray: CircularIntervalList([6 / pixelScale, 5 / pixelScale]),
        ),
        trackPaint,
      );
    }
    for (final line in geometry.tracks) {
      drawCopies(path(line), trackPaint);
    }
    final linkPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5 / pixelScale;
    for (final link in geometry.links) {
      drawCopies(
        link.path,
        linkPaint..color = link.control == null ? ink : ticketRed,
      );
    }
    for (final point in geometry.nodes.values) {
      canvas.drawCircle(point, 3 / pixelScale, Paint()..color = Colors.white);
      canvas.drawCircle(point, 2 / pixelScale, Paint()..color = ink);
    }
    canvas.restore();
    Offset screen(Offset point) => MatrixUtils.transformPoint(
      transform.value,
      (point - center) * scale + size.center(Offset.zero),
    );
    final inset = view.annotationInsets;
    final annotations = layoutMapAnnotations(
      stations: geometry.nodes.map(
        (name, point) => MapEntry(name, screen(point)),
      ),
      lines: geometry.labels.map(
        (name, anchors) => MapEntry(name, anchors.map(screen).toList()),
      ),
      endpoints: geometry.endpoints,
      bounds: Rect.fromLTRB(
        inset.left,
        inset.top,
        size.width - inset.right,
        size.height - inset.bottom,
      ),
      textScale: textScale,
      zoom: transform.value.getMaxScaleOnAxis(),
      reserved: [
        Rect.fromLTWH(
          size.width - 170,
          size.height - view.controlBottom - 52,
          162,
          52,
        ),
      ],
    );
    // InteractiveViewer transforms the geography. Cancel that transform only
    // for viewport labels so their text stays readable and collisions are rechecked.
    canvas.save();
    canvas.transform(Matrix4.inverted(transform.value).storage);
    paintMapAnnotations(canvas, annotations);
    canvas.restore();
  }

  @override
  bool shouldRepaint(JourneyPainter old) =>
      old.view != view || old.textScale != textScale;
}

class _JourneyGeometry {
  final List<List<Offset>> tracks, full;
  final List<MapLink> links;
  final Map<String, Offset> nodes;
  final Map<String, List<Offset>> labels;
  final Set<String> endpoints;
  final Rect bounds;
  const _JourneyGeometry({
    required this.tracks,
    required this.full,
    required this.links,
    required this.nodes,
    required this.labels,
    required this.endpoints,
    required this.bounds,
  });
}
