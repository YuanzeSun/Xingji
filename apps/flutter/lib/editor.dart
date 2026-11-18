import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:file_selector/file_selector.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
import 'field_labels.dart';
import 'platform_services.dart';
import 'input_formatters.dart';
import 'seat_input.dart';
import 'import_review.dart';
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
}) async {
  if (!await checkArchiveWrite(context, store) || !context.mounted) return;
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
  JourneyDate? railStart;
  bool saving = false,
      querying = false,
      importing = false,
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
    final picked = await showDatePicker(
      context: context,
      initialDate: railStart?.date ?? boarding,
      firstDate: DateTime(1800),
      lastDate: boarding,
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
        setState(() => _applyRecognition(records.single));
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
      if (mounted) setState(() => _applyRecognition(decoded.single));
    } catch (failure) {
      showError(context, failure);
    }
  }

  void _applyRecognition(TicketRecord recognized) {
    final draft = TicketRecord.fromJson(values());
    final changes = <String, dynamic>{};
    final sources = draft.fieldSources;
    final manualLocks = draft.lockedFields;
    final lookup = Map<String, dynamic>.from(draft['lookupValues'] as Map);
    final replacingCode = recognized.text('boardingCodeSource') == 'original';
    if (replacingCode &&
        !sameValue(draft['boardingCode'], recognized['boardingCode'])) {
      sources.removeWhere((_, source) => source == 'barcode');
    }
    for (final entry in recognized.fieldSources.entries) {
      final key = entry.key, source = entry.value;
      final incoming = recognized[key];
      if (source == 'barcode' || (draft.text(key).isEmpty && incoming != '')) {
        changes[key] = incoming;
        sources[key] = source;
        manualLocks.remove(key);
        lookup.remove(key);
      }
    }
    if (replacingCode) {
      changes.addAll({
        'boardingCodeSource': 'original',
        'boardingCodeOperatingFlight': '',
        'boardingLegIndex': recognized['boardingLegIndex'],
      });
      final day = recognized.departure!.dayOfYear!;
      final savedYear = draft.departure?.year;
      final retained =
          savedYear != null && day <= JourneyDate.daysInYear(savedYear);
      final year = retained ? savedYear : recognized.departure!.year;
      changes['departureDate'] = JourneyDate(year, day).toJson();
      if (!retained) {
        sources.remove('departureDateYear');
        if (year != null) sources['departureDateYear'] = 'ocr';
      }
    } else if (widget.record == null && !dirty && !flight) {
      changes['template'] = recognized['template'];
    }
    final keepBarcodeInputs = flight && !replacingCode;
    final generationFields = {
      for (final key in ['barcodeName', 'sequence', 'status']) key: value(key),
    };
    _replace(
      draft.withChanges({
        ...changes,
        'fieldSources': sources,
        'lockedFields': manualLocks.toList(),
        'lookupValues': lookup,
      }),
    );
    if (keepBarcodeInputs) {
      for (final entry in generationFields.entries) {
        if (entry.key == 'barcodeName' &&
            draft.text('passenger') != value('passenger')) {
          continue;
        }
        fields[entry.key]!.text = entry.value;
      }
    }
    dirty = true;
  }

  bool get busy => saving || querying || importing;

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
            onPressed: !store.canWrite || saving || querying || importing
                ? null
                : save,
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
        busy: saving || querying || importing,
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
                            dirty = true;
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
                        onChanged: (_) => setState(() => dirty = true),
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
                        onChanged: (value) => setState(() {
                          dirty = true;
                          data['template'] = value;
                        }),
                      ),
                      if ([
                        'rail-receipt',
                        'rail-refund-receipt',
                      ].contains(data['template']))
                        SwitchListTile(
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
        TextFormField(
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
        setState(() {
          dirty = true;
          if (year == null && text.isNotEmpty) return;
          try {
            data[key] = JourneyDate(year, date?.dayOfYear).toJson();
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
