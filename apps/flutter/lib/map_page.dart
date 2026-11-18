import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:path_drawing/path_drawing.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'map_page_header.dart';
import 'map_annotations.dart';

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
    final matrix = transform.value.clone()..scaleByDouble(factor, factor, 1, 1);
    transform.value = matrix;
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
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              IconButton(
                tooltip: '放大地图',
                onPressed: () => zoom(1.25),
                icon: const Icon(Icons.add),
              ),
              IconButton(
                tooltip: '缩小地图',
                onPressed: () => zoom(.8),
                icon: const Icon(Icons.remove),
              ),
              IconButton(
                tooltip: '恢复地图视野',
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
  ((coordinates[0] as num).toDouble() + 180) / 360 * 1000,
  (90 - (coordinates[1] as num).toDouble()) / 360 * 1000,
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
  @override
  void paint(Canvas canvas, Size size) {
    if (size.isEmpty || !size.width.isFinite || !size.height.isFinite) return;
    final tracks = <List<Offset>>[],
        full = <List<Offset>>[],
        links = <(Offset, Offset, bool)>[],
        labels = <String, List<Offset>>{},
        nodes = <String, Offset>{},
        endpoints = <String>{},
        all = <Offset>[];
    final seen = <String>{};
    void addSegments(dynamic segments, List<List<Offset>> target) {
      if (segments is! List) return;
      for (final raw in segments) {
        if (raw is! List || raw.length < 2) continue;
        final points = raw
            .map((point) => project(railWgs84Point(point)))
            .toList();
        final key = canonicalJson(raw),
            reverse = canonicalJson(raw.reversed.toList());
        if (identical(target, tracks) &&
            (!seen.add(key) || seen.contains(reverse))) {
          continue;
        }
        target.add(points);
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
        final from = project(a!.coordinates!),
            to = project(b!.coordinates!),
            ids = [a.identity, b.identity]..sort();
        if (record.isFlight && view.airRoutes && !seen.add(ids.join(':'))) {
          continue;
        }
        links.add((from, to, record.isFlight));
        all.addAll([from, to]);
        nodes[a.name] = from;
        nodes[b.name] = to;
        endpoints.addAll([a.name, b.name]);
      }
    }
    if (all.isEmpty) {
      all.addAll([const Offset(700, 70), const Offset(900, 230)]);
    }
    final left = all.map((p) => p.dx).reduce(math.min),
        right = all.map((p) => p.dx).reduce(math.max),
        top = all.map((p) => p.dy).reduce(math.min),
        bottom = all.map((p) => p.dy).reduce(math.max);
    final scale = math.min(
          size.width / math.max(30, right - left + 25),
          size.height / math.max(25, bottom - top + 25),
        ),
        center = Offset((left + right) / 2, (top + bottom) / 2);
    final pixelScale = scale * transform.value.getMaxScaleOnAxis();
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale);
    canvas.translate(-center.dx, -center.dy);
    canvas.drawPath(land, Paint()..color = const Color(0xFFF8FAF5));
    final boundaries = Paint()
      ..color = const Color(0xFFBBCBC5)
      ..style = PaintingStyle.stroke
      ..strokeWidth = .7 / pixelScale;
    canvas.drawPath(countries, boundaries);
    canvas.drawPath(
      provinces,
      boundaries
        ..color = const Color(0xFFD8E1DA)
        ..strokeWidth = .4 / pixelScale,
    );
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
    for (final line in full) {
      canvas.drawPath(
        dashPath(
          path(line),
          dashArray: CircularIntervalList([6 / pixelScale, 5 / pixelScale]),
        ),
        trackPaint,
      );
    }
    for (final line in tracks) {
      canvas.drawPath(path(line), trackPaint);
    }
    for (final (from, to, flight) in links) {
      final end = (to.dx - from.dx).abs() > 500
          ? Offset(to.dx + (to.dx > from.dx ? -1000 : 1000), to.dy)
          : to;
      final curve = Path()..moveTo(from.dx, from.dy);
      if (flight) {
        curve.quadraticBezierTo(
          (from.dx + end.dx) / 2,
          (from.dy + end.dy) / 2 - (end - from).distance * .14,
          end.dx,
          end.dy,
        );
      } else {
        curve.lineTo(end.dx, end.dy);
      }
      canvas.drawPath(
        curve,
        Paint()
          ..color = flight ? ticketRed : ink
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5 / pixelScale,
      );
    }
    for (final point in nodes.values) {
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
      stations: nodes.map((name, point) => MapEntry(name, screen(point))),
      lines: labels.map(
        (name, anchors) => MapEntry(name, anchors.map(screen).toList()),
      ),
      endpoints: endpoints,
      bounds: Rect.fromLTRB(
        inset.left,
        inset.top,
        size.width - inset.right,
        size.height - inset.bottom,
      ),
      textScale: textScale,
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
