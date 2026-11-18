import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
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
    final catalog = widget.store.catalog;
    final records = widget.store.records.where((record) {
      final day = record.departure?.date;
      return record.isJourney &&
          day != null &&
          (from == null ||
              !day.isBefore(
                DateTime.utc(from!.year, from!.month, from!.day),
              )) &&
          !day.isAfter(DateTime.utc(until.year, until.month, until.day));
    }).toList();
    final rails = records.where((row) => !row.isFlight).toList(),
        flights = records.where((row) => row.isFlight).toList();
    final airports = <String, Place>{}, stations = <String, Place>{};
    for (final record in records) {
      for (final side in ['origin', 'destination']) {
        final place = catalog.endpoint(record, side);
        if (place != null) {
          (place.flight ? airports : stations)[place.identity] = place;
        }
      }
    }
    Map<String, int> count(Iterable<String> values) {
      final result = <String, int>{};
      for (final value in values.where((value) => value.isNotEmpty)) {
        result.update(value, (count) => count + 1, ifAbsent: () => 1);
      }
      return result;
    }

    final models = count(
      rails.map(
        (r) =>
            '${r.text('railModel')}${supply && r.text('railPowerSupply').isNotEmpty ? ' · ${r.text('railPowerSupply')}' : ''}',
      ),
    );
    final bureaus = count(
      rails.map(
        (r) => owner && r.text('railCarOwner').isNotEmpty
            ? r.text('railCarOwner')
            : r.text('railBureau'),
      ),
    );
    final aircraft = count(
      flights.map(
        (r) => catalog.aircraft(r.text('aircraft'), family: !subtype),
      ),
    );
    final routes = count(
      flights.map((r) {
        var a = r.text('origin'), b = r.text('destination');
        if (mergeDirections && a.compareTo(b) > 0) {
          final temp = a;
          a = b;
          b = temp;
        }
        return '$a${mergeDirections ? ' ↔ ' : ' → '}$b';
      }),
    );
    final countries = airports.values
            .map((place) => place.text('country'))
            .where((value) => value.isNotEmpty)
            .toSet(),
        continents = airports.values
            .map((place) => place.text('continent'))
            .where((value) => value.isNotEmpty)
            .toSet();
    countries.addAll(
      stations.values
          .map((place) => place.text('country'))
          .where((value) => value.isNotEmpty),
    );
    continents.addAll(
      stations.values
          .map((place) => place.text('continent'))
          .where((value) => value.isNotEmpty),
    );
    final year = DateTime.now().year,
        first = records.isEmpty
            ? year
            : records.map((r) => r.departure!.year!).reduce(math.min),
        last = records.isEmpty
            ? year
            : records.map((r) => r.departure!.year!).reduce(math.max);
    final buckets = <String, (int, int)>{};
    for (var y = first; y <= last; y++) {
      final firstMonth = monthly && from?.year == y ? from!.month : 1;
      final lastMonth = monthly ? (until.year == y ? until.month : 12) : 1;
      for (var m = firstMonth; m <= lastMonth; m++) {
        buckets[monthly ? '$y-${m.toString().padLeft(2, '0')}' : '$y'] = (0, 0);
      }
    }
    for (final r in records) {
      final d = r.departure!.date!,
          key = monthly
              ? '${d.year}-${d.month.toString().padLeft(2, '0')}'
              : '${d.year}',
          old = buckets[key] ?? (0, 0);
      buckets[key] = r.isFlight ? (old.$1, old.$2 + 1) : (old.$1 + 1, old.$2);
    }
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
        RideTrendChart(
          data: records.isEmpty ? {} : buckets,
          monthly: monthly,
          onMonthlyChanged: (value) => setState(() => monthly = value),
        ),
        _bars(
          '乘坐车型',
          models,
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('细分供电制式'),
            value: supply,
            onChanged: (value) => setState(() => supply = value),
          ),
        ),
        _bars(
          '担当路局',
          bureaus,
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('显示车辆归属单位'),
            value: owner,
            onChanged: (value) => setState(() => owner = value),
          ),
        ),
        _bars(
          '乘坐机型',
          aircraft,
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
          children: continents
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
          children: countries
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
          routes,
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
