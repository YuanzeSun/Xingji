import 'dart:convert';

import 'journey_date.dart';
import 'record_fields.dart';
import 'ticket_record.dart';

const _jsonFields = {
  'mergedIds',
  'lookupValues',
  'fieldSources',
  'ticketMarks',
  'ticketCode',
  'boardingCode',
  'railRoute',
  'railJourney',
};
List<TicketRecord> parseTicketCsv(String input) {
  final rows = <List<String>>[], row = <String>[];
  var value = StringBuffer(), quoted = false;
  final text = input.replaceFirst(RegExp(r'^\uFEFF'), '');
  for (var i = 0; i < text.length; i++) {
    final c = text[i];
    if (c == '"') {
      if (quoted && i + 1 < text.length && text[i + 1] == '"') {
        value.write('"');
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c == ',' && !quoted) {
      row.add(value.toString());
      value = StringBuffer();
    } else if ((c == '\n' || c == '\r') && !quoted) {
      if (c == '\r' && i + 1 < text.length && text[i + 1] == '\n') i++;
      row.add(value.toString());
      if (row.any((cell) => cell.isNotEmpty)) rows.add(List.of(row));
      row.clear();
      value = StringBuffer();
    } else {
      value.write(c);
    }
  }
  if (quoted) throw const FormatException('CSV 引号不完整');
  row.add(value.toString());
  if (row.any((cell) => cell.isNotEmpty)) rows.add(row);
  if (rows.length < 2) throw const FormatException('CSV 没有可导入的数据');
  const aliases = {
    '交通方式': 'type',
    '出发站': 'origin',
    '出发机场': 'origin',
    '到达站': 'destination',
    '到达机场': 'destination',
    '车次': 'service',
    '航班号': 'service',
    '出发日期': 'departureDate',
    '日期': 'departureDate',
    '出发时间': 'departureTime',
    '计划起飞日期': 'departureDate',
    '计划起飞时间': 'departureTime',
    '计划到达日期': 'arrivalDate',
    '计划到达时间': 'arrivalTime',
    '实际起飞日期': 'actualDepartureDate',
    '实际起飞时间': 'actualDepartureTime',
    '实际到达日期': 'actualArrivalDate',
    '实际到达时间': 'actualArrivalTime',
    '姓名': 'passenger',
    '旅客': 'passenger',
    '证件号': 'identity',
    '身份证号': 'identity',
    '座位': 'seat',
    '车厢': 'carriage',
    '席别': 'seatClass',
    '舱位': 'seatClass',
    '票价': 'price',
    '检票口': 'gate',
    '登机口': 'gate',
    '机票状态': 'flightStatus',
    '机型': 'aircraft',
    '航空公司': 'airline',
    '担当路局': 'railBureau',
    '车型': 'railModel',
    '车辆归属单位': 'railCarOwner',
    '担当客运段': 'railRunner',
    '票面样式': 'template',
    '模板': 'template',
  };
  final headers = rows.first
          .map((key) => aliases[key.trim()] ?? key.trim())
          .toList(),
      own =
          headers.take(2).join(',') == 'id,mergedIds' &&
          headers.contains('boardingCode');
  return rows.skip(1).map((cells) {
    final data = <String, dynamic>{};
    for (var i = 0; i < headers.length; i++) {
      final key = headers[i];
      if (!['id', 'mergedIds', ...ticketFields].contains(key)) continue;
      var value = i < cells.length ? cells[i] : '';
      if (own && RegExp(r"^'[=+\-@\t\r]").hasMatch(value)) {
        value = value.substring(1);
      }
      if (_jsonFields.contains(key) && value.isNotEmpty) {
        try {
          data[key] = jsonDecode(value);
        } catch (_) {
          throw FormatException('CSV 中的 $key 格式无效');
        }
      } else if (journeyDateFields.contains(key) && value.isNotEmpty) {
        if (value.startsWith('{')) {
          data[key] = JourneyDate.fromJson(jsonDecode(value))!.toJson();
        } else {
          final date = DateTime.tryParse(value);
          if (date == null ||
              !RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) ||
              JourneyDate.fromDateTime(date).calendarText != value) {
            throw const FormatException('导入日期须为完整的年-月-日');
          }
          data[key] = JourneyDate.fromDateTime(date).toJson();
        }
      } else if (value.isNotEmpty) {
        data[key] = value;
      }
    }
    final flight =
        ['flight', '机票', '飞机'].contains(data['type']) ||
        data['type'] == null &&
            RegExp(
              r'^[A-Z]{2}\d+$',
              caseSensitive: false,
            ).hasMatch(data['service'] ?? '');
    data['type'] = flight ? 'flight' : 'rail';
    data['template'] ??= flight ? 'air-boarding-pass' : 'rail-receipt';
    data['sources'] = [
      {'kind': 'csv', 'label': 'CSV 表格导入', 'at': utcNow()},
    ];
    return TicketRecord.create(data);
  }).toList();
}
