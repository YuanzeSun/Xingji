import 'package:cupertino_ui/cupertino_ui.dart'
    show CupertinoSlidingSegmentedControl;
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'map_projection.dart';

Map<String, dynamic> appleMapOptions(
  ReferenceCatalog catalog,
  List<TicketRecord> records, {
  bool railway = true,
  bool railOverview = false,
  bool flightRoutes = true,
  bool flightFrequency = false,
  bool fallbackRail = false,
}) {
  final pins = <String, List<double>>{};
  final tracks = <List<List<double>>>[];
  final links = <List<List<double>>>[];
  final flights = <(String, String), (List<List<double>>, int)>{};
  final anchors = <String, List<List<double>>>{};
  final trackKeys = <int>{};

  List<double>? railPoint(Object? value) =>
      value is List && value.length >= 2 && value.take(2).every((v) => v is num)
      ? railWgs84Point(value)
      : null;

  for (final record in records.where((record) => record.isJourney)) {
    var hasTrack = false;
    if ((railway ? matchingRailRoute(record, catalog) : null)
        case final Map route) {
      if (route['segments'] case final List segments) {
        for (final segment in segments.whereType<List>()) {
          final points = segment
              .map(railPoint)
              .whereType<List<double>>()
              .toList();
          if (points.length < 2) continue;
          hasTrack = true;
          if (trackKeys.add(Object.hashAll(points.map(Object.hashAll)))) {
            tracks.add(points);
          }
        }
      }
      if (route['lineLabels'] case final List labels) {
        for (final label in labels.whereType<Map>()) {
          final name = label['name'], point = railPoint(label['coordinates']);
          if (name is String && name.isNotEmpty && point != null) {
            (anchors[name] ??= []).add(point);
          }
        }
      }
      if (route['stops'] case final List stops) {
        for (final stop in stops.whereType<Map>()) {
          final name = stop['name'], point = railPoint(stop['coordinates']);
          if (name is String && name.isNotEmpty && point != null) {
            pins[name] = point;
          }
        }
      }
    }

    final showFlight = record.isFlight && (flightRoutes || flightFrequency);
    final showRail =
        !record.isFlight && (hasTrack || railOverview || fallbackRail);
    if (!showFlight && !showRail) continue;
    final a = catalog.endpoint(record, 'origin');
    final b = catalog.endpoint(record, 'destination');
    final from = a?.coordinates, to = b?.coordinates;
    if (from == null || to == null) continue;
    pins[a!.name] = from;
    pins[b!.name] = to;
    if (showFlight) {
      final forward = a.identity.compareTo(b.identity) <= 0;
      final key = forward ? (a.identity, b.identity) : (b.identity, a.identity);
      final count = flightFrequency ? (flights[key]?.$2 ?? 0) + 1 : 1;
      flights[key] = ([from, to], count);
    } else if (!hasTrack) {
      links.add([from, to]);
    }
  }

  return {
    'railJourney': railway || railOverview,
    'pins': [
      for (final entry in pins.entries)
        {'name': entry.key, 'coordinate': entry.value},
    ],
    'segments': tracks,
    'links': links,
    'flights': [
      for (final (coords, count) in flights.values)
        {'coordinates': coords, 'count': count},
    ],
    'lineLabels': [
      for (final entry in anchors.entries)
        {'name': entry.key, 'coordinates': entry.value},
    ],
  };
}

Future<void> openJourneyMapFullscreen(BuildContext context, Widget map) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (context) => Scaffold(
          appBar: AppBar(title: const Text('行程地图')),
          body: SafeArea(child: map),
        ),
      ),
    );

class MapStyleSwitch extends StatelessWidget {
  const MapStyleSwitch(this.native, this.onChanged, {super.key});

  final bool native;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => CupertinoSlidingSegmentedControl<bool>(
    groupValue: native,
    children: const {
      true: Padding(
        padding: EdgeInsets.symmetric(horizontal: 10),
        child: Text('原生地图'),
      ),
      false: Padding(
        padding: EdgeInsets.symmetric(horizontal: 10),
        child: Text('简笔地图'),
      ),
    },
    onValueChanged: (value) {
      if (value != null) onChanged(value);
    },
  );
}

class AppleJourneyMap extends StatefulWidget {
  const AppleJourneyMap(
    this.store,
    this.record, {
    super.key,
    required this.simpleMapBuilder,
  });

  final AppStore store;
  final TicketRecord record;
  final Widget Function() simpleMapBuilder;

  static bool hasRoute(AppStore store, TicketRecord record) =>
      record.isJourney &&
      (matchingRailRoute(record, store.catalog) != null ||
          ['origin', 'destination'].every(
            (side) => store.catalog.endpoint(record, side)?.coordinates != null,
          ));

  @override
  State<AppleJourneyMap> createState() => _AppleJourneyMapState();
}

class _AppleJourneyMapState extends State<AppleJourneyMap> {
  bool fullscreen = false, native = true;

  Future<void> _showFullscreen(Widget map) async {
    setState(() => fullscreen = true);
    await openJourneyMapFullscreen(context, map);
    if (mounted) setState(() => fullscreen = false);
  }

  @override
  Widget build(BuildContext context) {
    final record = widget.record;
    final options = appleMapOptions(
      widget.store.catalog,
      [record],
      railway: !record.isFlight,
      fallbackRail: true,
    );
    final view = native
        ? AppleMapView(
            options,
            key: ValueKey((record.id, record.text('updatedAt'))),
          )
        : widget.simpleMapBuilder();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionTitle(
          '行程地图',
          trailing: IconButton(
            onPressed: fullscreen ? null : () => _showFullscreen(view),
            tooltip: '全屏显示地图',
            icon: const Icon(Icons.fullscreen),
          ),
        ),
        MapStyleSwitch(native, (value) => setState(() => native = value)),
        const SizedBox(height: 10),
        SizedBox(
          height: 310,
          width: double.infinity,
          child: fullscreen ? const ColoredBox(color: mist) : view,
        ),
        if ((options['links'] as List).isNotEmpty || record.isFlight)
          const Text('虚线为出发地与目的地之间的示意线。'),
      ],
    );
  }
}

class AppleMapView extends StatelessWidget {
  const AppleMapView(this.options, {super.key});

  final Map<String, dynamic> options;

  @override
  Widget build(BuildContext context) => UiKitView(
    viewType: 'dev.yuanzesun.xingji/apple-map',
    layoutDirection: Directionality.of(context),
    creationParamsCodec: const StandardMessageCodec(),
    gestureRecognizers: {
      Factory<EagerGestureRecognizer>(EagerGestureRecognizer.new),
    },
    creationParams: options,
  );
}
