import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'journey_date.dart';
import 'reference_catalog.dart';
import 'ticket_record.dart';

class VariFlight {
  final String _key;
  final http.Client _client;
  int _sequence = 0;
  String _protocol = '2025-03-26';
  String? _session;
  static final _endpoint = Uri.https(
    'c-gw.variflight.com',
    '/chat_message/mcp/api',
  );
  static const _deadline = Duration(seconds: 45);

  VariFlight(String key, {http.Client? client})
    : _key = key.trim(),
      _client = client ?? http.Client();

  void close() => _client.close();

  /// A null year requests future and current trips. History is fetched one year at a time.
  Future<Object?> trips({int? year}) async {
    if (_key.isEmpty ||
        _key.length > 8192 ||
        RegExp(r'[\s\x00-\x1f\x7f]').hasMatch(_key)) {
      throw const FormatException('请先填写有效的飞常准 MCP Key');
    }
    if (year != null && (year < 1900 || year > DateTime.now().year)) {
      throw const FormatException('请选择有效的历史行程年份');
    }
    final initialized = await _send('initialize', {
      'protocolVersion': _protocol,
      'capabilities': <String, dynamic>{},
      'clientInfo': {'name': 'xingji', 'version': '1.0.0'},
    });
    if (initialized is! Map || initialized['protocolVersion'] is! String) {
      throw const FormatException('飞常准未完成连接');
    }
    _protocol = initialized['protocolVersion'];
    await _send('notifications/initialized', {}, notification: true);
    final result = await _send('tools/call', {
      'name': year == null ? 'queryUserFutureTrip' : 'queryUserHistoryTrip',
      'arguments': {'identityType': 0, if (year != null) 'year': '$year'},
    });
    if (result is! Map || result['isError'] == true) {
      throw const FormatException('飞常准查询失败，请检查个人行程授权或账户权益');
    }
    if (result['structuredContent'] case final Object structured)
      return structured;
    final content = result['content'];
    if (content is! List) throw const FormatException('飞常准未返回行程内容');
    final text = content
        .whereType<Map>()
        .where((part) => part['type'] == 'text' && part['text'] is String)
        .map((part) => part['text'] as String)
        .join('\n');
    try {
      return jsonDecode(text);
    } on FormatException {
      return text.replaceAll(_key, '[已隐藏]');
    }
  }

  Future<Object?> _send(
    String method,
    Map<String, dynamic> params, {
    bool notification = false,
  }) async {
    final id = notification ? null : ++_sequence;
    final request = http.Request('POST', _endpoint)
      ..followRedirects = false
      ..headers.addAll({
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': 'Bearer $_key',
        'MCP-Protocol-Version': _protocol,
        if (_session != null) 'Mcp-Session-Id': _session!,
      })
      ..body = jsonEncode({
        'jsonrpc': '2.0',
        if (id != null) 'id': id,
        'method': method,
        'params': params,
      });
    final response = await _client.send(request).timeout(_deadline);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw FormatException('飞常准返回 ${response.statusCode}，请检查 Key、授权或剩余积分');
    }
    _session = response.headers['mcp-session-id'] ?? _session;
    if (notification) {
      await response.stream.drain<void>().timeout(_deadline);
      return null;
    }
    var size = 0;
    final bytes = response.stream.map((chunk) {
      size += chunk.length;
      if (size > 5000000) throw const FormatException('飞常准返回内容过大');
      return chunk;
    });
    final decoded = utf8.decoder.bind(bytes);
    Map? matching(Object? value) {
      for (final item in value is List ? value : [value]) {
        if (item is Map && item['id'] == id) return item;
      }
      return null;
    }

    Future<Map?> read() async {
      if (!(response.headers['content-type'] ?? '').contains(
        'text/event-stream',
      )) {
        return matching(jsonDecode(await decoded.join()));
      }
      final event = <String>[];
      Map? readEvent() {
        try {
          return matching(jsonDecode(event.join('\n')));
        } on FormatException {
          return null;
        }
      }

      await for (final line in const LineSplitter().bind(decoded)) {
        if (line.startsWith('data:')) event.add(line.substring(5).trimLeft());
        if (line.isEmpty && event.isNotEmpty) {
          final reply = readEvent();
          if (reply != null) return reply;
          event.clear();
        }
      }
      return event.isEmpty ? null : readEvent();
    }

    final message = await read().timeout(_deadline);
    if (message == null || message['error'] != null) {
      throw const FormatException('飞常准未完成请求，请检查 Key 和个人行程授权');
    }
    return message['result'];
  }
}

({List<TicketRecord> records, bool complete}) parseVariFlightTrips(
  Object? payload,
  ReferenceCatalog catalog,
) {
  final rows = switch (payload) {
    List rows => rows,
    {'flights': List rows} => rows,
    {'kind': 'collection', 'items': List rows} => rows,
    _ => null,
  };
  if (rows == null) return (records: [], complete: false);

  final records = <TicketRecord>[];
  for (final row in rows.whereType<Map>()) {
    String value(List<String> keys) {
      for (final key in keys) {
        final text = row[key];
        if (text is String && text.trim().isNotEmpty && text.length <= 1000) {
          return text.trim();
        }
      }
      return '';
    }

    final service = value(['flightNumber', 'FlightNo', 'flightNo', 'fnum'])
        .replaceAll(RegExp(r'\s'), '')
        .toUpperCase();
    if (!RegExp(r'^(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,5}[A-Z]?$')
        .hasMatch(service)) {
      continue;
    }
    final origin = value(['origin', 'originCode', 'FlightDepcode', 'depCode']);
    final destination = value([
      'destination',
      'destinationCode',
      'FlightArrcode',
      'arrCode',
    ]);
    if (origin.isEmpty || destination.isEmpty) continue;

    final times = <String, dynamic>{};
    for (final (field, key) in [
      ('departure', 'FlightDeptimePlanDate'),
      ('arrival', 'FlightArrtimePlanDate'),
      ('actualDeparture', 'FlightDeptimeDate'),
      ('actualArrival', 'FlightArrtimeDate'),
    ]) {
      final iso = RegExp(
        r'^(\d{4}-\d{2}-\d{2})[ T]((?:[01]\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?$',
      ).firstMatch(value([key]));
      final date = value(['${field}Date', if (field == 'departure') 'date']);
      final time = value(['${field}Time']);
      final dateParts = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$')
          .firstMatch(date.isNotEmpty ? date : iso?[1] ?? '');
      if (dateParts != null) {
        try {
          times['${field}Date'] = JourneyDate.calendar(
            int.parse(dateParts[1]!),
            int.parse(dateParts[2]!),
            int.parse(dateParts[3]!),
          ).toJson();
        } on FormatException {
          // Keep malformed provider dates out of the ticket archive.
        }
      }
      if (RegExp(r'^(?:[01]\d|2[0-3]):[0-5]\d$').hasMatch(time)) {
        times['${field}Time'] = time;
      } else if (iso != null) {
        times['${field}Time'] = iso[2]!;
      }
    }
    if (!times.containsKey('departureDate')) continue;
    final values = {
      'service': service,
      'origin': origin,
      'destination': destination,
      ...times,
      for (final (field, keys) in [
        ('originCode', ['originCode', 'FlightDepcode', 'depCode']),
        ('destinationCode', ['destinationCode', 'FlightArrcode', 'arrCode']),
        ('airline', ['airline', 'FlightCompany']),
        ('aircraft', ['aircraft', 'miniAirplaneModels', 'aircraftType']),
        ('aircraftRegistration', ['aircraftRegistration', 'aircraftNumber']),
        ('seat', ['seat', 'seatNumber']),
        ('passenger', ['passenger', 'passengerName']),
        ('terminal', ['terminal', 'FlightDepTerminal']),
        ('gate', ['gate', 'BoardGate']),
      ])
        if (value(keys).isNotEmpty) field: value(keys),
    };
    records.add(
      catalog.normalize(
        TicketRecord.create({
          'type': 'flight',
          ...values,
          'fieldSources': {for (final key in values.keys) key: 'variflight'},
          'sources': [
            {'kind': 'flight-json', 'label': '飞常准个人行程', 'at': utcNow()},
          ],
        }),
      ),
    );
  }
  return (records: records, complete: records.length == rows.length);
}
