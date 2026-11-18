import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'journey_statistics.dart';
import 'ride_trend_chart.dart';

class StatisticsPage extends StatefulWidget {
  final AppStore store;
  const StatisticsPage(this.store, {super.key});
  @override
  State<StatisticsPage> createState() => _StatisticsPageState();
}

class _StatisticsPageState extends State<StatisticsPage> {
  DateTime? from;
  DateTime until = DateUtils.dateOnly(DateTime.now());
  bool monthly = false,
      supply = false,
      subtype = true,
      owner = false,
      mergeDirections = true;
  @override
  Widget build(BuildContext context) {
    final statistics = JourneyStatistics(
      widget.store.records,
      widget.store.catalog,
      from: from,
      until: until,
      monthly: monthly,
      supply: supply,
      subtype: subtype,
      owner: owner,
      mergeDirections: mergeDirections,
    );
    final rails = statistics.rails, flights = statistics.flights;
    final airports = statistics.airports, stations = statistics.stations;
    final distance = statistics.railMileageTrips == 0
        ? '—'
        : statistics.railMileage
              .toStringAsFixed(3)
              .replaceFirst(RegExp(r'\.?0+$'), '');
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 48),
      children: [
        Text('数据统计', style: Theme.of(context).textTheme.headlineLarge),
        const SizedBox(height: 24),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            OutlinedButton.icon(
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: from ?? until,
                  firstDate: DateTime(1800),
                  lastDate: DateTime(2200),
                );
                if (picked != null) {
                  setState(() {
                    from = picked;
                    if (until.isBefore(picked)) until = picked;
                  });
                }
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 18),
              label: Text(
                from == null
                    ? '起始日期 · 不限'
                    : JourneyDate.fromDateTime(from!).label,
              ),
            ),
            OutlinedButton.icon(
              onPressed: () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: until,
                  firstDate: from ?? DateTime(1800),
                  lastDate: DateTime(2200),
                );
                if (picked != null) setState(() => until = picked);
              },
              icon: const Icon(Icons.calendar_today_outlined, size: 18),
              label: Text('截止 ${JourneyDate.fromDateTime(until).label}'),
            ),
            TextButton(
              onPressed: () => setState(() {
                from = null;
                until = DateUtils.dateOnly(DateTime.now());
              }),
              child: const Text('恢复默认'),
            ),
          ],
        ),
        const SizedBox(height: 24),
        LayoutBuilder(
          builder: (context, constraints) => Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              for (final (label, value, unit) in [
                ('火车', rails.length, '次'),
                ('飞机', flights.length, '次'),
                ('机场', airports.length, '个'),
                ('火车站', stations.length, '个'),
              ])
                SizedBox(
                  width:
                      (constraints.maxWidth -
                          (constraints.maxWidth < 650 ? 12 : 36)) /
                      (constraints.maxWidth < 650 ? 2 : 4),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 16,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            label,
                            style: const TextStyle(color: muted),
                          ),
                        ),
                        Text(
                          '$value',
                          style: const TextStyle(
                            fontSize: 25,
                            fontWeight: FontWeight.w600,
                            color: ink,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Text(unit, style: const TextStyle(color: muted)),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Card(
          color: Colors.white,
          elevation: 0,
          margin: EdgeInsets.zero,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(18),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
            child: Wrap(
              spacing: 12,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                const Text('铁路里程', style: TextStyle(color: muted)),
                Text(
                  '$distance km',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                Text(
                  '${statistics.railMileageTrips} / ${rails.length} 程已收录',
                  style: const TextStyle(color: muted),
                ),
              ],
            ),
          ),
        ),
        RideTrendChart(
          data: statistics.buckets,
          monthly: monthly,
          onMonthlyChanged: (value) => setState(() => monthly = value),
        ),
        _bars(
          '乘坐车型',
          statistics.models,
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('细分供电制式'),
            value: supply,
            onChanged: (value) => setState(() => supply = value),
          ),
        ),
        _bars(
          '担当路局',
          statistics.bureaus,
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('显示车辆归属单位'),
            value: owner,
            onChanged: (value) => setState(() => owner = value),
          ),
        ),
        _bars(
          '乘坐机型',
          statistics.aircraft,
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('包含子型号'),
            value: subtype,
            onChanged: (value) => setState(() => subtype = value),
          ),
        ),
        const SectionTitle('去过的大洲与国家'),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: statistics.continents
              .map(
                (value) => Chip(
                  label: Text(
                    {
                          'AS': '亚洲',
                          'EU': '欧洲',
                          'AF': '非洲',
                          'NA': '北美洲',
                          'SA': '南美洲',
                          'OC': '大洋洲',
                          'AN': '南极洲',
                        }[value] ??
                        value,
                  ),
                ),
              )
              .toList(),
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: statistics.countries
              .map(
                (value) => Chip(
                  label: Text(
                    {
                          'CN': '中国',
                          'JP': '日本',
                          'US': '美国',
                          'SG': '新加坡',
                          'GB': '英国',
                          'FR': '法国',
                          'DE': '德国',
                        }[value] ??
                        value,
                  ),
                ),
              )
              .toList(),
        ),
        const SectionTitle('去过的机场'),
        SizedBox(
          height: airports.isEmpty
              ? 48
              : math.min(300, airports.length * 64).toDouble(),
          child: Scrollbar(
            child: ListView(
              children: airports.values
                  .map(
                    (place) => ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(place.name),
                      subtitle: Text(place.city),
                      trailing: Text(place.code),
                    ),
                  )
                  .toList(),
            ),
          ),
        ),
        const SectionTitle('去过的火车站'),
        ConstrainedBox(
          constraints: const BoxConstraints(maxHeight: 260),
          child: SingleChildScrollView(
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: stations.values
                  .map((place) => Chip(label: Text(place.name)))
                  .toList(),
            ),
          ),
        ),
        _bars(
          '乘坐过的航线',
          statistics.routes,
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('合并双向航线'),
            value: mergeDirections,
            onChanged: (value) => setState(() => mergeDirections = value),
          ),
        ),
      ],
    );
  }

  Widget _bars(String title, Map<String, int> values, Widget control) {
    final ordered = values.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final max = ordered.isEmpty ? 1 : ordered.first.value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionTitle(title),
        control,
        if (ordered.isEmpty) const Text('暂无记录', style: TextStyle(color: muted)),
        for (final row in ordered)
          Padding(
            padding: const EdgeInsets.only(bottom: 16),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(child: Text(row.key)),
                    const SizedBox(width: 16),
                    Text(
                      '${row.value} 次',
                      style: const TextStyle(color: muted),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: row.value / max),
                  duration: Duration(
                    milliseconds: MediaQuery.disableAnimationsOf(context)
                        ? 0
                        : 360,
                  ),
                  builder: (context, value, _) => LinearProgressIndicator(
                    value: value,
                    minHeight: 5,
                    borderRadius: BorderRadius.circular(4),
                    backgroundColor: mist,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
