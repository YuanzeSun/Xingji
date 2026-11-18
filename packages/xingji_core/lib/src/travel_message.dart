import 'journey_date.dart';
import 'recognition.dart';
import 'reference_catalog.dart';
import 'ticket_record.dart';

/// Ambiguous or incomplete notices can still be presented for review.
({List<TicketRecord> records, bool automatic}) parseTravelMessage(
  String text,
  ReferenceCatalog catalog, {
  DateTime? receivedAt,
}) {
  final flight = RegExp(
    r'航班|登机|乘机|机场|\bFLIGHT\b',
    caseSensitive: false,
  ).hasMatch(text);
  if (RegExp(
    r'验证码|校验码|verification code',
    caseSensitive: false,
  ).hasMatch(text)) {
    return (records: [], automatic: false);
  }
  List<TicketRecord> parsed;
  try {
    parsed = parseTicketText(text, catalog, flight: flight);
  } on FormatException {
    return (records: [], automatic: false);
  }
  if (parsed.length != 1) return (records: parsed, automatic: false);
  final record = parsed.single;
  const place = r'[\u3400-\u9fffA-Z0-9·()（）]{2,24}';
  final route = RegExp(
    '($place)\\s*(?:→|->|—|至|到)\\s*($place)(?=[，,。；;\\s]|\$)',
  ).firstMatch(text);
  String find(String pattern) =>
      RegExp(pattern, caseSensitive: false).firstMatch(text)?[1]?.trim() ?? '';

  var origin = find(r'(?:出发站|发站|出发机场|出发地|FROM)\s*[:：]\s*([^\s，,；;。]+)');
  var destination = find(r'(?:到达站|到站|到达机场|目的地|TO)\s*[:：]\s*([^\s，,；;。]+)');
  if (origin.isEmpty) origin = route?[1] ?? '';
  if (destination.isEmpty) destination = route?[2] ?? '';
  if (!flight) {
    if (origin.isEmpty) {
      origin = find(
        r'([\u3400-\u9fff]{2,16}站)\s*(?:[01]?\d|2[0-3]):[0-5]\d\s*开',
      );
    }
    if (destination.isEmpty) {
      destination = find(r'(?:^|[，,；;\s])([\u3400-\u9fff]{2,16}站)\s*(?:到|下车)');
    }
  }
  Place? resolve(String name) =>
      catalog.resolve(
        flight ? name : name.replaceFirst(RegExp(r'站$'), ''),
        '',
        flight: flight,
      ) ??
      catalog.resolve(name, '', flight: flight);
  final from = resolve(origin), to = resolve(destination);
  final time = find(
    r'(?:计划起飞|起飞时间|出发时间|发车时间|开车时间)\s*[:：]?\s*((?:[01]?\d|2[0-3]):[0-5]\d)',
  );
  final passenger = find(r'(?:乘车人|乘机人|旅客|姓名)\s*[:：]\s*([^，,。；;\n]{1,60})');
  final confirmed = RegExp(r'出票成功|购票成功|订票成功|预订成功|订单已确认|购票信息|已为您出票')
      .hasMatch(text);
  final changed = RegExp(r'改签|退票|取消|候补|未支付|待支付|取消航班|变更|延误')
      .hasMatch(text.split(RegExp(r'如需|温馨提示|详情请|请凭')).first);
  var departure = record.departure;
  if (departure == null && confirmed && receivedAt != null) {
    // An undated booking message can cross New Year. Limit inference to the
    // next 30 days from delivery. Old messages can be pasted for review.
    final china = receivedAt.toUtc().add(const Duration(hours: 8));
    final today = DateTime.utc(china.year, china.month, china.day);
    final dates = RegExp(r'(\d{1,2})月(\d{1,2})日').allMatches(text).toList();
    if (dates.length == 1) {
      final month = int.parse(dates.single[1]!);
      final day = int.parse(dates.single[2]!);
      for (final year in [today.year, today.year + 1]) {
        final date = DateTime.utc(year, month, day);
        if (date.month != month || date.day != day) continue;
        final days = date.difference(today).inDays;
        if (days >= 0 && days <= 30) {
          departure = JourneyDate.calendar(year, month, day);
        }
      }
    }
  }

  final changes = <String, dynamic>{
    if (from != null) 'origin': from.name,
    if (from != null) 'originCode': from.code,
    if (to != null) 'destination': to.name,
    if (to != null) 'destinationCode': to.code,
    if (departure != null) 'departureDate': departure.toJson(),
    if (time.isNotEmpty) 'departureTime': time.padLeft(5, '0'),
    if (passenger.isNotEmpty && record.text('passenger').isEmpty)
      'passenger': passenger,
  };
  final ticket = catalog.normalize(
    record.withChanges({
      ...changes,
      'fieldSources': {
        ...record.fieldSources,
        for (final key in changes.keys) key: 'text',
      },
      'sources': [
        {'kind': 'text', 'label': '行程短信', 'at': utcNow()},
      ],
    }),
  );
  final services = RegExp(
    flight
        ? r'(?<![A-Z\d])(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{2,5}(?![A-Z\d])'
        : r'(?<![A-Z\d])[GDCZTKLSY]\d{1,5}(?![A-Z\d])',
    caseSensitive: false,
  ).allMatches(text).map((m) => m[0]!.replaceAll(' ', '').toUpperCase()).toSet();
  final explicitRailTime =
      !flight && RegExp(r'(?:[01]?\d|2[0-3]):[0-5]\d\s*开').hasMatch(text);
  return (
    records: [ticket],
    automatic:
        confirmed &&
        !changed &&
        services.length == 1 &&
        services.single == ticket.text('service') &&
        from != null &&
        to != null &&
        from.identity != to.identity &&
        departure?.date != null &&
        (time.isNotEmpty || explicitRailTime),
  );
}
