import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'design.dart';

/// A scrollable time axis. Zoom changes horizontal spacing, never the counts.
class RideTrendChart extends StatefulWidget {
  final Map<String, (int, int)> data;
  final bool monthly;
  final ValueChanged<bool> onMonthlyChanged;
  const RideTrendChart({
    super.key,
    required this.data,
    required this.monthly,
    required this.onMonthlyChanged,
  });

  @override
  State<RideTrendChart> createState() => _RideTrendChartState();
}

class _RideTrendChartState extends State<RideTrendChart>
    with SingleTickerProviderStateMixin {
  final scroll = ScrollController();
  final focus = FocusNode(debugLabel: 'Ride trend');
  final touches = <int, Offset>{};
  late final animation = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 620),
  );
  String? selected;
  double zoom = 1, viewport = 0, pinchDistance = 1, pinchZoom = 1;
  double pinchFraction = .5;
  double? pendingOffset;
  bool started = false, pinching = false;

  List<MapEntry<String, (int, int)>> get rows => widget.data.entries.toList();
  double get plotPadding => 2 * MediaQuery.textScalerOf(context).scale(12);
  int get index => math.max(0, rows.indexWhere((row) => row.key == selected));

  @override
  void initState() {
    super.initState();
    selected = widget.data.keys.lastOrNull;
    _revealSelected();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (MediaQuery.disableAnimationsOf(context)) {
      animation.value = 1;
    } else if (!started) {
      animation.forward();
    }
    started = true;
  }

  @override
  void didUpdateWidget(RideTrendChart oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (mapEquals(oldWidget.data, widget.data)) return;
    if (oldWidget.monthly != widget.monthly ||
        !widget.data.containsKey(selected)) {
      selected = widget.data.keys.lastOrNull;
      zoom = 1;
    }
    if (MediaQuery.disableAnimationsOf(context)) {
      animation.value = 1;
    } else {
      animation.forward(from: 0);
    }
    _revealSelected();
  }

  double _width(double scale) => viewport * scale;

  double get maxZoom => widget.data.length < 2
      ? 1
      : math.max(
          4,
          ((widget.data.length - 1) * 180 + 2 * plotPadding) /
              math.max(1, viewport),
        );

  double _fractionAt(double anchor) =>
      (((pendingOffset ?? (scroll.hasClients ? scroll.offset : 0)) +
                  anchor -
                  plotPadding) /
              math.max(1, _width(zoom) - 2 * plotPadding))
          .clamp(0.0, 1.0);

  void _queueScroll(double target) {
    final queued = pendingOffset != null;
    pendingOffset = target.clamp(0.0, math.max(0, _width(zoom) - viewport));
    if (queued) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final target = pendingOffset;
      pendingOffset = null;
      if (mounted && target != null) _jump(target);
    });
    WidgetsBinding.instance.ensureVisualUpdate();
  }

  void _jump(double offset) {
    if (scroll.hasClients) {
      scroll.jumpTo(offset.clamp(0.0, scroll.position.maxScrollExtent));
    }
  }

  void _revealSelected() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!mounted || !scroll.hasClients) return;
    final x = _pointX(index, rows.length, _width(zoom), padding: plotPadding);
    _jump(x - viewport / 2);
  });

  void _select(int next, {bool reveal = false}) {
    if (rows.isEmpty) return;
    final key = rows[next.clamp(0, rows.length - 1)].key;
    if (key != selected) setState(() => selected = key);
    if (reveal) _revealSelected();
  }

  void _pick(double x) {
    final width = _width(zoom);
    _select(
      ((x - plotPadding) /
              math.max(1, width - 2 * plotPadding) *
              (rows.length - 1))
          .round(),
    );
  }

  void _zoom(double value, {double? anchor, double? fraction}) {
    if (viewport <= 0 || widget.data.length < 2) return;
    final next = value.clamp(1.0, maxZoom);
    if (next == zoom && fraction == null) return;
    final focal = anchor ?? viewport / 2;
    final position = fraction ?? _fractionAt(focal);
    if (next != zoom) setState(() => zoom = next);
    _queueScroll(
      plotPadding + position * (_width(zoom) - 2 * plotPadding) - focal,
    );
  }

  void _touchDown(PointerDownEvent event) {
    if (event.kind != PointerDeviceKind.touch) return;
    touches[event.pointer] = event.localPosition;
    if (touches.length == 2) {
      final first = touches.values.first, last = touches.values.last;
      pinchDistance = (first - last).distance;
      pinchZoom = zoom;
      pinchFraction = _fractionAt((first.dx + last.dx) / 2);
      setState(() => pinching = true);
    }
  }

  void _touchMove(PointerMoveEvent event) {
    if (!touches.containsKey(event.pointer)) return;
    touches[event.pointer] = event.localPosition;
    if (touches.length != 2 || pinchDistance < 1) return;
    final points = touches.values.toList();
    _zoom(
      pinchZoom * (points[0] - points[1]).distance / pinchDistance,
      anchor: (points[0].dx + points[1].dx) / 2,
      fraction: pinchFraction,
    );
  }

  void _touchEnd(int pointer) {
    touches.remove(pointer);
    if (touches.isEmpty && pinching) setState(() => pinching = false);
  }

  @override
  void dispose() {
    scroll.dispose();
    focus.dispose();
    animation.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final entries = rows;
    final current = entries.isEmpty ? null : entries[index];
    String readout(int at) {
      final row = entries[at];
      return '${_period(row.key, widget.monthly)}，火车${row.value.$1}次，飞机${row.value.$2}次';
    }

    final scale = _CountScale(widget.data.values);
    final fontScale = MediaQuery.textScalerOf(context).scale(12) / 12;
    final range = entries.isEmpty
        ? ''
        : '${entries.first.key.replaceAll('-', '.')} — ${entries.last.key.replaceAll('-', '.')}';
    return Container(
      margin: const EdgeInsets.only(top: 28, bottom: 8),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: ink.withValues(alpha: .06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 20,
            runSpacing: 12,
            children: [
              Text('乘坐次数', style: Theme.of(context).textTheme.titleLarge),
              SegmentedButton<bool>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: false, label: Text('按年')),
                  ButtonSegment(value: true, label: Text('按月')),
                ],
                selected: {widget.monthly},
                onSelectionChanged: (value) =>
                    widget.onMonthlyChanged(value.single),
              ),
            ],
          ),
          const SizedBox(height: 24),
          if (current == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 64),
              child: Center(
                child: Text('这段时间还没有行程', style: TextStyle(color: muted)),
              ),
            )
          else ...[
            AnimatedSwitcher(
              duration: Duration(
                milliseconds: MediaQuery.disableAnimationsOf(context) ? 0 : 160,
              ),
              layoutBuilder: (current, previous) => Stack(
                alignment: Alignment.centerLeft,
                children: [...previous, ?current],
              ),
              child: _PeriodReadout(
                current,
                widget.monthly,
                key: ValueKey(current.key),
              ),
            ),
            const SizedBox(height: 24),
            CallbackShortcuts(
              bindings: {
                const SingleActivator(LogicalKeyboardKey.arrowLeft): () =>
                    _select(index - 1, reveal: true),
                const SingleActivator(LogicalKeyboardKey.arrowRight): () =>
                    _select(index + 1, reveal: true),
                const SingleActivator(LogicalKeyboardKey.home): () =>
                    _select(0, reveal: true),
                const SingleActivator(LogicalKeyboardKey.end): () =>
                    _select(rows.length - 1, reveal: true),
                const SingleActivator(LogicalKeyboardKey.equal): () =>
                    _zoom(zoom + .5),
                const SingleActivator(LogicalKeyboardKey.minus): () =>
                    _zoom(zoom - .5),
              },
              child: Focus(
                focusNode: focus,
                onFocusChange: (_) => setState(() {}),
                child: Semantics(
                  key: const ValueKey('ride-trend-reader'),
                  label: '乘坐次数折线图',
                  value: readout(index),
                  increasedValue: index < entries.length - 1
                      ? readout(index + 1)
                      : null,
                  decreasedValue: index > 0 ? readout(index - 1) : null,
                  onIncrease: index < entries.length - 1
                      ? () => _select(index + 1, reveal: true)
                      : null,
                  onDecrease: index > 0
                      ? () => _select(index - 1, reveal: true)
                      : null,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: focus.hasFocus
                            ? ink.withValues(alpha: .5)
                            : Colors.transparent,
                      ),
                    ),
                    child: SizedBox(
                      height: 238 + 20 * (fontScale - 1),
                      child: Row(
                        children: [
                          SizedBox(
                            width:
                                (scale.ceiling.toString().length * 7 + 14) *
                                fontScale,
                            child: CustomPaint(
                              size: Size.infinite,
                              painter: _CountAxis(scale, fontScale),
                            ),
                          ),
                          Expanded(
                            child: LayoutBuilder(
                              builder: (context, constraints) {
                                viewport = constraints.maxWidth;
                                return Listener(
                                  onPointerDown: _touchDown,
                                  onPointerMove: _touchMove,
                                  onPointerUp: (event) =>
                                      _touchEnd(event.pointer),
                                  onPointerCancel: (event) =>
                                      _touchEnd(event.pointer),
                                  onPointerPanZoomStart: (event) {
                                    pinchZoom = zoom;
                                    pinchFraction = _fractionAt(
                                      event.localPosition.dx,
                                    );
                                  },
                                  onPointerPanZoomUpdate: (event) {
                                    if (event.scale != 1) {
                                      _zoom(
                                        pinchZoom * event.scale,
                                        anchor: event.localPosition.dx,
                                        fraction: pinchFraction,
                                      );
                                    }
                                  },
                                  onPointerSignal: (event) {
                                    if (event is PointerScrollEvent &&
                                        HardwareKeyboard
                                            .instance
                                            .isControlPressed) {
                                      GestureBinding
                                          .instance
                                          .pointerSignalResolver
                                          .register(event, (_) {
                                            _zoom(
                                              zoom *
                                                  math.exp(
                                                    -event.scrollDelta.dy / 400,
                                                  ),
                                              anchor: event.localPosition.dx,
                                            );
                                          });
                                    }
                                  },
                                  // This embedded plot has its own bounds, so the
                                  // app's floating navigation inset must not move its scrollbar.
                                  child: MediaQuery.removePadding(
                                    context: context,
                                    removeTop: true,
                                    removeBottom: true,
                                    child: Scrollbar(
                                      controller: scroll,
                                      thumbVisibility: _width(zoom) > viewport,
                                      thickness: 3,
                                      radius: const Radius.circular(2),
                                      child: SingleChildScrollView(
                                        controller: scroll,
                                        scrollDirection: Axis.horizontal,
                                        physics: pinching
                                            ? const NeverScrollableScrollPhysics()
                                            : const ClampingScrollPhysics(),
                                        child: MouseRegion(
                                          onHover: (event) =>
                                              _pick(event.localPosition.dx),
                                          child: GestureDetector(
                                            behavior: HitTestBehavior.opaque,
                                            onTapUp: (event) {
                                              if (pinching) return;
                                              focus.requestFocus();
                                              _pick(event.localPosition.dx);
                                            },
                                            onLongPressStart: (event) =>
                                                _pick(event.localPosition.dx),
                                            onLongPressMoveUpdate: (event) =>
                                                _pick(event.localPosition.dx),
                                            child: RepaintBoundary(
                                              child: CustomPaint(
                                                key: const ValueKey(
                                                  'ride-trend-plot',
                                                ),
                                                size: Size(
                                                  _width(zoom),
                                                  constraints.maxHeight,
                                                ),
                                                painter: _TrendPainter(
                                                  entries,
                                                  index,
                                                  scale,
                                                  widget.monthly,
                                                  fontScale,
                                                  animation,
                                                ),
                                              ),
                                            ),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(range, style: Theme.of(context).textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

String _period(String key, bool monthly) => monthly
    ? '${key.substring(0, 4)}年${int.parse(key.substring(5))}月'
    : '$key年';

class _PeriodReadout extends StatelessWidget {
  final MapEntry<String, (int, int)> row;
  final bool monthly;
  const _PeriodReadout(this.row, this.monthly, {super.key});
  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final heading = Text(
        _period(row.key, monthly),
        style: const TextStyle(
          fontSize: 23,
          fontWeight: FontWeight.w600,
          color: ink,
        ),
      );
      final values = [
        _SeriesValue('火车', row.value.$1, ink, false),
        _SeriesValue('飞机', row.value.$2, ticketRed, true),
      ];
      if (constraints.maxWidth < 480) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            heading,
            const SizedBox(height: 12),
            Wrap(spacing: 28, runSpacing: 12, children: values),
          ],
        );
      }
      return Wrap(
        spacing: 24,
        runSpacing: 12,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [heading, ...values],
      );
    },
  );
}

class _SeriesValue extends StatelessWidget {
  final String label;
  final int count;
  final Color color;
  final bool dashed;
  const _SeriesValue(this.label, this.count, this.color, this.dashed);
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      ExcludeSemantics(
        child: CustomPaint(
          size: const Size(20, 12),
          painter: _LineKey(color, dashed),
        ),
      ),
      const SizedBox(width: 8),
      Text(label, style: const TextStyle(color: muted)),
      const SizedBox(width: 8),
      Text(
        '$count',
        style: TextStyle(
          color: color,
          fontSize: 22,
          fontWeight: FontWeight.w600,
        ),
      ),
      const SizedBox(width: 4),
      const Text('次', style: TextStyle(color: muted, fontSize: 13)),
    ],
  );
}

class _LineKey extends CustomPainter {
  final Color color;
  final bool dashed;
  _LineKey(this.color, this.dashed);
  @override
  void paint(Canvas canvas, Size size) {
    final pen = Paint()
      ..color = color
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    for (double x = 0; x < size.width; x += dashed ? 8 : size.width) {
      canvas.drawLine(
        Offset(x, 6),
        Offset(math.min(x + (dashed ? 4 : size.width), size.width), 6),
        pen,
      );
    }
  }

  @override
  bool shouldRepaint(_LineKey old) =>
      old.color != color || old.dashed != dashed;
}

class _CountScale {
  late final int step, ceiling;
  _CountScale(Iterable<(int, int)> values) {
    final max = values.fold(
      0,
      (value, row) => math.max(value, math.max(row.$1, row.$2)),
    );
    final raw = math.max(1.0, max / 3);
    final magnitude = math.pow(10, (math.log(raw) / math.ln10).floor());
    step = ([1, 2, 5, 10].firstWhere((n) => n * magnitude >= raw) * magnitude)
        .round();
    ceiling = math.max(step * 2, ((max / step).floor() + 1) * step);
  }
}

const _plotTop = 16.0;
double _baseline(Size size, double fontScale) => size.height - 38 * fontScale;
double _pointX(int index, int count, double width, {double padding = 24}) =>
    count <= 1
    ? width / 2
    : padding + (width - 2 * padding) * index / (count - 1);

void _paintText(
  Canvas canvas,
  String value,
  Offset at,
  double scale, {
  Color color = muted,
  bool centered = false,
}) {
  final text = TextPainter(
    text: TextSpan(
      text: value,
      style: TextStyle(
        fontFamily: 'UiSans',
        fontSize: 12 * scale,
        color: color,
      ),
    ),
    textDirection: TextDirection.ltr,
  )..layout();
  text.paint(
    canvas,
    at - Offset(centered ? text.width / 2 : 0, text.height / 2),
  );
}

class _CountAxis extends CustomPainter {
  final _CountScale scale;
  final double fontScale;
  _CountAxis(this.scale, this.fontScale);
  @override
  void paint(Canvas canvas, Size size) {
    final bottom = _baseline(size, fontScale);
    for (var value = 0; value <= scale.ceiling; value += scale.step) {
      _paintText(
        canvas,
        '$value',
        Offset(0, bottom - (bottom - _plotTop) * value / scale.ceiling),
        fontScale,
      );
    }
  }

  @override
  bool shouldRepaint(_CountAxis old) =>
      old.scale.ceiling != scale.ceiling ||
      old.scale.step != scale.step ||
      old.fontScale != fontScale;
}

class _TrendPainter extends CustomPainter {
  final List<MapEntry<String, (int, int)>> rows;
  final int selected;
  final _CountScale scale;
  final bool monthly;
  final double fontScale;
  final Animation<double> animation;
  _TrendPainter(
    this.rows,
    this.selected,
    this.scale,
    this.monthly,
    this.fontScale,
    this.animation,
  ) : super(repaint: animation);

  @override
  void paint(Canvas canvas, Size size) {
    final bottom = _baseline(size, fontScale), height = bottom - _plotTop;
    final grid = Paint()
      ..color = mist.withValues(alpha: .7)
      ..strokeWidth = 1;
    for (var value = 0; value <= scale.ceiling; value += scale.step) {
      final y = bottom - height * value / scale.ceiling;
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }
    final x = _pointX(
      selected,
      rows.length,
      size.width,
      padding: 24 * fontScale,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTRB(x - 16, 4, x + 16, bottom),
        const Radius.circular(12),
      ),
      Paint()..color = ink.withValues(alpha: .035),
    );
    canvas.drawLine(
      Offset(x, 8),
      Offset(x, bottom),
      Paint()
        ..color = ink.withValues(alpha: .16)
        ..strokeWidth = 1,
    );
    final pointSpacing =
        math.max(1.0, size.width - 48 * fontScale) /
        math.max(1, rows.length - 1);
    canvas.save();
    canvas.clipRect(
      Rect.fromLTWH(
        0,
        0,
        size.width * Curves.easeOutCubic.transform(animation.value),
        bottom + 8,
      ),
    );
    for (var series = 0; series < 2; series++) {
      final color = series == 0 ? ink : ticketRed;
      final points = [
        for (var i = 0; i < rows.length; i++)
          Offset(
            _pointX(i, rows.length, size.width, padding: 24 * fontScale),
            bottom -
                height *
                    (series == 0 ? rows[i].value.$1 : rows[i].value.$2) /
                    scale.ceiling,
          ),
      ];
      final line = Path()..moveTo(points.first.dx, points.first.dy);
      for (var i = 1; i < points.length; i++) {
        final previous = points[i - 1],
            point = points[i],
            mid = (previous.dx + point.dx) / 2;
        // Horizontal tangents keep each segment within its observed counts.
        line.cubicTo(mid, previous.dy, mid, point.dy, point.dx, point.dy);
      }
      final area = Path.from(line)
        ..lineTo(points.last.dx, bottom)
        ..lineTo(points.first.dx, bottom)
        ..close();
      canvas.drawPath(area, Paint()..color = color.withValues(alpha: .045));
      final pen = Paint()
        ..color = color
        ..strokeWidth = 2.5
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke;
      if (series == 0) {
        canvas.drawPath(line, pen);
      } else {
        for (final metric in line.computeMetrics()) {
          for (double at = 0; at < metric.length; at += 10) {
            canvas.drawPath(
              metric.extractPath(at, math.min(at + 5, metric.length)),
              pen,
            );
          }
        }
      }
      for (var i = 0; i < points.length; i++) {
        final point = points[i], active = i == selected;
        final count = series == 0 ? rows[i].value.$1 : rows[i].value.$2;
        if (!active && (count == 0 || pointSpacing < 10)) continue;
        if (active) canvas.drawCircle(point, 7, Paint()..color = Colors.white);
        if (series == 0) {
          canvas.drawCircle(point, active ? 5 : 2.8, Paint()..color = color);
        } else {
          final r = active ? 5.0 : 3.2;
          canvas.drawPath(
            Path()
              ..moveTo(point.dx, point.dy - r)
              ..lineTo(point.dx + r, point.dy)
              ..lineTo(point.dx, point.dy + r)
              ..lineTo(point.dx - r, point.dy)
              ..close(),
            Paint()..color = color,
          );
        }
      }
    }
    canvas.restore();
    final labelGap = 64 * fontScale;
    final labelStride = math.max(1, (labelGap / pointSpacing).ceil());
    var lastLabelX = double.negativeInfinity;
    for (var i = 0; i < rows.length; i++) {
      final yearBoundary = monthly && rows[i].key.endsWith('-01');
      if (i % labelStride != 0 && i != selected && !yearBoundary) continue;
      final labelX = _pointX(
        i,
        rows.length,
        size.width,
        padding: 24 * fontScale,
      );
      if (i != selected &&
          ((labelX - x).abs() < labelGap || labelX - lastLabelX < labelGap)) {
        continue;
      }
      lastLabelX = labelX;
      final label = monthly
          ? (yearBoundary
                ? '${rows[i].key.substring(0, 4)}年\n1月'
                : '${int.parse(rows[i].key.substring(5))}月')
          : rows[i].key;
      _paintText(
        canvas,
        label,
        Offset(
          _pointX(i, rows.length, size.width, padding: 24 * fontScale),
          bottom + 22 * fontScale,
        ),
        fontScale,
        centered: true,
        color: i == selected ? ink : muted,
      );
    }
  }

  @override
  bool shouldRepaint(_TrendPainter old) =>
      old.selected != selected ||
      !listEquals(old.rows, rows) ||
      old.fontScale != fontScale ||
      old.monthly != monthly;
}
