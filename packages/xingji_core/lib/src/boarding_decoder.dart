import 'dart:convert';
import 'dart:typed_data';

import 'package:gbk_codec/gbk_codec.dart';

import 'ticket_record.dart';
import 'journey_date.dart';
import 'reference_catalog.dart';

bool _carrier(String value) =>
    RegExp(r'^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])$').hasMatch(value);
Map<String, dynamic>? decodeBoardingBytes(List<int> bytes) {
  final value = latin1.decode(bytes);
  if (value.length < 60 ||
      value.length > 8192 ||
      !RegExp(r'^M[1-4][\x20-\x7e]{21}').hasMatch(value))
    return null;
  final passenger = value.substring(2, 22).trim(),
      marker = value[22],
      count = int.parse(value[1]);
  if (!RegExp(r"^[A-Z][A-Z /.'-]*$").hasMatch(passenger) ||
      !['E', ' '].contains(marker))
    return null;
  final shared = <String, dynamic>{
        'passenger': passenger,
        'electronic': marker.trim(),
      },
      legs = <Map<String, dynamic>>[];
  var offset = 23;
  Map<String, dynamic> extras(String raw) {
    String text;
    try {
      text = utf8.decode(latin1.encode(raw));
    } catch (_) {
      try {
        text = gbk_bytes.decode(latin1.encode(raw));
      } catch (_) {
        return {};
      }
    }
    final tagged = RegExp(
      r'#90([\u3400-\u9fff·•]{1,40})#91([^#\x00-\x1f]{1,80})#92([^#\x00-\x1f]{1,80})(?=#93|$)',
    ).firstMatch(text);
    if (tagged == null) return {};
    final gate = RegExp(r'#93([A-Z0-9][A-Z0-9/\-]{0,15})(?=#|$)')
            .firstMatch(text),
        boarding = RegExp(r'#94((?:[01]\d|2[0-3]):[0-5]\d)(?=#|$)')
            .firstMatch(text);
    return {
      'passengerChinese': tagged[1],
      'originChinese': tagged[2],
      'destinationChinese': tagged[3],
      if (gate != null) 'gate': gate[1],
      if (boarding != null) 'recordedBoardingTime': boarding[1],
    };
  }

  for (var index = 0; index < count; index++) {
    if (offset + 37 > value.length) return null;
    final fixed = value.substring(offset, offset + 35),
        length = value.substring(offset + 35, offset + 37);
    if (!RegExp(r'^[\x20-\x7e]{35}$').hasMatch(fixed) ||
        !RegExp(r'^[\dA-F]{2}$').hasMatch(length))
      return null;
    final end = offset + 37 + int.parse(length, radix: 16);
    if (end > value.length) return null;
    final pnr = fixed.substring(0, 7).trim(),
        origin = fixed.substring(7, 10),
        destination = fixed.substring(10, 13),
        carrier = fixed.substring(13, 16).trim(),
        flight = fixed.substring(16, 21).trim(),
        day = fixed.substring(21, 24),
        cabin = fixed[24],
        seat = fixed.substring(25, 29).trim(),
        sequence = fixed.substring(29, 34).trim(),
        status = fixed[34];
    if (!RegExp(r'^[A-Z0-9 ]{0,7}$').hasMatch(pnr) ||
        !RegExp(r'^[A-Z]{3}$').hasMatch(origin) ||
        !RegExp(r'^[A-Z]{3}$').hasMatch(destination) ||
        origin == destination ||
        !_carrier(carrier) ||
        !RegExp(r'^\d{1,4}[A-Z]?$').hasMatch(flight) ||
        !RegExp(r'^\d{3}$').hasMatch(day) ||
        int.parse(day) < 1 ||
        int.parse(day) > 366 ||
        !RegExp(r'^[A-Z]$').hasMatch(cabin) ||
        !RegExp(r'^[A-Z0-9]{0,4}$').hasMatch(seat) ||
        !RegExp(r'^[A-Z0-9 ]{0,5}$').hasMatch(sequence) ||
        !RegExp(r'^\d$').hasMatch(status))
      return null;
    final number = flight.replaceFirst(RegExp(r'^0+(?=\d)'), ''),
        variable = value.substring(offset + 37, end),
        optional = <String, dynamic>{};
    var start = 0;
    if (index == 0 &&
        variable.startsWith('>') &&
        variable.length >= 4 &&
        RegExp(r'^\d[\dA-F]{2}$').hasMatch(variable.substring(1, 4))) {
      final uniqueEnd = 4 + int.parse(variable.substring(2, 4), radix: 16);
      if (uniqueEnd <= variable.length) {
        final unique = variable.substring(4, uniqueEnd),
            series = <Map<String, dynamic>>[];
        for (final position in [11, 24, 37])
          if (unique.length >= position + 13) {
            final raw = unique.substring(position, position + 13);
            if (RegExp(r'^\d{13}$').hasMatch(raw)) {
              final amount = int.parse(raw.substring(10)),
                  tag = raw.substring(0, 10);
              if (amount > 0 && int.parse(tag) + amount - 1 <= 9999999999)
                series.add({'number': tag, 'count': amount});
            }
          }
        if (series.isNotEmpty) shared['baggageSeries'] = series;
        start = uniqueEnd;
      } else {
        start = variable.length;
      }
    }
    if (variable.length >= start + 2 &&
        RegExp(r'^[\dA-F]{2}$')
            .hasMatch(variable.substring(start, start + 2))) {
      final repeatedEnd =
          start +
          2 +
          int.parse(variable.substring(start, start + 2), radix: 16);
      if (repeatedEnd <= variable.length) {
        final repeated = variable.substring(start + 2, repeatedEnd);
        String part(int from, int to) =>
            repeated.length >= to ? repeated.substring(from, to).trim() : '';
        final ticket = part(0, 13),
            marketing = part(15, 18),
            program = part(18, 21),
            membership = part(21, 37),
            allowance = part(38, 41);
        if (RegExp(r'^\d{13}$').hasMatch(ticket) &&
            !RegExp(r'^0+$').hasMatch(ticket))
          optional['ticketNumber'] = ticket;
        if (_carrier(marketing)) optional['marketingCarrier'] = marketing;
        if (_carrier(program)) optional['frequentFlyerCarrier'] = program;
        if (RegExp(r'^[A-Z0-9]{1,16}$').hasMatch(membership))
          optional['frequentFlyerNumber'] = membership;
        if (RegExp(r'^(?:\d{1,2}[KP]|\dPC|\d{1,3})$').hasMatch(allowance))
          optional['freeBaggageAllowance'] = allowance;
      }
    }
    legs.add({
      'pnr': pnr,
      'originCode': origin,
      'destinationCode': destination,
      'carrier': carrier,
      'flightNumber': number,
      'service': carrier + number,
      'dayOfYear': int.parse(day),
      'cabin': cabin,
      'seat': seat.replaceFirst(RegExp(r'^0+'), '').isEmpty
          ? seat
          : seat.replaceFirst(RegExp(r'^0+'), ''),
      'sequence': sequence,
      'status': status,
      ...optional,
      ...extras(variable),
      'legIndex': index,
    });
    offset = end;
  }
  if (count == 1) legs[0].addAll(extras(value.substring(offset)));
  final complete = legs.map((leg) => {...shared, ...leg}).toList();
  return {...complete.first, 'legs': complete, 'legCount': count};
}

Map<String, dynamic> boardingMetadata(Map<String, dynamic> read) {
  final values = <String, dynamic>{
    for (final key in [
      'freeBaggageAllowance',
      'frequentFlyerCarrier',
      'frequentFlyerNumber',
      'marketingCarrier',
    ])
      if (read[key] != null && read[key] != '') key: read[key],
    if (read['recordedBoardingTime'] != null)
      'actualBoardingTime': read['recordedBoardingTime'],
  };
  if (read['baggageSeries'] is List &&
      (read['baggageSeries'] as List).isNotEmpty) {
    final series = read['baggageSeries'] as List;
    values['checkedBaggageCount'] = series
        .fold<int>(0, (total, item) => total + item['count'] as int)
        .toString();
    values['baggageTagNumbers'] = series
        .map((item) {
          final first = item['number'] as String, count = item['count'] as int;
          return count == 1
              ? first
              : '$first–${(int.parse(first) + count - 1).toString().padLeft(10, '0')}';
        })
        .join(' / ');
  }
  return values;
}

List<TicketRecord> boardingRecords(
  List<int> bytes,
  ReferenceCatalog catalog, {
  Map<String, dynamic> supplement = const {},
}) {
  final read = decodeBoardingBytes(bytes);
  if (read == null) return [];
  final rebuilt = Uint8List.fromList(bytes);
  rebuilt[22] = 32;
  final code = {
    'version': 1,
    'format': 'PDF417',
    'rawBytes': base64Encode(rebuilt),
    'symbologyIdentifier': ']L2',
    'gs1': false,
    'eci': <dynamic>[],
    'parameters': {
      'symbolVersion': '',
      'errorCorrectionLevel': '',
      'mask': null,
    },
  };
  return (read['legs'] as List).indexed.map((entry) {
    final (index, raw) = entry;
    final leg = Map<String, dynamic>.from(raw);
    final matching =
        read['legCount'] == 1 || supplement['service'] == leg['service'];
    final values = <String, dynamic>{
      'type': 'flight',
      if (matching) ...supplement,
      'template': 'air-boarding-pass',
      'service': leg['service'],
      'origin': leg['originCode'],
      'destination': leg['destinationCode'],
      'originCode': leg['originCode'],
      'destinationCode': leg['destinationCode'],
      'passenger': leg['passengerChinese'] ?? leg['passenger'],
      'airline': catalog.airline(leg['carrier']),
      'pnr': leg['pnr'],
      'seat': leg['seat'],
      'seatClass': leg['cabin'],
      if (leg['ticketNumber'] != null) 'ticketNumber': leg['ticketNumber'],
      if (leg['gate'] != null) 'gate': leg['gate'],
      ...boardingMetadata(leg),
      'boardingCode': code,
      'boardingCodeSource': 'original',
      'boardingLegIndex': '$index',
    };
    final year = matching
        ? JourneyDate.fromJson(supplement['departureDate'])?.year
        : null;
    values['departureDate'] = JourneyDate(
      year != null && (leg['dayOfYear'] as int) <= JourneyDate.daysInYear(year)
          ? year
          : null,
      leg['dayOfYear'],
    ).toJson();
    values['fieldSources'] = {
      for (final key in values.keys.where(
        (key) => ![
          'type',
          'template',
          'fieldSources',
          'boardingCodeSource',
          'boardingLegIndex',
        ].contains(key),
      ))
        key: 'barcode',
    };
    if (matching)
      for (final key in supplement.keys) {
        if (key != 'departureDate' &&
            ![
              'service',
              'origin',
              'destination',
              'originCode',
              'destinationCode',
              'passenger',
              'airline',
              'pnr',
              'seat',
              'seatClass',
              'boardingCode',
            ].contains(key) &&
            values[key] == supplement[key])
          (values['fieldSources'] as Map)[key] = 'ocr';
      }
    return catalog.normalize(TicketRecord.create(values));
  }).toList();
}

String encodeBoardingPass({
  required String passenger,
  required String pnr,
  required String origin,
  required String destination,
  required String carrier,
  required String flightNumber,
  required JourneyDate date,
  required String cabin,
  required String seat,
  required String sequence,
  required String status,
}) {
  String field(String value, String pattern, String label, int width) {
    final text = value.trim().toUpperCase();
    if (text.length > width || !RegExp(pattern).hasMatch(text))
      throw FormatException(label);
    return text;
  }

  final name = field(
    passenger,
    r"^[A-Z][A-Z .'-]*/[A-Z .'-]+$",
    '请按“姓/名”填写最多 20 位英文姓名',
    20,
  );
  final locator = field(pnr, r'^[A-Z0-9]{1,7}$', '订座编号须为 1 至 7 位字母或数字', 7);
  final from = field(origin, r'^[A-Z]{3}$', '请选择出发机场', 3),
      to = field(destination, r'^[A-Z]{3}$', '请选择到达机场', 3);
  if (from == to || date.dayOfYear == null)
    throw const FormatException('请检查机场与出发月日');
  final airline = field(
    carrier,
    r'^(?:[A-Z]{2,3}|[A-Z]\d|\d[A-Z])$',
    '实际承运航司代码无效',
    3,
  );
  final number = field(flightNumber, r'^\d{1,4}[A-Z]?$', '航班数字无效', 5),
      flight = RegExp(r'^(\d+)([A-Z]?)$').firstMatch(number)!;
  final compartment = field(cabin, r'^[A-Z]$', '舱位须为一位英文字母', 1),
      place = field(seat, r'^[A-Z0-9]{1,4}$', '座位须为 1 至 4 位代码', 4);
  final order = field(sequence, r'^[A-Z0-9]{1,5}$', '值机序号须为 1 至 5 位代码', 5),
      state = field(status, r'^\d$', '旅客状态须为一位数字', 1);
  return 'M1${name.padRight(20)} ${locator.padRight(7)}$from$to${airline.padRight(3)}${flight[1]!.padLeft(4, '0')}${flight[2]!.isEmpty ? ' ' : flight[2]}${date.dayOfYear.toString().padLeft(3, '0')}$compartment${place.padLeft(4, '0')}${order.padLeft(5, '0')}${state}00';
}
