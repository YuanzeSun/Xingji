import 'dart:convert';
import 'dart:typed_data';

import 'ticket_record.dart';
import 'reference_catalog.dart';
import 'journey_date.dart';
import 'identity.dart';
import 'boarding_decoder.dart';
import 'code_data.dart';

class RecognitionLine {
  final String text;
  final double x, y, width, height, confidence;
  RecognitionLine(
    this.text,
    this.x,
    this.y,
    this.width,
    this.height,
    this.confidence,
  );
  factory RecognitionLine.fromJson(Map<String, dynamic> row) => RecognitionLine(
    row['text'] as String,
    (row['x'] as num).toDouble(),
    (row['y'] as num).toDouble(),
    (row['width'] as num).toDouble(),
    (row['height'] as num).toDouble(),
    (row['confidence'] as num).toDouble(),
  );
}

class RecognitionResult {
  final List<RecognitionLine> lines;
  final List<Uint8List> barcodes;
  final List<Map<String, dynamic>> symbolData;
  final String paperColor;
  final bool hasTextLayer;
  final Map<String, String> railRegions;

  RecognitionResult({
    this.lines = const [],
    this.barcodes = const [],
    this.symbolData = const [],
    this.paperColor = '',
    this.hasTextLayer = false,
    this.railRegions = const {},
  });
  factory RecognitionResult.fromJson(
    Map<String, dynamic> value,
  ) => RecognitionResult(
    paperColor: value['paperColor'] as String? ?? '',
    hasTextLayer: value['hasTextLayer'] == true,
    railRegions: Map<String, String>.from(value['railRegions'] as Map? ?? {}),
    lines: (value['lines'] as List? ?? [])
        .map((row) => RecognitionLine.fromJson(Map<String, dynamic>.from(row)))
        .toList(),
    barcodes: (value['barcodes'] as List? ?? [])
        .map(
          (row) => Uint8List.fromList(base64Decode(row['rawBytes'] as String)),
        )
        .toList(),
    symbolData: (value['barcodes'] as List? ?? [])
        .where((row) => row['codeData'] is Map)
        .map((row) {
          final data = normalizeCodeData(row['codeData']);
          if (data['rawBytes'] != row['rawBytes']) {
            throw const FormatException('条码字节与重建数据不一致');
          }
          return data;
        })
        .toList(),
  );
}

abstract interface class RecognitionService {
  Future<bool> available();
  Future<RecognitionResult> recognize(Uint8List image);
}

const _scheduledBoardingLabels =
    r'(?:计划)?登\s*[机機](?:\s*[时時][间間刻])?(?:\s*[/／]?\s*BOARDING(?:\s+TIME)?)?'
    r'|BOARDING(?:\s+(?:TIME|BEGINS|AT))?|BOARD\s+TIME';
const _scheduledDepartureLabels =
    r'(?:计划)?起飞(?:时间|时刻)?(?:\s*[/／]?\s*(?:DEPARTURE(?:\s+TIME)?|STD))?|DEPARTURE(?:\s+TIME)?|STD';
const _flightGateLabels = r'登机口(?:\s*[/／]?\s*GATE)?|GATE';
const _flightGateCode = r'(?:[A-Z]{1,2}|(?=[A-Z0-9/-]*\d)[A-Z0-9/-]{1,16})';

bool isPrintedFlightGate(String value) =>
    RegExp('^$_flightGateCode\$', caseSensitive: false).hasMatch(value.trim());

/// Preserve Vision lines and reunite short labels with their nearby values.
String recognizedTicketText(List<RecognitionLine> source) {
  final lines = [...source]
    ..sort((a, b) => a.y == b.y ? a.x.compareTo(b.x) : a.y.compareTo(b.y));
  final labels = RegExp(
    r'^(?:航班号?|车次|出发站|到达站|出发机场|到达机场|出发日期|乘车日期|'
    r'计划到达|座位号?|(?:实际|预计)登机时间|航站楼|'
    r'FLIGHT(?: NO)?|TRAIN(?: NO)?|FROM|TO|ARRIVAL|SEAT|(?:ACTUAL|ESTIMATED) BOARDING TIME|TERMINAL|'
    '$_scheduledBoardingLabels|$_scheduledDepartureLabels|$_flightGateLabels'
    r')\s*[:：]?$',
    caseSensitive: false,
  );
  final flightGateLabel = RegExp(
    '^(?:$_flightGateLabels)\$',
    caseSensitive: false,
  );
  final result = [for (final line in lines) line.text];
  for (final label in lines) {
    final name = label.text.trim().replaceFirst(RegExp(r'[:：]$'), '');
    // PDF text-layer rows already span the document and don't carry field geometry.
    if (label.width >= .95 || !labels.hasMatch(name)) continue;
    final isFlightGate = flightGateLabel.hasMatch(name);
    final candidates = <(String, double)>[];
    for (final value in lines) {
      final text = value.text.trim();
      if (identical(value, label) ||
          text.isEmpty ||
          text.length > 50 ||
          labels.hasMatch(text) ||
          (isFlightGate && !isPrintedFlightGate(text)) ||
          value.width >= .95) {
        continue;
      }
      final toRight = value.x - (label.x + label.width);
      final verticalCenter =
          ((value.y + value.height / 2) - (label.y + label.height / 2)).abs();
      if (toRight >= -.012 &&
          toRight <= .21 &&
          verticalCenter <= (label.height + value.height) * .29) {
        candidates.add((text, toRight.abs() + verticalCenter));
        continue;
      }
      final below = value.y - (label.y + label.height);
      final aligned = (value.x - label.x).abs();
      if (below >= -.012 && below < .11 && aligned < .075) {
        candidates.add((text, below.abs() + aligned + .045));
      }
    }
    candidates.sort((a, b) => a.$2.compareTo(b.$2));
    if (candidates.isNotEmpty &&
        (candidates.length == 1 ||
            candidates[1].$2 - candidates[0].$2 > .012)) {
      result.add('$name: ${candidates.first.$1}');
    }
  }
  return result.join('\n');
}

List<TicketRecord> parseRecognition(
  RecognitionResult result,
  ReferenceCatalog catalog, {
  required bool flight,
}) {
  final boarding = <String, Uint8List>{
    for (final bytes in result.barcodes)
      if (decodeBoardingBytes(bytes) != null) base64Encode(bytes): bytes,
  };
  if (boarding.length > 1) {
    throw const FormatException('包含多个不同登机牌条码，请分别导入');
  }
  final text = recognizedTicketText(result.lines);
  final fields = readTravelFields(text, catalog, flight: flight);
  if (!flight)
    _fillPrintedRailRegions(fields, result.railRegions, text, catalog);
  final values = <String, dynamic>{
    'type': flight ? 'flight' : 'rail',
    'template': flight
        ? 'air-boarding-pass'
        : _printedRailTemplate(result.lines, result.paperColor, fields),
    ...fields,
    'fieldSources': {
      for (final name in fields.keys)
        if (name != 'template') name: 'ocr',
    },
  };

  if (boarding.isNotEmpty) {
    return boardingRecords(
      boarding.values.single,
      catalog,
      supplement: flight ? values : const {},
    );
  }

  if (!flight) {
    final codes = {
      for (final code in result.symbolData)
        if (['QRCode', 'MicroQRCode'].contains(code['format']))
          canonicalJson(code): code,
    };
    if (codes.length > 1) {
      throw const FormatException('包含多个不同二维码，请分别导入');
    }
    if (codes.isNotEmpty) values['ticketCode'] = codes.values.single;
  }
  return [catalog.normalize(TicketRecord.create(values))];
}

void _fillPrintedRailRegions(
  Map<String, dynamic> fields,
  Map<String, String> regions,
  String text,
  ReferenceCatalog catalog,
) {
  for (final side in ['origin', 'destination']) {
    final known = catalog.resolve(
      fields[side] as String? ?? '',
      '',
      flight: false,
    );
    if (known != null) continue;
    final candidates = <String>{};
    for (final line in (regions[side] ?? '').split('\n')) {
      final raw = line.trim();
      if (!RegExp(r"^[A-Za-z\u3400-\u9fff\s'’]{2,30}$").hasMatch(raw)) continue;
      final match = catalog.resolve(
        raw.replaceAll(RegExp(r'\s+'), ''),
        '',
        flight: false,
      );
      if (match != null &&
          match.name != fields[side == 'origin' ? 'destination' : 'origin']) {
        candidates.add(match.name);
      }
    }
    if (candidates.length == 1) fields[side] = candidates.single;
  }

  String? number(String input, RegExp pattern) {
    final candidates = <String>{};
    for (final line in input.toUpperCase().split('\n')) {
      final words = line.trim().split(RegExp(r'\s+'));
      for (final token in [if (words.isNotEmpty) words.first, words.join()]) {
        final value = RegExp(r'^[A-Z0-9]+').firstMatch(token)?[0];
        if (value != null && pattern.hasMatch(value)) candidates.add(value);
      }
    }
    return candidates.length == 1 ? candidates.single : null;
  }

  const serial = r'^(?:[A-Z]\d{5,10}|\d{1,3}[A-Z]\d{5,9}|[A-Z]\d{3}[A-Z]\d{6})$';
  const sale = r'^(?=.{17,25}$)\d{5,}[A-Z]?\d{8,}[A-Z]?\d{0,7}$';
  final lines = text
      .split('\n')
      .where((line) => line.trim().isNotEmpty)
      .toList();
  fields['ticketNumber'] ??=
      number(regions['ticketNumber'] ?? '', RegExp(serial)) ??
      number(lines.take(3).join('\n'), RegExp(serial));
  fields['saleCode'] ??=
      number(regions['saleCode'] ?? '', RegExp(sale)) ??
      number(lines.reversed.take(3).join('\n'), RegExp(sale));

  final markLines = (regions['ticketMarks'] ?? '').split('\n');
  final discountedOnline = markLines.any(
    (line) => line.replaceAll(RegExp(r'\s+'), '') == '网折',
  );
  final marks = <String>{
    ...RegExp(r'[（(]\s*([网学孩惠折赠支微团残兑])\s*[）)]')
        .allMatches(text)
        .map((match) => match[1]!),
    if (discountedOnline) ...['网', '折'],
    for (final line in markLines)
      if (RegExp(r'^[（(○\s]*([网学孩惠折赠支微团残兑])[）)○\s]*$').firstMatch(line)
          case final mark?)
        mark[1]!,
  };
  if (marks.isNotEmpty)
    fields['ticketMarks'] = [
      for (final mark in marks.take(4))
        {
          'text': mark,
          'shape': mark == '孩' || (discountedOnline && '网折'.contains(mark))
              ? 'plain'
              : 'circle',
          'offsetX': 0,
          'offsetY': 0,
        },
    ];
  fields.removeWhere((_, value) => value == null);
}

String _printedRailTemplate(
  List<RecognitionLine> lines,
  String paperColor,
  Map<String, dynamic> fields,
) {
  final text = lines
      .map((line) => line.text)
      .join()
      .replaceAll(RegExp(r'\s'), '');
  if (RegExp(r'退票(?:手续)?费').hasMatch(text)) return 'rail-refund-receipt';
  if (RegExp(r'仅供报销|报销凭证|报销使用|凭证遗失不补|退票改签.{0,4}交回车站').hasMatch(text)) {
    return 'rail-receipt';
  }
  if (RegExp(r'经典红票|2015年前').hasMatch(text)) return 'rail-red-classic';
  if (RegExp(r'红色软纸票|红票').hasMatch(text) || paperColor == 'red') {
    final year = JourneyDate.fromJson(fields['departureDate'])?.year;
    return year != null && year < 2015 ? 'rail-red-classic' : 'rail-red';
  }
  if (RegExp(r'磁介质|蓝票|限乘当[日目]|当[日目]当次|当次车').hasMatch(text) ||
      paperColor == 'blue') {
    return 'rail-blue';
  }
  return 'rail-receipt';
}

/// Read labelled fields and a few standard ticket formats from already-recognized
/// text. Nothing here repairs OCR character mistakes or depends on an OCR engine.
Map<String, dynamic> readTravelFields(
  String input,
  ReferenceCatalog catalog, {
  required bool flight,
}) {
  final text = String.fromCharCodes(
    input.runes.map(
      (value) => value >= 0xff01 && value <= 0xff5e ? value - 0xfee0 : value,
    ),
  );
  final lines = text
      .split(RegExp(r'[\r\n，,;；。]+'))
      .map((line) => line.trim())
      .where((line) => line.isNotEmpty)
      .toList();
  String? one(Iterable<String> matches) {
    final values = matches
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet();
    return values.length == 1 ? values.single : null;
  }

  String? labelled(String labels, String value) {
    final pattern = RegExp(
      '^(?:$labels)\\s*:?\\s+($value)|^(?:$labels)\\s*:\\s*($value)',
      caseSensitive: false,
    );
    return one([
      for (final line in lines)
        if (pattern.firstMatch(line) case final match?) match[1] ?? match[2]!,
    ]);
  }

  final fields = <String, dynamic>{};
  void put(String name, String? value) {
    if (value != null) fields[name] = value;
  }

  const flightPattern = r'(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s*\d{1,5}[A-Z]?';
  const railPattern = r'[GDCZTKLSY]\d{1,5}';
  final explicitService = labelled(
    flight ? r'航班号?|FLIGHT(?: NO\.?)?' : r'车次|TRAIN(?: NO\.?)?',
    flight ? flightPattern : r'[GDCZTKLSY]?\d{1,5}',
  );
  final service =
      explicitService ??
      one(
        RegExp(
              '(?<![A-Z0-9])(?:${flight ? flightPattern : railPattern})(?![A-Z0-9])',
              caseSensitive: false,
            )
            .allMatches(text)
            .map(
              (match) => match[0]!.replaceAll(RegExp(r'\s'), '').toUpperCase(),
            )
            .where(
              (value) => !flight || !catalog.aircraftAliases.containsKey(value),
            ),
      );
  if (service != null)
    fields['service'] = service.replaceAll(RegExp(r'\s'), '').toUpperCase();

  for (final (key, labels, value) in [
    ('origin', '出发站|出发机场|始发站|发站|出发地|FROM|ORIGIN', r'[^:]{2,50}$'),
    ('destination', '到达站|到达机场|终到站|到站|目的地|TO|DESTINATION', r'[^:]{2,50}$'),
    ('passenger', '姓名|旅客姓名|乘车人|乘机人|PASSENGER|NAME', r'.{2,100}$'),
    ('identity', '证件号|身份证号|IDENTITY', r'[A-Z0-9*]{5,30}'),
    ('seat', '座位号|座位|座号|SEAT', r'[0-9]{1,3}[A-Z]?(?:号[上中下]铺)?'),
    (
      'seatClass',
      '舱位等级|舱位|席别|CLASS',
      flight
          ? r'[A-Z][0-9]{0,2}|[\u3400-\u9fff]{2,8}'
          : r'[\u3400-\u9fff]{2,8}',
    ),
    (
      'gate',
      flight ? _flightGateLabels : '检票口|登机口|GATE',
      flight ? '$_flightGateCode\$' : r'[A-Z0-9/-]{1,16}',
    ),
    ('terminal', '航站楼|TERMINAL', r'[A-Z0-9-]{1,12}'),
    ('pnr', '订座编号|PNR', r'[A-Z0-9]{5,8}'),
    ('ticketNumber', '电子客票号|客票号|票号|TICKET NO', r'[A-Z0-9-]{6,30}'),
    ('orderNumber', '订单号|订单编号', r'[A-Z0-9]{6,30}'),
  ]) {
    final read = labelled(labels, value);
    if (key != 'identity' || !hasMaskedIdentity(read ?? '')) put(key, read);
  }

  if (fields['origin'] == null || fields['destination'] == null) {
    final pairs = <(String, String)>{};
    final printedPairs = <(String, String, String)>{};
    for (final line in lines) {
      if (!flight) {
        final printed = RegExp(
          r'^([\u3400-\u9fff\s]+?)\s*([GDCZTKLSY]\s*\d{1,5}|\d{3,4})(?:次)?'
          r'\s*(?:[→—-]+\s*)?([\u3400-\u9fff\s]+)$',
          caseSensitive: false,
        ).firstMatch(line);
        if (printed != null) {
          final spaces = RegExp(r'\s+');
          final a = catalog.resolve(
            printed[1]!.replaceAll(spaces, ''),
            '',
            flight: false,
          );
          final b = catalog.resolve(
            printed[3]!.replaceAll(spaces, ''),
            '',
            flight: false,
          );
          final number = printed[2]!.replaceAll(spaces, '').toUpperCase();
          if (a != null &&
              b != null &&
              a.identity != b.identity &&
              (service == null || fields['service'] == number)) {
            printedPairs.add((a.name, b.name, number));
          }
        }
      }
      final parts = line.split(RegExp(r'\s*(?:→|->|—|至)\s*|\s+'));
      if (parts.length != 2) continue;
      final a = catalog.resolve(parts.first, '', flight: flight);
      final b = catalog.resolve(parts.last, '', flight: flight);
      if (a != null && b != null && a.identity != b.identity) {
        pairs.add((a.name, b.name));
      }
    }
    if (printedPairs.length == 1) {
      final (origin, destination, number) = printedPairs.single;
      fields['origin'] ??= origin;
      fields['destination'] ??= destination;
      fields['service'] ??= number;
    } else if (pairs.length == 1) {
      fields['origin'] ??= pairs.single.$1;
      fields['destination'] ??= pairs.single.$2;
    }
  }

  const date = r'(?:19|20)\d{2}[年./-]\d{1,2}[月./-]\d{1,2}日?';
  const clock = r'(?:[01]?\d|2[0-3]):[0-5]\d(?!\d)';
  const printedClock = '$clock|(?:[01]\\d|2[0-3])[0-5]\\d(?!\\d)';
  for (final (key, labels) in [
    (
      'departure',
      '$_scheduledDepartureLabels|计划出发|计划发车|发车时间|开车时间|出发时间|出发日期|乘车日期',
    ),
    ('arrival', '计划到达|计划降落|到达时间|ARRIVAL'),
    ('actualDeparture', '实际起飞|实际离地|实际出发|ACTUAL DEPARTURE'),
    ('actualArrival', '实际到达|实际降落|ACTUAL ARRIVAL'),
    ('boarding', _scheduledBoardingLabels),
    ('actualBoarding', '实际登机时间|ACTUAL BOARDING TIME'),
  ]) {
    final prefix = '(?:$labels)(?:日期|时间|时刻)?';
    const valuePattern = '$date(?:[ T]+(?:$printedClock))?|$printedClock';
    final value =
        labelled(prefix, valuePattern) ??
        // Chinese ticket labels frequently have no delimiter before a date/time.
        one(
          lines.map(
            (line) =>
                RegExp(
                  '^$prefix($valuePattern)',
                  caseSensitive: false,
                ).firstMatch(line)?[1] ??
                '',
          ),
        );
    if (value == null) continue;
    final day = RegExp('^$date').firstMatch(value)?[0];
    if (parsePrintedJourneyDate(day) case final parsed?) {
      if (key != 'boarding' && key != 'actualBoarding') {
        fields['${key}Date'] = parsed.toJson();
      }
    }
    final time = RegExp(printedClock)
        .firstMatch(value.substring(day?.length ?? 0))?[0];
    if (time != null) {
      fields['${key}Time'] = time.contains(':')
          ? time.padLeft(5, '0')
          : '${time.substring(0, 2)}:${time.substring(2)}';
    }
  }
  final uniqueDate = one(
    RegExp(date).allMatches(text).map((match) => match[0]!),
  );
  if (fields['departureDate'] == null &&
      !fields.containsKey('actualDepartureDate') &&
      !fields.containsKey('arrivalDate') &&
      !fields.containsKey('actualArrivalDate')) {
    if (parsePrintedJourneyDate(uniqueDate) case final parsed?) {
      fields['departureDate'] = parsed.toJson();
    }
  }
  if (!flight) {
    final railTime = one(
      RegExp('($clock)\\s*(?:开|发车)').allMatches(text).map((match) => match[1]!),
    );
    if (railTime != null) fields['departureTime'] ??= railTime.padLeft(5, '0');
    final seat = RegExp(
      r'\b(\d{1,2})\s*车(?:厢)?\s*(\d{1,3}[A-F]?)(?:号)?\s*([上中下]铺)?',
      caseSensitive: false,
    ).allMatches(text).toList();
    if (seat.length == 1) {
      fields['carriage'] = seat.single[1];
      fields['seat'] ??=
          '${seat.single[2]}${seat.single[3] == null ? '' : '号${seat.single[3]}'}';
    }
    fields['seatClass'] ??= one(
      RegExp(r'商务座|特等座|一等座|二等座|硬卧|软卧|硬座|软座')
          .allMatches(text)
          .map((match) => match[0]!),
    );
    final price = one(
      RegExp(r'[¥￥]\s*(\d+(?:\.\d{1,2})?)')
          .allMatches(text)
          .map((match) => match[1]!),
    );
    put('price', price);
    if (RegExp(r'无\s*座|站票').hasMatch(text)) {
      fields['railStanding'] = true;
      fields.remove('seat');
      if (['无座', '站票'].contains(fields['seatClass']))
        fields.remove('seatClass');
      fields['carriage'] ??= RegExp(r'(\d{1,2})\s*车(?:厢)?\s*无\s*座')
          .firstMatch(text)?[1];
    }
    fields['ticketNumber'] ??= one(
      RegExp(
        r'^\s*([A-Z]\d{5,10})(?=\s|$)',
        multiLine: true,
      ).allMatches(text).map((match) => match[1]!),
    );
    fields['gate'] ??= one(
      RegExp(r'检\s*票(?:\s*口)?\s*:?\s*([A-Z]?\d+[A-Z]?)')
          .allMatches(text)
          .map((match) => match[1]!),
    );
  }
  fields.removeWhere((_, value) => value == null);
  return fields;
}

JourneyDate? parsePrintedJourneyDate(String? value) {
  if (value == null) return null;
  final parts = RegExp(r'^((?:19|20)\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?$')
      .firstMatch(value);
  if (parts == null) return null;
  try {
    return JourneyDate.calendar(
      int.parse(parts[1]!),
      int.parse(parts[2]!),
      int.parse(parts[3]!),
    );
  } on FormatException {
    return null;
  }
}

List<TicketRecord> parseTicketText(
  String text,
  ReferenceCatalog catalog, {
  required bool flight,
  String source = 'text',
}) {
  final chunks = text
      .split(RegExp(r'\n\s*\n'))
      .where((chunk) => chunk.trim().isNotEmpty)
      .toList();
  List<TicketRecord> one(String chunk) {
    final lines = chunk.split('\n');
    final result = parseRecognition(
      RecognitionResult(
        lines: [
          for (var i = 0; i < lines.length; i++)
            RecognitionLine(
              lines[i],
              0,
              i / lines.length,
              1,
              1 / lines.length,
              1,
            ),
        ],
      ),
      catalog,
      flight: flight,
    );
    return result
        .where((row) => row.text('service').isNotEmpty)
        .map(
          (row) => row.withChanges({
            'fieldSources': {
              for (final entry in row.fieldSources.entries) entry.key: source,
            },
            'sources': [
              {'kind': source, 'label': '文字导入', 'at': utcNow()},
            ],
          }),
        )
        .toList();
  }

  final parsed = chunks.map(one).where((rows) => rows.isNotEmpty).toList();
  final services = parsed
      .expand((rows) => rows)
      .map((row) => row.text('service'))
      .toSet();
  // Blank paragraphs within one ticket are common in copied e-mails.
  return services.length <= 1
      ? one(text)
      : parsed.expand((rows) => rows).toList();
}

/// Model suggestions fill blanks only, and must be grounded in the OCR text.
TicketRecord supplementRecognition(
  TicketRecord record,
  Map<String, dynamic> suggestions,
  String text,
  ReferenceCatalog catalog,
) {
  final changes = <String, dynamic>{};
  final source = text.replaceAll(RegExp(r'\s+'), '').toUpperCase();
  for (final key in [
    'service',
    'origin',
    'destination',
    'departureDate',
    'departureTime',
  ]) {
    final value = suggestions[key];
    if (value is! String ||
        value.isEmpty ||
        value.length > 64 ||
        record.barcodeLocked(key) ||
        (key != 'departureDate' && record.text(key).isNotEmpty)) {
      continue;
    }
    final compact = value.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    if (compact.isEmpty || !source.contains(compact)) continue;
    if (key == 'departureDate') {
      if (record.departure != null) continue;
      final match = RegExp(r'^(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?$')
          .firstMatch(compact);
      if (match == null) continue;
      try {
        changes[key] = JourneyDate.calendar(
          int.parse(match[1]!),
          int.parse(match[2]!),
          int.parse(match[3]!),
        ).toJson();
      } on FormatException {
        continue;
      }
    } else if (key == 'departureTime') {
      if (RegExp(r'^(?:[01]?\d|2[0-3]):[0-5]\d$').hasMatch(compact)) {
        changes[key] = compact.padLeft(5, '0');
      }
    } else if (key == 'service') {
      final pattern = record.isFlight
          ? r'^(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\d{2,5}$'
          : r'^[GDCZTKLSY]?\d{1,5}$';
      if (RegExp(pattern).hasMatch(compact)) changes[key] = compact;
    } else if (catalog.resolve(value, '', flight: record.isFlight)
        case final place?) {
      changes[key] = place.name;
    }
  }
  if (changes.isEmpty) return record;
  return catalog.normalize(
    record.withChanges({
      ...changes,
      'fieldSources': {
        ...record.fieldSources,
        for (final key in changes.keys) key: 'ocr',
      },
    }),
  );
}
