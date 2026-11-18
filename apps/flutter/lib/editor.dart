import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:file_selector/file_selector.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'platform_services.dart';
import 'input_formatters.dart';
import 'seat_input.dart';
import 'import_review.dart';
import 'ticket_detail.dart';

Future<void> openEditor(
  BuildContext context,
  AppStore store, {
  TicketRecord? record,
}) async {
  await Navigator.of(context).push(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => TicketEditor(store, record: record),
    ),
  );
}

class TicketEditor extends StatefulWidget {
  final AppStore store;
  final TicketRecord? record;
  const TicketEditor(this.store, {super.key, this.record});
  @override
  State<TicketEditor> createState() => _TicketEditorState();
}

class _TicketEditorState extends State<TicketEditor> {
  final form = GlobalKey<FormState>();
  final fields = <String, TextEditingController>{};
  final barcodeText = TextEditingController();
  final scroll = ScrollController();
  final placeFocus = {'origin': FocusNode(), 'destination': FocusNode()};
  late final scanAvailable = SystemRecognition().available();
  late Map<String, dynamic> data;
  bool saving = false,
      querying = false,
      importing = false,
      generate = false,
      submitted = false;
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
    _replace(widget.record ?? TicketRecord.create());
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
    fields['barcodeName'] = TextEditingController(
      text: flight ? record.text('passenger') : '',
    );
    fields['sequence'] = TextEditingController();
    fields['status'] = TextEditingController(text: '1');
    error = '';
    submitted = false;
    generate = false;
  }

  @override
  void dispose() {
    for (final field in fields.values) {
      field.dispose();
    }
    for (final node in placeFocus.values) {
      node.dispose();
    }
    barcodeText.dispose();
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
      if (next.text(key) != value(key)) fields[key]!.text = next.text(key);
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
      var record = store.catalog.normalize(TicketRecord.fromJson(values()));
      if (record.missingFields.isNotEmpty) {
        throw FormatException(
          '请补全：${record.missingFields.map((key) => fieldLabels[key] ?? key).join('、')}',
        );
      }
      if (generate) {
        if (record.departure?.dayOfYear == null) {
          throw const FormatException('生成条码前，请填写出发月日');
        }
        final service = RegExp(r'^([A-Z0-9]{2,3}?)(\d{1,4}[A-Z]?)$')
            .firstMatch(record.text('service'));
        if (service == null) throw const FormatException('请检查航班号');
        final payload = encodeBoardingPass(
          passenger: RegExp(r'[\u3400-\u9fff]').hasMatch(value('passenger'))
              ? value('barcodeName')
              : value('passenger'),
          pnr: record.text('pnr'),
          origin: record.text('originCode'),
          destination: record.text('destinationCode'),
          carrier: service[1]!,
          flightNumber: service[2]!,
          date: record.departure!,
          cabin: record.text('seatClass'),
          seat: record.text('seat'),
          sequence: value('sequence'),
          status: value('status'),
        );
        final code = boardingRecords(
          ascii.encode(payload),
          store.catalog,
        ).single['boardingCode'];
        record = record.withChanges({
          'boardingCode': code,
          'boardingCodeSource': 'generated',
        });
      }
      await store.save(record);
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
      final before = TicketRecord.fromJson(values()),
          result = await client.lookup(store.catalog.normalize(before));
      final lookup = data['lookupValues'] as Map,
          sources = data['fieldSources'] as Map;
      for (final entry in result.entries) {
        if (entry.value == '' || entry.value == null) continue;
        if (!['railRoute', 'railJourney'].contains(entry.key) &&
            value(entry.key).isNotEmpty &&
            !sameValue(before[entry.key], lookup[entry.key])) {
          continue;
        }
        data[entry.key] = entry.value;
        fields[entry.key]?.text = entry.value.toString();
        lookup[entry.key] = cloneJson(entry.value);
        sources[entry.key] = 'railgo';
      }
    } catch (failure) {
      error = failure.toString().replaceFirst('FormatException: ', '');
    } finally {
      client.client.close();
      if (mounted) setState(() => querying = false);
    }
  }

  Future<void> scanImage() async {
    final provider = SystemRecognition();
    if (!await provider.available()) {
      if (mounted) showError(context, '此设备尚未接入系统扫描，可先手动录入或粘贴条码内容。');
      return;
    }
    final file = await openFile(
      acceptedTypeGroups: [
        const XTypeGroup(
          label: '票据图片',
          extensions: ['jpg', 'jpeg', 'png', 'heic'],
          mimeTypes: ['image/*'],
        ),
      ],
    );
    if (file == null) return;
    setState(() => importing = true);
    try {
      final records = parseRecognition(
        await provider.recognize(await file.readAsBytes()),
        store.catalog,
        flight: flight,
      );
      if (records.length > 1 && mounted) {
        if (widget.record != null) {
          throw const FormatException('编辑已有票据时，请扫描单个航段');
        }
        if (await reviewImport(context, store, records) && mounted) {
          Navigator.pop(context);
        }
        return;
      }
      if (records.isEmpty) throw const FormatException('没有识别到票据');
      if (widget.record != null &&
          records.single.isFlight != widget.record!.isFlight) {
        throw const FormatException('扫描结果的交通方式与当前票据不符，请另行录入');
      }
      if (mounted) {
        setState(
          () => _replace(
            records.single.withChanges({
              'id': data['id'],
              'createdAt': data['createdAt'],
            }),
          ),
        );
      }
    } catch (failure) {
      if (mounted) showError(context, failure);
    } finally {
      if (mounted) setState(() => importing = false);
    }
  }

  Future<void> decode() async {
    try {
      final bytes = utf8.encode(barcodeText.text);
      final decoded = boardingRecords(bytes, store.catalog);
      if (decoded.length > 1) {
        if (widget.record != null) {
          throw const FormatException('编辑已有票据时，请使用单个航段');
        }
        if (await reviewImport(context, store, decoded) && mounted) {
          Navigator.pop(context);
        }
        return;
      }
      if (decoded.isEmpty) throw const FormatException('未识别到登机牌条码，请检查完整内容');
      setState(
        () => _replace(
          decoded.single.withChanges({
            'id': data['id'],
            'createdAt': data['createdAt'],
          }),
        ),
      );
    } catch (failure) {
      showError(context, failure);
    }
  }

  Widget _scanControl() => FutureBuilder<bool>(
    future: scanAvailable,
    builder: (context, snapshot) => OutlinedButton.icon(
      onPressed: importing || snapshot.data != true ? null : scanImage,
      icon: const Icon(Icons.document_scanner_outlined),
      label: Text(
        importing
            ? '正在识别…'
            : snapshot.data == true
            ? '扫描票据图片'
            : '系统扫描待接入',
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !saving && !querying && !importing,
    child: Scaffold(
      appBar: AppBar(title: Text(widget.record == null ? '录入票据' : '编辑票据')),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
          child: FilledButton.icon(
            onPressed: saving || querying || importing ? null : save,
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
      body: AbsorbPointer(
        absorbing: saving || querying || importing,
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
                    if (widget.record == null)
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
                            barcodeText.clear();
                            _replace(
                              TicketRecord.create({'type': selection.single}),
                            );
                          }),
                        ),
                      ),
                    if (flight) ...[
                      const SectionTitle('登机牌条码或电子登机牌二维码'),
                      _scanControl(),
                      const SizedBox(height: 12),
                      TextField(
                        controller: barcodeText,
                        minLines: 2,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          labelText: '粘贴解码后的条码内容',
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextButton.icon(
                        onPressed: decode,
                        icon: const Icon(Icons.qr_code_scanner),
                        label: const Text('解码并填入'),
                      ),
                      if (scanned)
                        const Text(
                          '条码内容已填入并锁定。年份可以补充。',
                          style: TextStyle(color: muted),
                        ),
                    ] else ...[
                      _scanControl(),
                      const SizedBox(height: 16),
                      const SectionTitle('票面'),
                      DropdownButtonFormField<String>(
                        initialValue: data['template'] == 'rail-refund-receipt'
                            ? 'rail-receipt'
                            : data['template'],
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '票面样式'),
                        items: ticketTemplates.entries
                            .where(
                              (entry) =>
                                  entry.key.startsWith('rail-') &&
                                  entry.key != 'rail-refund-receipt',
                            )
                            .map(
                              (entry) => DropdownMenuItem(
                                value: entry.key,
                                child: Text(
                                  entry.value,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (value) =>
                            setState(() => data['template'] = value),
                      ),
                      if ([
                        'rail-receipt',
                        'rail-refund-receipt',
                      ].contains(data['template']))
                        SwitchListTile(
                          contentPadding: EdgeInsets.zero,
                          title: const Text('退票费凭证'),
                          value: data['template'] == 'rail-refund-receipt',
                          onChanged: (value) => setState(
                            () => data['template'] = value
                                ? 'rail-refund-receipt'
                                : 'rail-receipt',
                          ),
                        ),
                    ],
                    const SectionTitle('行程'),
                    if (flight)
                      DropdownButtonFormField<String>(
                        initialValue: data['flightStatus'],
                        isExpanded: true,
                        decoration: const InputDecoration(labelText: '机票状态'),
                        items: const [
                          DropdownMenuItem(value: 'normal', child: Text('正常')),
                          DropdownMenuItem(
                            value: 'open',
                            child: Text('Open 票'),
                          ),
                          DropdownMenuItem(
                            value: 'invalid',
                            child: Text('无效票'),
                          ),
                        ],
                        onChanged: (value) =>
                            setState(() => data['flightStatus'] = value),
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
                    if (!flight)
                      Padding(
                        padding: const EdgeInsets.only(top: 16),
                        child: OutlinedButton.icon(
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
                            querying ? '正在查询 RailGo…' : 'RailGo 查询并补全',
                          ),
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
                              onChanged: () => changed('seat'),
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
                            barcodeRequired: generate && pair[0] == 'pnr',
                          ),
                          _field(
                            pair[1],
                            barcodeRequired: generate && pair[1] == 'pnr',
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
                      const SectionTitle('填写信息生成条码'),
                      CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        title: const Text('生成 PDF417 条码'),
                        subtitle: scanned ? const Text('已扫描原码，无需重新填写') : null,
                        value: generate,
                        onChanged: scanned
                            ? null
                            : (value) => setState(() => generate = value!),
                        controlAffinity: ListTileControlAffinity.leading,
                      ),
                      if (generate) ...[
                        const Text(
                          '橙色 * 为生成条码所需。',
                          style: TextStyle(color: Color(0xFF955A0A)),
                        ),
                        const SizedBox(height: 16),
                        if (RegExp(r'[\u3400-\u9fff]')
                            .hasMatch(value('passenger')))
                          _field(
                            'barcodeName',
                            label: '英文姓名（姓/名）',
                            barcodeRequired: true,
                            uppercase: true,
                          ),
                        const SizedBox(height: 16),
                        _pair(
                          _field(
                            'sequence',
                            label: '值机序号',
                            barcodeRequired: true,
                          ),
                          _field(
                            'status',
                            label: '旅客状态代码',
                            barcodeRequired: true,
                          ),
                        ),
                      ],
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
                        'generated': '手动生成',
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
              color: barcodeRequired ? const Color(0xFF955A0A) : ticketRed,
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
  }) {
    final controller = fields.putIfAbsent(key, () => TextEditingController());
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextFormField(
          controller: controller,
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
                  final picked = await showTimePicker(
                    context: context,
                    initialTime: TimeOfDay(
                      hour: int.tryParse(parts.first) ?? 9,
                      minute: parts.length > 1
                          ? int.tryParse(parts[1]) ?? 0
                          : 0,
                    ),
                  );
                  if (picked != null) {
                    setState(() {
                      controller.text =
                          '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
                      changed(key);
                    });
                  }
                },
          validator: (value) =>
              (requiredFields.contains(key) || barcodeRequired) &&
                  (value ?? '').trim().isEmpty
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
        onSelected: (place) {
          fields[side]!.text = place.name;
          changed(side);
          data['${side}Code'] = flight ? place.code : place.text('pinyin');
        },
        fieldViewBuilder: (context, controller, focus, onSubmit) =>
            TextFormField(
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
  Widget _date(String key, String label, {bool required = false}) {
    final date = JourneyDate.fromJson(data[key]),
        anchor = DateTime.utc(date?.year ?? 2000, 1, date?.dayOfYear ?? 1);
    final dayLocked = key == 'departureDate' && locked(key);
    final yearField = TextFormField(
      controller: fields['$key-year'],
      keyboardType: TextInputType.number,
      decoration: const InputDecoration(labelText: '年份'),
      validator: (text) {
        final year = int.tryParse(text ?? '');
        if ((text ?? '').isNotEmpty &&
            (year == null || year < 1800 || year > 2200)) {
          return '年份无效';
        }
        try {
          JourneyDate(year, date?.dayOfYear);
        } on FormatException {
          return '该年份没有此日期';
        }
        return null;
      },
      onChanged: (text) {
        final year = int.tryParse(text);
        if (year == null && text.isNotEmpty) return;
        try {
          setState(() {
            data[key] = JourneyDate(year, date?.dayOfYear).toJson();
            (data['fieldSources'] as Map)['${key}Year'] = 'manual';
            if (!dayLocked) changed(key);
          });
        } on FormatException {
          /* Validator retains the year input. */
        }
      },
    );
    final dayField = FormField<int>(
      initialValue: date?.dayOfYear,
      validator: (_) =>
          required && JourneyDate.fromJson(data[key])?.dayOfYear == null
          ? '请选择月日'
          : null,
      builder: (state) => InkWell(
        onTap: dayLocked
            ? null
            : () async {
                final picked = await showDatePicker(
                  context: context,
                  initialDate: date?.date ?? DateTime.now(),
                  firstDate: DateTime(1800),
                  lastDate: DateTime(2200),
                );
                if (picked != null) {
                  setState(() {
                    data[key] = JourneyDate.calendar(
                      picked.year,
                      picked.month,
                      picked.day,
                    ).toJson();
                    fields['$key-year']!.text = '${picked.year}';
                    changed(key);
                    state.didChange(JourneyDate.fromJson(data[key])!.dayOfYear);
                  });
                }
              },
        child: InputDecorator(
          decoration: InputDecoration(
            label: Text.rich(
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
            ),
            errorText: state.errorText,
            suffixIcon: Icon(
              dayLocked ? Icons.lock_outline : Icons.calendar_today_outlined,
              size: 20,
            ),
          ),
          child: Text(
            date?.dayOfYear == null
                ? '选择月日'
                : date?.year == null
                ? '第 ${date?.dayOfYear} 天'
                : '${anchor.month}月${anchor.day}日',
          ),
        ),
      ),
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
