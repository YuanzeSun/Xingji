import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'sync_review.dart';
import 'design.dart';
import 'field_labels.dart';
import 'ticket_face.dart';
import 'editor.dart';
import 'export_service.dart';
import 'map_page.dart';
import 'coach_panel.dart';

void openTicket(
  BuildContext context,
  AppStore store,
  TicketRecord record, {
  String? heroTag,
}) => Navigator.of(context).push(
  MaterialPageRoute(
    builder: (_) => TicketDetail(store, record, heroTag: heroTag),
  ),
);

class TicketDetail extends StatefulWidget {
  final AppStore store;
  final TicketRecord record;
  final String? heroTag;
  const TicketDetail(this.store, this.record, {super.key, this.heroTag});
  @override
  State<TicketDetail> createState() => _TicketDetailState();
}

class _TicketDetailState extends State<TicketDetail> {
  bool exporting = false;

  Future<void> _export(TicketRecord record, String format) async {
    setState(() => exporting = true);
    try {
      final service = record
          .text('service')
          .replaceAll(RegExp(r'[<>:"/\\|?*]'), '_');
      final name = service.isEmpty ? '行迹票据' : service;
      if (format == 'svg') {
        await saveFile(
          '$name.svg',
          utf8.encode(await ticketSvg(record)),
          'image/svg+xml',
        );
      } else {
        await saveFile(
          '$name.png',
          await ticketPng(record, widget.store.catalog),
          'image/png',
        );
      }
    } catch (error) {
      if (mounted) showError(context, error);
    } finally {
      if (mounted) setState(() => exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: widget.store,
    builder: (context, _) {
      final store = widget.store,
          record =
              store.records
                  .where((row) => row.id == widget.record.id)
                  .firstOrNull ??
              widget.record;
      final flight = record.isFlight;
      final fields = [
        'originCity',
        'destinationCity',
        'departureDate',
        'arrivalDate',
        'departureTime',
        'arrivalTime',
        'passenger',
        'identity',
        if (!flight) 'carriage',
        'seat',
        'seatClass',
        'price',
        'gate',
        if (flight) ...[
          'terminal',
          'airline',
          'aircraft',
          'aircraftRegistration',
          'boardingTime',
          'actualBoardingTime',
          'actualDepartureDate',
          'actualDepartureTime',
          'actualArrivalDate',
          'actualArrivalTime',
          'flightDistance',
          'pnr',
          'baggageTagNumbers',
          'checkedBaggageCount',
          'freeBaggageAllowance',
          'frequentFlyerCarrier',
          'frequentFlyerNumber',
          'marketingCarrier',
        ] else ...[
          'issuer',
          'saleCode',
          'railPlatform',
          'railBureau',
          'railRunner',
          'railCarOwner',
          'railModel',
          'railTrainsets',
          'railPowerSupply',
          'railMileage',
        ],
        'orderNumber',
        'ticketNumber',
      ];
      String label(String key) => key == 'originCity'
          ? '出发城市'
          : key == 'destinationCity'
          ? '到达城市'
          : flight && key == 'departureDate'
          ? '计划起飞日期'
          : flight && key == 'arrivalDate'
          ? '计划到达日期'
          : flight && key == 'departureTime'
          ? '计划起飞时间'
          : flight && key == 'arrivalTime'
          ? '计划到达时间'
          : flight && key == 'seat'
          ? '座位'
          : key == 'seatClass'
          ? (flight ? '舱位' : '席别')
          : key == 'gate'
          ? (flight ? '登机口' : '检票口')
          : fieldLabels[key] ?? key;
      String value(String key) => journeyDateFields.contains(key)
          ? JourneyDate.fromJson(record[key])?.label ?? ''
          : record.text(key);
      final visible = fields.where((key) => value(key).isNotEmpty).toList();
      return Scaffold(
        appBar: AppBar(
          title: Text(record.text('service')),
          actions: [
            if (!store.demo)
              IconButton(
                tooltip: '编辑票据',
                onPressed: !store.canWrite
                    ? null
                    : () => openEditor(context, store, record: record),
                icon: const Icon(Icons.edit_outlined),
              ),
            PopupMenuButton<String>(
              tooltip: '导出票面',
              enabled: !exporting,
              onSelected: (format) => _export(record, format),
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'png', child: Text('导出 PNG')),
                PopupMenuItem(value: 'svg', child: Text('导出 SVG')),
              ],
              icon: const Icon(Icons.download_outlined),
            ),
          ],
        ),
        body: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 48),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 920),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (exporting) const LinearProgressIndicator(),
                  Hero(
                    tag: widget.heroTag ?? record.id,
                    child: TicketFace(record, store.catalog),
                  ),
                  const SizedBox(height: 28),
                  Text(
                    '${record.text('origin')} → ${record.text('destination')}',
                    style: Theme.of(context).textTheme.headlineMedium,
                  ),
                  if (store.demo)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('示例票据', style: TextStyle(color: muted)),
                    ),
                  if (flight)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: Chip(
                        label: Text(switch (record.text('flightStatus')) {
                          'open' => 'Open 票',
                          'invalid' => '无效票',
                          _ => '正常',
                        }),
                      ),
                    ),
                  const Divider(),
                  LayoutBuilder(
                    builder: (context, constraints) => Wrap(
                      spacing: 24,
                      runSpacing: 24,
                      children: visible
                          .map(
                            (key) => SizedBox(
                              width: value(key).length > 16
                                  ? constraints.maxWidth
                                  : constraints.maxWidth < 500
                                  ? (constraints.maxWidth - 24) / 2
                                  : (constraints.maxWidth - 48) / 3,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    label(key),
                                    style: Theme.of(context)
                                        .textTheme
                                        .bodySmall,
                                  ),
                                  const SizedBox(height: 6),
                                  SelectableText(
                                    value(key),
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          )
                          .toList(),
                    ),
                  ),
                  if (!flight && record['railJourney'] is Map)
                    ..._railJourney(record),
                  if (flight) ..._boardingJourney(record),
                  if (matchingRailRoute(record, store.catalog) != null) ...[
                    const SectionTitle('铁路线路'),
                    SizedBox(
                      height: 340,
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(18),
                        child: JourneyCanvas(
                          store,
                          [record],
                          railway: true,
                          airRoutes: false,
                          showFullRailRoute: true,
                        ),
                      ),
                    ),
                  ],
                  if (!store.demo) ...[
                    const Divider(),
                    TextButton.icon(
                      style: TextButton.styleFrom(foregroundColor: ticketRed),
                      onPressed: !store.canWrite
                          ? null
                          : () async {
                              if (!await checkArchiveWrite(context, store) ||
                                  !context.mounted) {
                                return;
                              }
                              if (await confirmDeletion(
                                context,
                                description: store.connection == null
                                    ? '从本机票夹移除这张票据。'
                                    : '删除记录会同步到已连接的私人票库。',
                              )) {
                                try {
                                  if (!context.mounted) return;
                                  await store.delete(
                                    record,
                                    pick: pickSyncConflicts(context),
                                  );
                                  if (context.mounted) Navigator.pop(context);
                                } catch (error) {
                                  if (context.mounted) {
                                    showError(context, error);
                                  }
                                }
                              }
                            },
                      icon: const Icon(Icons.delete_outline),
                      label: const Text('删除票据'),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
  List<Widget> _railJourney(TicketRecord record) {
    final journey = record['railJourney'] as Map,
        stops = (journey['stops'] as List? ?? []).cast<Map>();
    if (!record.isJourney || stops.isEmpty) return [];
    final query = journey['query'];
    if (query is! Map ||
        JourneyDate.fromJson(query['boardingDate'])?.calendarText !=
            record.departure?.calendarText) {
      return [];
    }
    final from = stops.indexWhere((stop) => stop['station'] == query['origin']);
    final to = stops.indexWhere(
      (stop) => stop['station'] == query['destination'],
    );
    final hasDistance = stops.every((stop) => stop['distanceKm'] is num);
    String time(Map stop, String event) {
      final clock = stop['${event}Time']?.toString() ?? '';
      if (clock.isEmpty) return '—';
      final date = JourneyDate.fromJson(stop['${event}Date']);
      return date == null || date.calendarText == record.departure?.calendarText
          ? clock
          : '${date.label}\n$clock';
    }

    return [
      const SectionTitle('列车全程'),
      Text('${stops.first['station']} → ${stops.last['station']}'),
      if (from >= 0 && to > from)
        Padding(
          padding: const EdgeInsets.only(top: 8, bottom: 12),
          child: Text('我的区间 · ${query['origin']} → ${query['destination']}'),
        ),
      SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: DataTable(
          horizontalMargin: 12,
          columnSpacing: 28,
          columns: [
            '车站',
            '到达',
            '出发',
            '停留',
            if (hasDistance) '距始发 km',
          ].map((label) => DataColumn(label: Text(label))).toList(),
          dataRowMaxHeight: double.infinity,
          rows: stops.indexed.map((entry) {
            final (index, stop) = entry;
            final selected = from >= 0 && index >= from && index <= to;
            final first = index == 0, last = index == stops.length - 1;
            return DataRow(
              color: selected ? const WidgetStatePropertyAll(mist) : null,
              cells:
                  [
                        stop['station'],
                        first ? '—' : time(stop, 'arrival'),
                        last ? '—' : time(stop, 'departure'),
                        first || last || stop['stopMinutes'] == null
                            ? '—'
                            : '${stop['stopMinutes']} 分钟',
                        if (hasDistance) stop['distanceKm'],
                      ]
                      .map((value) => DataCell(Text((value ?? '').toString())))
                      .toList(),
            );
          }).toList(),
        ),
      ),
      for (final stock in (journey['trainsets'] as List? ?? [])) ...[
        SectionTitle(stock['id']?.toString() ?? '乘坐车组'),
        for (final key in [
          'manufacturer',
          'manufactureMonth',
          'trailerManufacturer',
          'depot',
          'trainDepot',
          'socket',
          'customType',
          'modelRemark',
          'carRemark',
        ])
          if ((stock[key] ?? '') != '')
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                '${{'manufacturer': '制造商', 'manufactureMonth': '出厂年月', 'trailerManufacturer': '拖车制造商', 'depot': '动车所', 'trainDepot': '车辆归属', 'socket': '电源插座', 'customType': '运营配置', 'modelRemark': '车型备注', 'carRemark': '车组备注'}[key]}：${stock[key]}',
              ),
            ),
      ],
      if (journey['coaches'] is Map) ...[
        for (final info in (journey['coaches']['info'] as List? ?? []))
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Text('${info['name']}：${info['value']}'),
          ),
        CoachPanel(journey['coaches'], carriage: record.text('carriage')),
      ],
    ];
  }

  List<Widget> _boardingJourney(TicketRecord record) {
    final code = record['boardingCode'];
    if (code is! Map || code['rawBytes'] is! String) return [];
    final String raw = code['rawBytes'];
    final Map<String, dynamic>? decoded;
    try {
      decoded = decodeBoardingBytes(base64Decode(raw));
    } on FormatException {
      return [];
    }
    final legs = decoded?['legs'] as List? ?? [];
    if (legs.length < 2) return [];
    final current = int.tryParse(record.text('boardingLegIndex'));
    String airport(String code) =>
        widget.store.catalog.resolve(code, code, flight: true)?.name ?? code;
    return [
      const SectionTitle('联程航段'),
      for (final (index, leg) in legs.indexed)
        Builder(
          builder: (context) {
            final saved = widget.store.records.where((other) {
              final otherCode = other['boardingCode'];
              return other.id != record.id &&
                  other.isFlight &&
                  otherCode is Map &&
                  otherCode['rawBytes'] == raw &&
                  int.tryParse(other.text('boardingLegIndex')) == index;
            }).firstOrNull;
            return ListTile(
              contentPadding: EdgeInsets.zero,
              selected: index == current,
              title: Text('${leg['service']}'),
              subtitle: Text(
                '${airport(leg['originCode'])} → ${airport(leg['destinationCode'])}',
              ),
              trailing: index == current
                  ? const Text('本段')
                  : saved == null
                  ? null
                  : const Icon(Icons.chevron_right),
              onTap: saved == null
                  ? null
                  : () => openTicket(context, widget.store, saved),
            );
          },
        ),
    ];
  }
}

Future<bool> confirmDeletion(
  BuildContext context, {
  String title = '删除这张票据？',
  String description = '从票夹移除选中的票据。',
  String confirmLabel = '确认删除',
}) async {
  final first = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(description),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('取消'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: const Text('继续'),
        ),
      ],
    ),
  );
  if (first != true || !context.mounted) return false;
  var answer = '', correct = false;
  final seed = DateTime.now().millisecond, a = seed % 8 + 2, b = seed % 6 + 2;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => AlertDialog(
        title: const Text('最后确认'),
        content: TextField(
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: '$a × $b = ?',
            errorText: answer.isNotEmpty && !correct ? '计算结果不正确' : null,
          ),
          onChanged: (value) => update(() {
            answer = value;
            correct = int.tryParse(value) == a * b;
          }),
        ),
        actions: [
          TextButton(
            onPressed: () {
              correct = false;
              Navigator.pop(context);
            },
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: correct ? () => Navigator.pop(context, true) : null,
            child: Text(confirmLabel),
          ),
        ],
      ),
    ),
  );
  return confirmed == true;
}
