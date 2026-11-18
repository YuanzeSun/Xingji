import 'dart:convert';

import 'package:cupertino_ui/cupertino_ui.dart' show CupertinoButton;
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'archive_choice_field.dart';
import 'archive_text_field.dart';
import 'design.dart';
import 'field_labels.dart';
import 'platform_services.dart';
import 'input_formatters.dart';
import 'seat_input.dart';
import 'sync_review.dart';

const _barcodeBlue = Color(0xFF32658D);
final _chineseName = RegExp(r'[\u3400-\u9fff]');
final _flightNumber = RegExp(
  r'^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\s*(\d{1,4}[A-Z]?)$',
);

Future<void> openEditor(
  BuildContext context,
  AppStore store, {
  TicketRecord? record,
  TicketRecord? recognized,
}) async {
  if (!await checkArchiveWrite(context, store) || !context.mounted) return;
  await Navigator.of(context).push(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) =>
          TicketEditor(store, record: record, recognized: recognized),
    ),
  );
}

class TicketEditor extends StatefulWidget {
  final AppStore store;
  final TicketRecord? record;
  final TicketRecord? recognized;
  const TicketEditor(this.store, {super.key, this.record, this.recognized})
    : assert(record == null || recognized == null);
  @override
  State<TicketEditor> createState() => _TicketEditorState();
}

class _TicketEditorState extends State<TicketEditor> {
  final form = GlobalKey<FormState>();
  final fields = <String, TextEditingController>{};
  final scroll = ScrollController();
  final placeFocus = {'origin': FocusNode(), 'destination': FocusNode()};

  Future<DateTime?> _pickDate(
    DateTime initial,
    DateTime first,
    DateTime last,
  ) async {
    if (AppleServices.available) {
      try {
        return await AppleServices.pickDate(initial, first, last);
      } catch (error) {
        if (mounted) showError(context, error);
        return null;
      }
    }
    return showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
    );
  }

  late Map<String, dynamic> data;
  JourneyDate? railStart;
  bool saving = false,
      querying = false,
      submitted = false,
      dirty = false,
      confirmingExit = false;
  bool electronicMarker = false;
  int revision = 0;
  String error = '';
  AppStore get store => widget.store;
  bool get flight => data['type'] == 'flight';
  bool get scanned =>
      data['boardingCodeSource'] == 'original' && data['boardingCode'] is Map;
  bool locked(String key) =>
      scanned && (data['fieldSources'] as Map)[key] == 'barcode';
  @override
  void initState() {
    super.initState();
    _replace(widget.record ?? widget.recognized ?? TicketRecord.create());
    dirty = widget.recognized != null;
  }

  void _replace(TicketRecord record) {
    if (widget.record == null) {
      record = applyProfileDefaults(
        record,
        store.settings['profile'] as Map? ?? {},
        store.catalog,
      );
    }
    for (final controller in fields.values) {
      controller.dispose();
    }
    fields.clear();
    data = record.toJson();
    final journey = record['railJourney'];
    final savedStart = journey is Map
        ? JourneyDate.fromJson(journey['query']?['startDate'])
        : null;
    railStart = savedStart?.calendarText == record.departure?.calendarText
        ? null
        : savedStart;
    revision++;
    for (final key in fieldLabels.keys) {
      if (!journeyDateFields.contains(key)) {
        fields[key] = TextEditingController(text: record.text(key));
      }
    }
    for (final key in journeyDateFields) {
      fields['$key-year'] = TextEditingController(
        text: JourneyDate.fromJson(record[key])?.year?.toString() ?? '',
      );
    }
    final code = record['boardingCode'];
    final saved = code is Map && code['rawBytes'] is String
        ? decodeBoardingBytes(base64Decode(code['rawBytes'] as String))
        : null;
    electronicMarker = saved?['electronic'] == 'E';
    fields['barcodeName'] = TextEditingController(
      text:
          saved?['passenger'] ?? _profileBarcodeName(record.text('passenger')),
    );
    fields['sequence'] = TextEditingController(text: saved?['sequence'] ?? '');
    fields['status'] = TextEditingController(text: saved?['status'] ?? '');
    error = '';
    submitted = false;
  }

  @override
  void dispose() {
    for (final field in fields.values) {
      field.dispose();
    }
    for (final node in placeFocus.values) {
      node.dispose();
    }
    scroll.dispose();
    super.dispose();
  }

  String value(String key) => fields[key]?.text ?? (data[key] ?? '').toString();
  Map<String, dynamic> values() => {
    ...data,
    for (final entry in fields.entries.where(
      (entry) => fieldLabels.containsKey(entry.key),
    ))
      entry.key: entry.value.text,
  };
  void changed(String key) {
    dirty = true;
    if (!fieldLabels.containsKey(key)) return;
    if (flight && key == 'passenger') {
      fields['barcodeName']!.text = _profileBarcodeName(value('passenger'));
    }
    (data['fieldSources'] as Map)[key] = 'manual';
    final lockedFields = Set<String>.from(data['lockedFields']);
    lockedFields.add(key);
    data['lockedFields'] = lockedFields.toList();
    if (['origin', 'destination', 'service', 'departureDate'].contains(key)) {
      final lookup = data['lookupValues'] as Map;
      for (final automatic in lookup.keys.toList()) {
        if (lockedFields.contains(automatic) ||
            !sameValue(values()[automatic], lookup[automatic])) {
          continue;
        }
        data[automatic] = '';
        fields[automatic]?.clear();
        fields['$automatic-year']?.clear();
        lookup.remove(automatic);
        (data['fieldSources'] as Map).remove(automatic);
      }
    }
    if (['origin', 'destination'].contains(key)) {
      data['${key}Code'] = '';
      // Route snapshots describe the previous endpoints until explicitly refreshed.
      data['railRoute'] = '';
      data['railJourney'] = '';
      _refreshProfile();
    }
    if (!flight && ['service', 'departureDate'].contains(key)) {
      railStart = null;
      data['railRoute'] = '';
      data['railJourney'] = '';
    }
  }

  void _refreshProfile() {
    final next = applyProfileDefaults(
      TicketRecord.fromJson(values()),
      store.settings['profile'] as Map? ?? {},
      store.catalog,
    );
    for (final key in ['passenger', 'identity']) {
      if (next.text(key) == value(key)) continue;
      fields[key]!.text = next.text(key);
      if (flight && key == 'passenger') {
        fields['barcodeName']!.text = _profileBarcodeName(next.text(key));
      }
    }
    data['fieldSources'] = next.fieldSources;
  }

  Set<String> get requiredFields =>
      flight && ['open', 'invalid'].contains(data['flightStatus'])
      ? {'origin', 'destination', 'passenger'}
      : data['template'] == 'rail-refund-receipt'
      ? {'origin', 'destination', 'service', 'passenger', 'identity', 'price'}
      : {
          'origin',
          'destination',
          'service',
          'departureTime',
          'passenger',
          'identity',
          'seat',
          'seatClass',
          if (!flight) 'carriage',
        };
  String _profileBarcodeName(String passenger) {
    final profile = personalProfile(store.settings['profile'] as Map? ?? {});
    if (profile['autoFill'] == false ||
        !_chineseName.hasMatch(passenger) ||
        profile['chineseName'] != passenger) {
      return '';
    }
    return [profile['lastName'], profile['firstName']].join('/');
  }

  Map<String, dynamic>? _generatedCode(TicketRecord record) {
    final date = record.departure;
    if (date?.dayOfYear == null) return null;
    final operating = record.text('boardingCodeOperatingFlight');
    final flight = _flightNumber.firstMatch(
      operating.isEmpty ? record.text('service') : operating,
    );
    if (flight == null) return null;
    final passenger = record.text('passenger'),
        cabin = record.text('seatClass');
    try {
      final payload = encodeBoardingPass(
        passenger: _chineseName.hasMatch(passenger)
            ? value('barcodeName')
            : passenger,
        pnr: record.text('pnr'),
        origin: record.text('originCode'),
        destination: record.text('destinationCode'),
        carrier: flight[1]!,
        flightNumber: flight[2]!,
        date: date!,
        cabin:
            const {
              '': 'Y',
              '经济舱': 'Y',
              '超级经济舱': 'W',
              '公务舱': 'C',
              '头等舱': 'F',
            }[cabin] ??
            cabin,
        seat: record.text('seat'),
        sequence: value('sequence'),
        status: value('status'),
        electronic: electronicMarker,
      );
      final code = pdf417BoardingCode(ascii.encode(payload));
      final saved = record.text('boardingCodeSource') == 'generated'
          ? record['boardingCode'] as Map?
          : null;
      return {...code, ...?saved, 'rawBytes': code['rawBytes']};
    } on FormatException {
      return null;
    }
  }

  TicketRecord _withAutomaticCode(TicketRecord record) {
    if (!record.isFlight || scanned) return record;
    final code = _generatedCode(record);
    final sources = record.fieldSources;
    if (code != null) {
      sources['boardingCode'] = 'generated';
      return record.withChanges({
        'boardingCode': code,
        'boardingCodeSource': 'generated',
        'boardingLegIndex': '0',
        'fieldSources': sources,
      });
    }
    if (record.text('boardingCodeSource') != 'generated') return record;
    sources.remove('boardingCode');
    return record.withChanges({
      'boardingCode': '',
      'boardingCodeSource': '',
      'boardingCodeOperatingFlight': '',
      'boardingLegIndex': '',
      'fieldSources': sources,
    });
  }

  bool get _barcodeReady =>
      !scanned &&
      value('sequence').trim().isNotEmpty &&
      value('status').trim().isNotEmpty &&
      _generatedCode(
            store.catalog.normalize(
              TicketRecord.fromJson(values()),
              original: widget.record,
            ),
          ) !=
          null;

  Future<void> save() async {
    setState(() {
      submitted = true;
      error = '';
    });
    if (!form.currentState!.validate()) {
      setState(() => error = '请补全下方标红的必填项');
      await scroll.animateTo(
        0,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
      return;
    }
    setState(() => saving = true);
    try {
      final record = store.catalog.normalize(
        TicketRecord.fromJson(values()),
        original: widget.record,
      );
      if (record.missingFields.isNotEmpty) {
        throw FormatException(
          '请补全：${record.missingFields.map((key) => fieldLabels[key] ?? key).join('、')}',
        );
      }
      await store.save(
        _withAutomaticCode(record),
        original: widget.record,
        pick: pickSyncConflicts(context),
      );
      if (mounted) Navigator.pop(context);
    } catch (failure) {
      if (mounted) {
        setState(
          () =>
              error = failure.toString().replaceFirst('FormatException: ', ''),
        );
        await scroll.animateTo(
          0,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> lookupRail() async {
    setState(() {
      querying = true;
      error = '';
    });
    final client = RailGoClient(store.catalog);
    try {
      final before = TicketRecord.fromJson(values());
      final result = await client.lookup(
        store.catalog.normalize(before),
        startDate: railStart,
      );
      if (!mounted) return;
      dirty = true;
      final lookup = data['lookupValues'] as Map,
          sources = data['fieldSources'] as Map;
      final start = JourneyDate.fromJson(
        result['railJourney']['query']['startDate'],
      );
      railStart = start?.calendarText == before.departure?.calendarText
          ? null
          : start;
      for (final entry in result.entries) {
        if ((entry.value == '' || entry.value == null) &&
            entry.key != 'railRoute' &&
            !before.isAutomatic(entry.key)) {
          continue;
        }
        if (!['railRoute', 'railJourney'].contains(entry.key) &&
            (before.lockedFields.contains(entry.key) ||
                before.barcodeLocked(entry.key) ||
                (value(entry.key).isNotEmpty &&
                    !before.isAutomatic(entry.key)))) {
          continue;
        }
        data[entry.key] = entry.value;
        fields[entry.key]?.text = entry.value.toString();
        if (journeyDateFields.contains(entry.key)) {
          fields['${entry.key}-year']?.text =
              JourneyDate.fromJson(entry.value)?.year?.toString() ?? '';
        }
        if (entry.value == '' || entry.value == null) {
          lookup.remove(entry.key);
          sources.remove(entry.key);
        } else {
          lookup[entry.key] = cloneJson(entry.value);
          sources[entry.key] = 'railgo';
        }
      }
    } catch (failure) {
      error = failure.toString().replaceFirst('FormatException: ', '');
    } finally {
      client.close();
      if (mounted) setState(() => querying = false);
    }
  }

  Future<void> chooseRailStart() async {
    final boarding = JourneyDate.fromJson(data['departureDate'])?.date;
    if (boarding == null) return;
    final picked = await _pickDate(
      railStart?.date ?? boarding,
      DateTime(1800),
      boarding,
    );
    if (picked != null && mounted) {
      setState(() {
        dirty = true;
        railStart = DateUtils.isSameDay(picked, boarding)
            ? null
            : JourneyDate.fromDateTime(picked);
      });
    }
  }

  bool get busy => saving || querying;

  Future<void> confirmExit(bool didPop, Object? result) async {
    if (didPop || busy || !dirty || confirmingExit) return;
    confirmingExit = true;
    final discard = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('放弃未保存的修改？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('继续编辑'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('放弃修改'),
          ),
        ],
      ),
    );
    confirmingExit = false;
    if (mounted && discard == true) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) => _buildEditor(context),
  );

  Widget _buildEditor(BuildContext context) => PopScope(
    canPop: !busy && !dirty,
    onPopInvokedWithResult: confirmExit,
    child: Scaffold(
      appBar: AppBar(title: Text(widget.record == null ? '录入票据' : '编辑票据')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
          child: FilledButton.icon(
            onPressed: !store.canWrite || busy ? null : save,
            icon: saving
                ? const SizedBox.square(
                    dimension: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.check),
            label: Text(saving ? '正在保存…' : '保存票据'),
          ),
        ),
      ),
      body: ArchiveEditControls(
        enabled: store.canWrite,
        busy: busy,
        child: Form(
          key: form,
          autovalidateMode: submitted
              ? AutovalidateMode.onUserInteraction
              : AutovalidateMode.disabled,
          child: SingleChildScrollView(
            controller: scroll,
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 760),
                child: Column(
                  key: ValueKey(revision),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (store.readOnlyReason case final reason?)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: Text(reason),
                      ),
                    if (error.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 20),
                        child: Semantics(
                          liveRegion: true,
                          child: Material(
                            color: Theme.of(context).colorScheme.errorContainer,
                            borderRadius: BorderRadius.circular(12),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Row(
                                children: [
                                  const Icon(Icons.error_outline),
                                  const SizedBox(width: 12),
                                  Expanded(child: Text(error)),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (widget.record == null && widget.recognized == null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 24),
                        child: SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(
                              value: 'rail',
                              label: Text('火车票'),
                              icon: Icon(Icons.train_outlined),
                            ),
                            ButtonSegment(
                              value: 'flight',
                              label: Text('机票'),
                              icon: Icon(Icons.flight_outlined),
                            ),
                          ],
                          selected: {data['type']},
                          onSelectionChanged: (selection) => setState(() {
                            dirty = true;
                            _replace(
                              TicketRecord.create({'type': selection.single}),
                            );
                          }),
                        ),
                      ),
                    if (scanned)
                      const Padding(
                        padding: EdgeInsets.only(bottom: 16),
                        child: Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 6,
                          children: [
                            Icon(Icons.lock_outline, size: 16, color: muted),
                            Text(
                              '条码内容已填入并锁定。年份可以补充。',
                              style: TextStyle(color: muted),
                            ),
                          ],
                        ),
                      ),
                    if (!flight) ...[
                      ArchiveChoiceField<String>(
                        label: '票面样式',
                        value: data['template'] == 'rail-refund-receipt'
                            ? 'rail-receipt'
                            : data['template'],
                        choices: {
                          for (final entry in ticketTemplates.entries)
                            if (entry.key.startsWith('rail-') &&
                                entry.key != 'rail-refund-receipt')
                              entry.key: entry.value,
                        },
                        onChanged: (value) => setState(() {
                          dirty = true;
                          data['template'] = value;
                        }),
                      ),
                      if ([
                        'rail-receipt',
                        'rail-refund-receipt',
                      ].contains(data['template']))
                        SwitchListTile.adaptive(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('退票费凭证'),
                          value: data['template'] == 'rail-refund-receipt',
                          onChanged: (value) => setState(() {
                            dirty = true;
                            data['template'] = value
                                ? 'rail-refund-receipt'
                                : 'rail-receipt';
                          }),
                        ),
                    ],
                    const SectionTitle('行程'),
                    if (flight)
                      ArchiveChoiceField<String>(
                        label: '机票状态',
                        value: data['flightStatus'],
                        choices: const {
                          'normal': '正常',
                          'open': 'Open 票',
                          'invalid': '无效票',
                        },
                        onChanged: (value) => setState(() {
                          dirty = true;
                          data['flightStatus'] = value;
                        }),
                      ),
                    const SizedBox(height: 16),
                    _pair(
                      _place('origin', flight ? '出发机场' : '出发站'),
                      _place('destination', flight ? '到达机场' : '到达站'),
                    ),
                    const SizedBox(height: 16),
                    _field(
                      'service',
                      label: flight ? '航班号' : '车次',
                      uppercase: true,
                    ),
                    const SizedBox(height: 16),
                    _date(
                      'departureDate',
                      flight ? '计划起飞日期' : '出发日期',
                      required: !flight || data['flightStatus'] == 'normal',
                    ),
                    if (!flight && data['template'] != 'rail-refund-receipt')
                      Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            OutlinedButton.icon(
                              onPressed: querying ? null : lookupRail,
                              icon: querying
                                  ? const SizedBox.square(
                                      dimension: 18,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    )
                                  : const Icon(Icons.auto_awesome_outlined),
                              label: Text(
                                querying
                                    ? '正在查询 RailGo…'
                                    : data['railJourney'] is Map
                                    ? '刷新 RailGo 资料'
                                    : 'RailGo 查询并补全',
                              ),
                            ),
                            if (JourneyDate.fromJson(data['departureDate'])
                                    ?.complete ==
                                true)
                              TextButton.icon(
                                onPressed: querying ? null : chooseRailStart,
                                icon: const Icon(
                                  Icons.calendar_today_outlined,
                                  size: 16,
                                ),
                                label: Text(
                                  railStart == null
                                      ? '调整列车始发日'
                                      : '始发日 ${railStart!.label}',
                                ),
                              ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 16),
                    _pair(
                      _field(
                        'departureTime',
                        label: flight ? '计划起飞时间' : '出发时间',
                        time: true,
                      ),
                      _field(
                        'arrivalTime',
                        label: flight ? '计划到达时间' : '到达时间',
                        time: true,
                      ),
                    ),
                    const SizedBox(height: 16),
                    _date('arrivalDate', flight ? '计划到达日期' : '到达日期'),
                    const SectionTitle('旅客与座位'),
                    _pair(
                      _field('passenger', uppercase: flight),
                      _field('identity'),
                    ),
                    const SizedBox(height: 16),
                    _field(
                      'seatClass',
                      label: flight ? '舱位代码' : '席别',
                      uppercase: flight,
                    ),
                    const SizedBox(height: 16),
                    if (!flight)
                      _pair(
                        _field('carriage'),
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            SeatInput(
                              controller: fields['seat']!,
                              seatClass: value('seatClass'),
                              required: requiredFields.contains('seat'),
                              locked: locked('seat'),
                              onChanged: () => setState(() => changed('seat')),
                            ),
                            _source('seat'),
                          ],
                        ),
                      )
                    else
                      _pair(
                        _field('seat', label: '座位'),
                        _field('boardingTime', time: true),
                      ),
                    const SizedBox(height: 16),
                    _pair(
                      _field('gate', label: flight ? '登机口' : '检票口'),
                      _field(flight ? 'terminal' : 'railPlatform'),
                    ),
                    const SectionTitle('更多信息'),
                    for (final pair
                        in (flight
                            ? [
                                ['airline', 'aircraft'],
                                ['aircraftRegistration', 'pnr'],
                                ['price', 'ticketNumber'],
                                ['baggageTagNumbers', 'checkedBaggageCount'],
                                [
                                  'freeBaggageAllowance',
                                  'frequentFlyerCarrier',
                                ],
                                ['frequentFlyerNumber', 'marketingCarrier'],
                                ['flightDistance', 'orderNumber'],
                              ]
                            : [
                                ['railBureau', 'railRunner'],
                                ['railCarOwner', 'railModel'],
                                ['railTrainsets', 'railPowerSupply'],
                                ['railMileage', 'price'],
                                ['ticketNumber', 'orderNumber'],
                                ['saleCode', 'issuer'],
                              ]))
                      Padding(
                        padding: const EdgeInsets.only(bottom: 16),
                        child: _pair(
                          _field(
                            pair[0],
                            barcodeRequired: flight && pair[0] == 'pnr',
                          ),
                          _field(
                            pair[1],
                            barcodeRequired: flight && pair[1] == 'pnr',
                          ),
                        ),
                      ),
                    if (flight) ...[
                      const SectionTitle('实际时间'),
                      _pair(
                        _field('actualDepartureTime', time: true),
                        _field('actualArrivalTime', time: true),
                      ),
                      const SizedBox(height: 16),
                      _date('actualDepartureDate', '实际起飞日期'),
                      const SizedBox(height: 16),
                      _date('actualArrivalDate', '实际落地日期'),
                      const SizedBox(height: 16),
                      _field('actualBoardingTime', time: true),
                      const SectionTitle('登机牌条码信息'),
                      if (scanned)
                        const Text('已使用原条码', style: TextStyle(color: muted))
                      else
                        const Text(
                          '填齐蓝色 * 后自动生成',
                          style: TextStyle(color: _barcodeBlue),
                        ),
                      const SizedBox(height: 16),
                      if (_chineseName.hasMatch(value('passenger'))) ...[
                        _field(
                          'barcodeName',
                          label: '英文姓名（姓/名）',
                          barcodeRequired: true,
                          uppercase: true,
                          enabled: !scanned,
                        ),
                        const SizedBox(height: 16),
                      ],
                      _pair(
                        _field(
                          'sequence',
                          label: '值机序号',
                          barcodeRequired: true,
                          uppercase: true,
                          enabled: !scanned,
                        ),
                        _field(
                          'status',
                          label: '旅客状态代码',
                          barcodeRequired: true,
                          enabled: !scanned,
                        ),
                      ),
                      if (_barcodeReady)
                        Padding(
                          padding: const EdgeInsets.only(top: 12),
                          child: Semantics(
                            liveRegion: true,
                            child: const Text(
                              '条码已自动生成',
                              style: TextStyle(color: muted),
                            ),
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  Widget _pair(Widget left, Widget right) => LayoutBuilder(
    builder: (context, constraints) =>
        MediaQuery.textScalerOf(context).scale(16) > 24 ||
            constraints.maxWidth < 340
        ? Column(children: [left, const SizedBox(height: 16), right])
        : Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: left),
              const SizedBox(width: 16),
              Expanded(child: right),
            ],
          ),
  );
  Widget _source(String key) {
    final source = (data['fieldSources'] as Map)[key];
    return source == null
        ? const SizedBox.shrink()
        : Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (locked(key))
                  const Padding(
                    padding: EdgeInsets.only(right: 4),
                    child: Icon(Icons.lock_outline, size: 13, color: muted),
                  ),
                Text(
                  {
                        'manual': '手动输入',
                        'barcode': '条码',
                        'ocr': '图像识别',
                        'railgo': 'RailGo',
                        'flight': '飞常准',
                        'variflight': '飞常准',
                        'profile': '个人资料',
                        'database': '地点数据库',
                        'generated': '自动生成',
                        'default': '默认值',
                        'import': '文件导入',
                        'pdf': 'PDF 导入',
                        'text': '文字导入',
                        'email': '邮件导入',
                        'csv': 'CSV 导入',
                        'lookup': '查询补全',
                      }[source] ??
                      source.toString(),
                  style: const TextStyle(fontSize: 12, color: muted),
                ),
              ],
            ),
          );
  }

  Widget _label(String key, String label, bool barcodeRequired) => Text.rich(
    TextSpan(
      children: [
        TextSpan(text: label),
        if (requiredFields.contains(key) || barcodeRequired)
          TextSpan(
            text: ' *',
            style: TextStyle(
              color: requiredFields.contains(key) ? ticketRed : _barcodeBlue,
            ),
          ),
      ],
    ),
  );
  Widget _field(
    String key, {
    String? label,
    bool uppercase = false,
    bool time = false,
    bool barcodeRequired = false,
    bool enabled = true,
  }) {
    final controller = fields.putIfAbsent(key, () => TextEditingController());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ArchiveTextField(
          controller: controller,
          enabled: enabled,
          readOnly: locked(key) || time,
          inputFormatters: uppercase ? [UppercaseInput()] : null,
          decoration: InputDecoration(
            label: _label(
              key,
              label ?? fieldLabels[key] ?? key,
              barcodeRequired,
            ),
            suffixIcon: time
                ? const Icon(Icons.schedule_outlined, size: 20)
                : null,
          ),
          onChanged: (_) => setState(() => changed(key)),
          onTap: !time || locked(key)
              ? null
              : () async {
                  final parts = controller.text.split(':');
                  final initial = TimeOfDay(
                    hour: int.tryParse(parts.first) ?? 9,
                    minute: parts.length > 1 ? int.tryParse(parts[1]) ?? 0 : 0,
                  );
                  TimeParts? picked;
                  try {
                    if (AppleServices.available) {
                      FocusScope.of(context).unfocus();
                      picked = await AppleServices.pickTime(
                        initial.hour,
                        initial.minute,
                      );
                    } else {
                      final time = await showTimePicker(
                        context: context,
                        initialTime: initial,
                      );
                      if (time != null) {
                        picked = (hour: time.hour, minute: time.minute);
                      }
                    }
                  } catch (error) {
                    if (mounted) showError(context, error);
                    return;
                  }
                  if (picked != null && mounted) {
                    final (hour: hour, minute: minute) = picked;
                    setState(() {
                      controller.text =
                          '${hour.toString().padLeft(2, '0')}:${minute.toString().padLeft(2, '0')}';
                      changed(key);
                    });
                  }
                },
          validator: (value) =>
              requiredFields.contains(key) && (value ?? '').trim().isEmpty
              ? '请填写${label ?? fieldLabels[key] ?? key}'
              : null,
        ),
        _source(key),
      ],
    );
  }

  Widget _place(String side, String label) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Autocomplete<Place>(
        textEditingController: fields[side],
        focusNode: placeFocus[side],
        optionsBuilder: (text) => locked(side)
            ? const Iterable<Place>.empty()
            : store.catalog.search(text.text, flight: flight),
        displayStringForOption: (place) => place.name,
        onSelected: (place) => setState(() {
          fields[side]!.text = place.name;
          changed(side);
          data['${side}Code'] = flight ? place.code : place.text('pinyin');
        }),
        fieldViewBuilder: (context, controller, focus, onSubmit) =>
            ArchiveTextField(
              controller: controller,
              focusNode: focus,
              readOnly: locked(side),
              decoration: InputDecoration(label: _label(side, label, false)),
              onChanged: (_) => setState(() => changed(side)),
              validator: (value) =>
                  (value ?? '').trim().isEmpty ? '请选择$label' : null,
            ),
        optionsViewBuilder: (context, onSelected, options) => Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 8,
            borderRadius: BorderRadius.circular(12),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxHeight: 260, maxWidth: 300),
              child: ListView(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                children: options
                    .map(
                      (place) => ListTile(
                        title: Text(
                          '${place.name}${flight ? '  ${place.code}' : ''}',
                          maxLines: 2,
                        ),
                        subtitle: Text(place.city),
                        onTap: () => onSelected(place),
                      ),
                    )
                    .toList(),
              ),
            ),
          ),
        ),
      ),
      _source(side),
    ],
  );
  Future<(int, int)?> _pickMonthDay(DateTime initial) async {
    if (AppleServices.available) {
      try {
        return await AppleServices.pickMonthDay(initial);
      } catch (error) {
        if (mounted) showError(context, error);
        return null;
      }
    }
    var month = initial.month, day = initial.day;
    return showDialog<(int, int)>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('选择月日'),
          content: Wrap(
            spacing: 20,
            children: [
              DropdownButton<int>(
                value: month,
                items: [
                  for (var value = 1; value <= 12; value++)
                    DropdownMenuItem(value: value, child: Text('$value月')),
                ],
                onChanged: (value) => update(() {
                  month = value!;
                  final limit = DateTime.utc(initial.year, month + 1, 0).day;
                  if (day > limit) day = limit;
                }),
              ),
              DropdownButton<int>(
                value: day,
                items: [
                  for (
                    var value = 1;
                    value <= DateTime.utc(initial.year, month + 1, 0).day;
                    value++
                  )
                    DropdownMenuItem(value: value, child: Text('$value日')),
                ],
                onChanged: (value) => update(() => day = value!),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, (month, day)),
              child: const Text('完成'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _date(String key, String label, {bool required = false}) {
    final date = JourneyDate.fromJson(data[key]),
        anchor = DateTime.utc(date?.year ?? 2000, 1, date?.dayOfYear ?? 1);
    final dayLocked = key == 'departureDate' && locked(key);
    final showLockedDate =
        date?.year != null &&
        int.tryParse(fields['$key-year']!.text) == date?.year;
    final yearField = ArchiveTextField(
      controller: fields['$key-year']!,
      native: true,
      keyboardType: TextInputType.number,
      decoration: const InputDecoration(labelText: '年份'),
      validator: (text) {
        final year = int.tryParse(text ?? '');
        if ((text ?? '').isNotEmpty &&
            (year == null || year < 1800 || year > 2200)) {
          return '年份无效';
        }
        try {
          if (dayLocked || date?.dayOfYear == null) {
            JourneyDate(year, date?.dayOfYear);
          } else {
            JourneyDate.calendar(year ?? 2000, anchor.month, anchor.day);
          }
        } on FormatException {
          return '该年份没有此日期';
        }
        return null;
      },
      onChanged: (text) {
        final year = int.tryParse(text);
        setState(() {
          dirty = true;
          if (year == null && text.isNotEmpty) return;
          try {
            final ordinal = dayLocked || date?.dayOfYear == null
                ? date?.dayOfYear
                : JourneyDate.calendar(
                    year ?? 2000,
                    anchor.month,
                    anchor.day,
                  ).dayOfYear;
            data[key] = JourneyDate(year, ordinal).toJson();
            (data['fieldSources'] as Map)['${key}Year'] = 'manual';
            if (!dayLocked) changed(key);
          } on FormatException {
            // Validator retains the year input.
          }
        });
      },
    );
    final dayField = FormField<int>(
      initialValue: date?.dayOfYear,
      validator: (_) =>
          required && JourneyDate.fromJson(data[key])?.dayOfYear == null
          ? '请选择月日'
          : null,
      builder: (state) {
        Future<void> pickDay() async {
          final today = DateTime.now();
          final year = date?.year ?? 2000;
          final initial = date?.dayOfYear == null
              ? DateTime.utc(year, today.month, today.day)
              : anchor;
          final picked = await _pickMonthDay(initial);
          if (picked == null || !mounted || !state.mounted) return;
          setState(() {
            final ordinal = JourneyDate.calendar(
              year,
              picked.$1,
              picked.$2,
            ).dayOfYear;
            data[key] = JourneyDate(date?.year, ordinal).toJson();
            changed(key);
            state.didChange(ordinal);
          });
        }

        final monthDayLabel = Text.rich(
          TextSpan(
            children: [
              const TextSpan(text: '月日'),
              if (required)
                const TextSpan(
                  text: ' *',
                  style: TextStyle(color: ticketRed),
                ),
            ],
          ),
        );
        final value = dayLocked && !showLockedDate
            ? ''
            : date?.dayOfYear == null
            ? '选择月日'
            : '${anchor.month}月${anchor.day}日';
        if (AppleServices.available) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              archiveInputLabel(context, monthDayLabel),
              const SizedBox(height: 5),
              SizedBox(
                height: archiveInputHeight(context),
                child: CupertinoButton(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  color: Colors.white,
                  disabledColor: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  onPressed: dayLocked ? null : pickDay,
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          value,
                          style: TextStyle(
                            color: value == '选择月日' ? muted : Colors.black,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Icon(
                        dayLocked
                            ? Icons.lock_outline
                            : Icons.calendar_today_outlined,
                        color: muted,
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
              if (state.errorText case final error?)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(error, style: const TextStyle(color: ticketRed)),
                ),
            ],
          );
        }
        return InkWell(
          onTap: dayLocked ? null : pickDay,
          child: InputDecorator(
            isEmpty: dayLocked && !showLockedDate,
            decoration: InputDecoration(
              label: monthDayLabel,
              errorText: state.errorText,
              suffixIcon: Icon(
                dayLocked ? Icons.lock_outline : Icons.calendar_today_outlined,
                size: 20,
              ),
            ),
            child: Text(value),
          ),
        );
      },
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 10),
        _pair(
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [yearField, _source('${key}Year')],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [dayField, _source(key)],
          ),
        ),
      ],
    );
  }
}
