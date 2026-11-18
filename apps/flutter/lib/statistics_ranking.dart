import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:material_ui/material_ui.dart';

import 'design.dart';

enum RankingView {
  bars('条形图'),
  columns('柱状图'),
  donut('环形图');

  const RankingView(this.label);
  final String label;
}

class StatisticsRanking extends StatelessWidget {
  const StatisticsRanking(
    this.values, {
    this.view = RankingView.bars,
    super.key,
  });

  final Map<String, int> values;
  final RankingView view;

  @override
  Widget build(BuildContext context) {
    if (values.isEmpty) {
      return const Text('暂无记录', style: TextStyle(color: muted));
    }
    final rows = values.entries.toList()
      ..sort((a, b) {
        final byCount = b.value.compareTo(a.value);
        return byCount == 0 ? a.key.compareTo(b.key) : byCount;
      });
    final high = rows.first.value;
    return switch (view) {
      RankingView.bars => _bars(context, rows, high),
      RankingView.columns => _columns(rows, high),
      RankingView.donut => _donut(rows),
    };
  }

  Widget _bars(
    BuildContext context,
    List<MapEntry<String, int>> rows,
    int high,
  ) {
    final duration = Duration(
      milliseconds: MediaQuery.disableAnimationsOf(context) ? 0 : 360,
    );
    return Column(
      children: [
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(
              children: [
                _valueRow(row),
                const SizedBox(height: 8),
                ExcludeSemantics(
                  child: TweenAnimationBuilder<double>(
                    tween: Tween(begin: 0, end: row.value / high),
                    duration: duration,
                    builder: (context, value, _) => LinearProgressIndicator(
                      value: value,
                      minHeight: 5,
                      borderRadius: BorderRadius.circular(4),
                      backgroundColor: mist,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Widget _columns(List<MapEntry<String, int>> rows, int high) => LayoutBuilder(
    builder: (context, constraints) {
      final barSlot = math.max(88.0, constraints.maxWidth / rows.length);
      return SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final row in rows)
              SizedBox(
                width: barSlot,
                child: Column(
                  children: [
                    Container(
                      height: 112 + MediaQuery.textScalerOf(context).scale(26),
                      width: barSlot,
                      decoration: const BoxDecoration(
                        border: Border(bottom: BorderSide(color: mist)),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          Text(
                            '${row.value} 次',
                            style: const TextStyle(color: muted),
                          ),
                          const SizedBox(height: 4),
                          Container(
                            width: math.min(48, barSlot / 2),
                            height: 102 * row.value / high,
                            decoration: const BoxDecoration(
                              color: ink,
                              borderRadius: BorderRadius.vertical(
                                top: Radius.circular(5),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
                      child: Tooltip(
                        message: row.key,
                        excludeFromSemantics: true,
                        child: Text(
                          row.key,
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      );
    },
  );

  Widget _donut(List<MapEntry<String, int>> rows) {
    final total = rows.fold(0, (sum, row) => sum + row.value);
    final split = rows.length > _sliceColors.length
        ? _sliceColors.length - 1
        : rows.length;
    final other = rows.skip(split).toList();
    final slices = [
      for (var index = 0; index < split; index++)
        (rows[index], _sliceColors[index]),
      if (other.isNotEmpty)
        (
          MapEntry(
            '其他（${other.length} 项）',
            other.fold(0, (sum, row) => sum + row.value),
          ),
          const Color(0xFF84919A),
        ),
    ];
    final ring = SizedBox.square(
      dimension: 132,
      child: CustomPaint(
        painter: _DonutPainter([
          for (final (row, color) in slices) (row.value, color),
        ], total),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: FittedBox(
              fit: BoxFit.scaleDown,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '$total',
                    style: const TextStyle(
                      fontSize: 25,
                      fontWeight: FontWeight.w700,
                      color: ink,
                    ),
                  ),
                  const Text('次', style: TextStyle(fontSize: 12, color: muted)),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    final legend = Column(
      children: [
        for (final (row, color) in slices.take(split))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 5),
            child: _valueRow(row, total: total, color: color),
          ),
        if (other.isNotEmpty)
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            dense: true,
            title: _valueRow(
              slices.last.$1,
              total: total,
              color: slices.last.$2,
            ),
            children: [
              for (final row in other)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 0, 4),
                  child: _valueRow(row, total: total),
                ),
            ],
          ),
      ],
    );
    return LayoutBuilder(
      builder: (context, constraints) => constraints.maxWidth < 370
          ? Column(children: [ring, const SizedBox(height: 12), legend])
          : Row(
              children: [
                ring,
                const SizedBox(width: 18),
                Expanded(child: legend),
              ],
            ),
    );
  }
}

Widget _valueRow(MapEntry<String, int> row, {int? total, Color? color}) {
  final percent = total == null ? null : row.value / total * 100;
  final share = percent == null
      ? ''
      : percent < .1
      ? ' · <0.1%'
      : ' · ${percent.toStringAsFixed(1).replaceFirst(RegExp(r'\.0$'), '')}%';
  return Row(
    children: [
      if (color != null)
        Padding(
          padding: const EdgeInsets.only(right: 6),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(3),
            ),
            child: const SizedBox.square(dimension: 9),
          ),
        ),
      Expanded(child: Text(row.key)),
      const SizedBox(width: 8),
      Text('${row.value} 次$share', style: const TextStyle(color: muted)),
    ],
  );
}

const _sliceColors = [
  ink,
  Color(0xFFAE7747),
  Color(0xFF438282),
  Color(0xFFAB6068),
  Color(0xFF738447),
  Color(0xFF865F89),
];

class _DonutPainter extends CustomPainter {
  const _DonutPainter(this.slices, this.total);

  final List<(int, Color)> slices;
  final int total;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 18.0;
    final bounds = (Offset.zero & size).deflate(stroke / 2);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    var angle = -math.pi / 2;
    for (final (count, color) in slices) {
      final sweep = 2 * math.pi * count / total;
      final gap = slices.length == 1 ? 0.0 : math.min(sweep * .2, .025);
      canvas.drawArc(
        bounds,
        angle + gap / 2,
        sweep - gap,
        false,
        paint..color = color,
      );
      angle += sweep;
    }
  }

  @override
  bool shouldRepaint(_DonutPainter oldDelegate) =>
      total != oldDelegate.total || !listEquals(slices, oldDelegate.slices);
}
