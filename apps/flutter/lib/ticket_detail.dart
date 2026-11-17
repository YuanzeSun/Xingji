import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'ticket_face.dart';
import 'editor.dart';
import 'export_service.dart';
import 'map_page.dart';

const fieldLabels = <String, String>{
  'origin': '出发站',
  'destination': '到达站',
  'service': '车次 / 航班号',
  'departureDate': '出发日期',
  'departureTime': '出发时间',
  'arrivalDate': '到达日期',
  'arrivalTime': '到达时间',
  'passenger': '旅客姓名',
  'identity': '证件号',
  'seat': '座位 / 铺位',
  'seatClass': '席别 / 舱位',
  'carriage': '车厢',
  'price': '票价（元）',
  'gate': '检票口 / 登机口',
  'railPlatform': '上车站台',
  'railBureau': '担当路局',
  'railRunner': '担当客运段',
  'railCarOwner': '车辆归属单位',
  'railModel': '车型',
  'railTrainsets': '车组编号',
  'railPowerSupply': '供电制式',
  'railMileage': '铁路里程（km）',
  'airline': '航空公司',
  'aircraft': '机型',
  'aircraftRegistration': '飞机注册号',
  'boardingTime': '计划登机时间',
  'actualBoardingTime': '实际登机时间',
  'actualDepartureDate': '实际起飞日期',
  'actualDepartureTime': '实际起飞时间',
  'actualArrivalDate': '实际落地日期',
  'actualArrivalTime': '实际落地时间',
  'flightDistance': '飞行距离（km）',
  'terminal': '航站楼',
  'pnr': '订座编号',
  'ticketNumber': '票号',
  'orderNumber': '订单号',
  'saleCode': '售票编号',
  'issuer': '售票站',
  'baggageTagNumbers': '行李编号',
  'checkedBaggageCount': '托运行李件数',
  'freeBaggageAllowance': '免费行李额度',
  'frequentFlyerCarrier': '常旅客航司',
  'frequentFlyerNumber': '常旅客编号',
  'marketingCarrier': '营销航司',
};
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
                onPressed: store.busy
                    ? null
                    : () => openEditor(context, store, record: record),
                icon: const Icon(Icons.edit_outlined),
              ),
            IconButton(
              tooltip: '导出票面图片',
              onPressed: exporting
                  ? null
                  : () async {
                      setState(() => exporting = true);
                      try {
                        await saveFile(
                          '${record.text('service')}.png',
                          await ticketPng(record, store.catalog),
                          'image/png',
                        );
                      } catch (error) {
                        if (context.mounted) showError(context, error);
                      } finally {
                        if (mounted) setState(() => exporting = false);
                      }
                    },
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
                  if (!flight && record['railRoute'] is Map) ...[
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
                        ),
                      ),
                    ),
                  ],
                  if (!store.demo) ...[
                    const Divider(),
                    TextButton.icon(
                      style: TextButton.styleFrom(foregroundColor: ticketRed),
                      onPressed: store.busy
                          ? null
                          : () async {
                              if (await confirmDeletion(context)) {
                                try {
                                  await store.delete(record);
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
    var active = false;
    return [
      const SectionTitle('列车全程'),
      if (stops.isNotEmpty)
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: DataTable(
            horizontalMargin: 12,
            columnSpacing: 28,
            columns: [
              '车站',
              '到达',
              '出发',
              '距始发 km',
            ].map((label) => DataColumn(label: Text(label))).toList(),
            rows: stops.map((stop) {
              if (stop['station'] == record.text('origin')) active = true;
              final selected = active;
              if (stop['station'] == record.text('destination')) active = false;
              return DataRow(
                color: selected ? const WidgetStatePropertyAll(mist) : null,
                cells:
                    [
                          stop['station'],
                          stop['arrivalTime'],
                          stop['departureTime'],
                          stop['distanceKm'],
                        ]
                        .map(
                          (value) => DataCell(Text((value ?? '').toString())),
                        )
                        .toList(),
              );
            }).toList(),
          ),
        ),
      for (final stock in (journey['trainsets'] as List? ?? [])) ...[
        SectionTitle(stock['id']?.toString() ?? '乘坐车组'),
        for (final key in [
          'manufacturer',
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
                '${{'manufacturer': '制造商', 'depot': '动车所', 'trainDepot': '车辆归属', 'socket': '电源插座', 'customType': '运营配置', 'modelRemark': '车型备注', 'carRemark': '车组备注'}[key]}：${stock[key]}',
              ),
            ),
      ],
    ];
  }
}

Future<bool> confirmDeletion(BuildContext context) async {
  final first = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('删除这张票据？'),
      content: const Text('删除后会同步到私人票库。'),
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
  final answer = TextEditingController();
  var correct = false;
  final seed = DateTime.now().millisecond, a = seed % 8 + 2, b = seed % 6 + 2;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, update) => AlertDialog(
        title: const Text('最后确认'),
        content: TextField(
          controller: answer,
          autofocus: true,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(
            labelText: '$a × $b = ?',
            errorText: answer.text.isNotEmpty && !correct ? '计算结果不正确' : null,
          ),
          onChanged: (value) =>
              update(() => correct = int.tryParse(value) == a * b),
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
            child: const Text('确认删除'),
          ),
        ],
      ),
    ),
  );
  answer.dispose();
  return confirmed == true;
}
