import 'ticket_record.dart';
import 'record_fields.dart';
import 'reference_catalog.dart';

const boardingFields = [
  'boardingCode',
  'boardingCodeSource',
  'boardingCodeOperatingFlight',
  'boardingLegIndex',
];
String _normal(dynamic value) =>
    (value ?? '').toString().replaceAll(RegExp(r'[\s·]'), '').toUpperCase();
bool _empty(dynamic value) =>
    value == null ||
    value == '' ||
    value == false ||
    value == 0 ||
    value is List && value.isEmpty;
List<dynamic> _union(List<dynamic> a, List<dynamic> b) {
  final values = <String, dynamic>{
    for (final item in [...a, ...b]) canonicalJson(item): cloneJson(item),
  };
  return (values.keys.toList()..sort()).map((key) => values[key]).toList();
}

Map<String, dynamic> _validated(Map<String, dynamic> data) {
  if (data['deleted'] == true) {
    for (final key in ticketFields) {
      if (['type', 'template', 'deleted'].contains(key)) continue;
      data[key] = ['lookupValues', 'fieldSources'].contains(key)
          ? <String, dynamic>{}
          : key == 'ticketMarks'
          ? <dynamic>[]
          : '';
    }
    data['sources'] = <dynamic>[];
    data['lockedFields'] = <dynamic>[];
  }
  return data;
}

void _takeField(Map<String, dynamic> target, TicketRecord source, String key) {
  target[key] = cloneJson(source[key]);
  final origins = target['fieldSources'] as Map;
  if (source.fieldSources.containsKey(key)) {
    origins[key] = source.fieldSources[key];
  } else {
    origins.remove(key);
  }
  if (!lookupFields.contains(key)) return;
  final lookup = target['lookupValues'] as Map;
  if (source.isAutomatic(key)) {
    lookup[key] = cloneJson(source[key]);
  } else {
    lookup.remove(key);
  }
  final locked = Set<String>.from(target['lockedFields'])..remove(key);
  if (source.lockedFields.contains(key)) locked.add(key);
  target['lockedFields'] = locked.toList()..sort();
}

void _takeBoarding(Map<String, dynamic> target, TicketRecord source) {
  for (final key in boardingFields) target[key] = cloneJson(source[key] ?? '');
  final origins = target['fieldSources'] as Map;
  if (source.fieldSources.containsKey('boardingCode')) {
    origins['boardingCode'] = source.fieldSources['boardingCode'];
  } else {
    origins.remove('boardingCode');
  }
  final locked = Set<String>.from(target['lockedFields'])
    ..remove('boardingCode');
  if (source.lockedFields.contains('boardingCode')) locked.add('boardingCode');
  target['lockedFields'] = locked.toList()..sort();
}

String _bucket(TicketRecord record) =>
    record.departure?.complete == true && record.text('service').isNotEmpty
    ? '${record.text('type')}:${record.isFlight
          ? '${record.text('flightStatus').isEmpty ? 'normal' : record.text('flightStatus')}:'
          : record.text('template') == 'rail-refund-receipt'
          ? 'refund:'
          : ''}${record.departure!.calendarText}:${_normal(record['service'])}'
    : '';
bool _sameJourney(TicketRecord a, TicketRecord b, ReferenceCatalog catalog) {
  if (a.deleted || b.deleted || _bucket(a).isEmpty || _bucket(a) != _bucket(b))
    return false;
  if (a.text('passenger').isNotEmpty &&
      b.text('passenger').isNotEmpty &&
      _normal(a['passenger']) != _normal(b['passenger']))
    return false;
  if (a.text('departureTime').isNotEmpty &&
      b.text('departureTime').isNotEmpty &&
      a['departureTime'] != b['departureTime'])
    return false;
  var endpoints = 0;
  for (final side in ['origin', 'destination']) {
    final x = catalog.identity(a, side), y = catalog.identity(b, side);
    if (a.text(side).isNotEmpty &&
        b.text(side).isNotEmpty &&
        (x.isEmpty || y.isEmpty))
      return false;
    if (x.isNotEmpty && y.isNotEmpty) {
      if (x != y) return false;
      endpoints++;
    }
  }
  if (endpoints < 2 &&
      !(endpoints > 0 &&
          a.text('ticketNumber').isNotEmpty &&
          _normal(a['ticketNumber']) == _normal(b['ticketNumber'])))
    return false;
  if (a.text('passenger').isEmpty || b.text('passenger').isEmpty) {
    for (final key in ['seat', 'carriage'])
      if (a.text(key).isNotEmpty &&
          b.text(key).isNotEmpty &&
          _normal(a[key]) != _normal(b[key]) &&
          a.lockedFields.contains(key) == b.lockedFields.contains(key))
        return false;
    if (a.text('ticketNumber').isNotEmpty &&
        b.text('ticketNumber').isNotEmpty &&
        _normal(a['ticketNumber']) != _normal(b['ticketNumber']))
      return false;
  }
  return true;
}

List<TicketRecord> deduplicateTickets(
  List<TicketRecord> records,
  ReferenceCatalog catalog,
) {
  final ordered = records.indexed.toList()
    ..sort((a, b) {
      final names =
          (b.$2.text('passenger').isNotEmpty ? 1 : 0) -
          (a.$2.text('passenger').isNotEmpty ? 1 : 0);
      return names != 0 ? names : a.$1.compareTo(b.$1);
    });
  final result = <Map<String, dynamic>>[],
      positions = <Map<String, dynamic>, int>{};
  for (final (position, raw) in ordered) {
    final record = TicketRecord.fromJson(_validated(raw.toJson()));
    var candidates = result
        .where(
          (row) => record.ids.any(
            (id) => TicketRecord.fromJson(row).ids.contains(id),
          ),
        )
        .toList();
    if (candidates.isEmpty) {
      candidates = result
          .where(
            (row) => _sameJourney(TicketRecord.fromJson(row), record, catalog),
          )
          .toList();
      if (record.text('passenger').isNotEmpty) {
        final named = candidates
            .where(
              (row) =>
                  _normal(row['passenger']) == _normal(record['passenger']),
            )
            .toList();
        if (named.isNotEmpty) candidates = named;
      }
    }
    if (candidates.length != 1) {
      final row = record.toJson();
      result.add(row);
      positions[row] = position;
      continue;
    }
    final row = candidates.single, existing = TicketRecord.fromJson(row);
    for (final key in ticketFields) {
      if (['lookupValues', 'fieldSources', 'deleted'].contains(key) ||
          boardingFields.contains(key) ||
          existing.lockedFields.contains(key))
        continue;
      if (record.lockedFields.contains(key) ||
          _empty(existing[key]) && !_empty(record[key]))
        _takeField(row, record, key);
    }
    if (!existing.lockedFields.contains('boardingCode') &&
        (record.lockedFields.contains('boardingCode') ||
            _empty(existing['boardingCode'])))
      _takeBoarding(row, record);
    final ids = {...existing.ids, ...record.ids}.toList()..sort();
    row['id'] = ids.first;
    row['mergedIds'] = ids.skip(1).toList();
    row['deleted'] = existing.deleted || record.deleted;
    row['sources'] = _union(existing['sources'], record['sources']);
    row['lockedFields'] = _union(
      existing['lockedFields'],
      record['lockedFields'],
    );
    row['createdAt'] = ([
      existing.text('createdAt'),
      record.text('createdAt'),
    ]..sort()).first;
    row['updatedAt'] = ([
      existing.text('updatedAt'),
      record.text('updatedAt'),
    ]..sort()).last;
    if (position < positions[row]!) positions[row] = position;
  }
  result.sort((a, b) => positions[a]!.compareTo(positions[b]!));
  return result.map((row) => TicketRecord.fromJson(_validated(row))).toList();
}

class ArchiveConflict {
  final String id, field;
  final dynamic base, local, remote;
  final TicketRecord localRecord, remoteRecord;
  ArchiveConflict(
    this.id,
    this.field,
    this.base,
    this.local,
    this.remote,
    this.localRecord,
    this.remoteRecord,
  );
}

class ArchiveMerge {
  final List<TicketRecord> records;
  final List<ArchiveConflict> conflicts;
  ArchiveMerge(this.records, this.conflicts);
  List<TicketRecord> resolve(Map<String, bool> useRemote) {
    final result = {for (final record in records) record.id: record.toJson()};
    for (final conflict in conflicts) {
      final choice = useRemote['${conflict.id}:${conflict.field}'];
      if (choice == null) throw StateError('请先选择所有冲突项');
      final row = result[conflict.id]!,
          source = choice ? conflict.remoteRecord : conflict.localRecord;
      if (conflict.field == 'boardingCode') {
        _takeBoarding(row, source);
      } else if (lookupFields.contains(conflict.field)) {
        _takeField(row, source, conflict.field);
      } else {
        row[conflict.field] = cloneJson(source[conflict.field]);
        final origins = row['fieldSources'] as Map;
        if (source.fieldSources.containsKey(conflict.field)) {
          origins[conflict.field] = source.fieldSources[conflict.field];
        } else {
          origins.remove(conflict.field);
        }
      }
    }
    return result.values
        .map((row) => TicketRecord.fromJson(_validated(row)))
        .toList();
  }
}

List<List<TicketRecord>> _align(List<List<TicketRecord>> collections) {
  final parents = <String, String>{};
  String find(String id) {
    parents.putIfAbsent(id, () => id);
    if (parents[id] != id) parents[id] = find(parents[id]!);
    return parents[id]!;
  }

  for (final record in collections.expand((rows) => rows))
    for (final id in record.ids) {
      final a = find(record.id), b = find(id);
      if (a != b)
        parents[a.compareTo(b) < 0 ? b : a] = a.compareTo(b) < 0 ? a : b;
    }
  final groups = <String, List<String>>{};
  for (final id in parents.keys.toList())
    groups.putIfAbsent(find(id), () => []).add(id);
  return collections
      .map(
        (rows) => rows.map((record) {
          final id = find(record.id);
          return record.withChanges({
            'id': id,
            'mergedIds': groups[id]!.where((other) => other != id).toList()
              ..sort(),
          });
        }).toList(),
      )
      .toList();
}

dynamic _state(TicketRecord? record, String key) => record == null
    ? null
    : !lookupFields.contains(key)
    ? record[key]
    : {
        'value': record[key],
        'manual': record.lockedFields.contains(key),
        'lookup': record.isAutomatic(key),
      };
ArchiveMerge mergeTickets(
  List<TicketRecord> baseRows,
  List<TicketRecord> localRows,
  List<TicketRecord> remoteRows,
) {
  final aligned = _align([baseRows, localRows, remoteRows]);
  final base = {for (final row in aligned[0]) row.id: row},
      local = {for (final row in aligned[1]) row.id: row},
      remote = {for (final row in aligned[2]) row.id: row};
  final records = <TicketRecord>[], conflicts = <ArchiveConflict>[];
  for (final id in {...base.keys, ...local.keys, ...remote.keys}) {
    final b = base[id], l = local[id], r = remote[id];
    if (l == null) {
      if (r != null) records.add(r);
      continue;
    }
    if (r == null) {
      records.add(l);
      continue;
    }
    void conflict(String key) =>
        conflicts.add(ArchiveConflict(id, key, b?[key], l[key], r[key], l, r));
    if (l.deleted || r.deleted) {
      final kept = l.deleted ? r : l,
          changed =
              !kept.deleted &&
              b != null &&
              ticketFields.any(
                (key) => key != 'deleted' && !sameValue(kept[key], b[key]),
              );
      final row = {
        ...kept.toJson(),
        'deleted': true,
        'mergedIds': _union(
          l['mergedIds'],
          r['mergedIds'],
        ).where((value) => value != id).toList(),
        'updatedAt': ([l.text('updatedAt'), r.text('updatedAt')]..sort()).last,
      };
      if (changed) conflict('deleted');
      records.add(TicketRecord.fromJson(changed ? row : _validated(row)));
      continue;
    }
    final row = l.toJson();
    row['lockedFields'] = _union(l['lockedFields'], r['lockedFields']);
    for (final key in ticketFields.where(
      (key) =>
          !['lookupValues', 'fieldSources'].contains(key) &&
          !boardingFields.contains(key),
    )) {
      final lv = l[key],
          rv = r[key],
          ls = _state(l, key),
          rs = _state(r, key),
          bs = _state(b, key);
      if (sameValue(lv, rv)) {
        _takeField(
          row,
          r.lockedFields.contains(key) ||
                  l.isAutomatic(key) && !r.isAutomatic(key)
              ? r
              : l,
          key,
        );
        continue;
      }
      if (sameValue(rs, bs)) {
        _takeField(row, l, key);
        continue;
      }
      if (b == null) {
        final ll = l.lockedFields.contains(key),
            rl = r.lockedFields.contains(key);
        if (_empty(lv) && !ll) {
          _takeField(row, r, key);
          continue;
        }
        if (_empty(rv) && !rl) {
          _takeField(row, l, key);
          continue;
        }
        if (ll != rl) {
          _takeField(row, rl ? r : l, key);
          continue;
        }
        if ([
              'template',
              'provenance',
              'offsetX',
              'offsetY',
              'departureZone',
              'arrivalZone',
            ].contains(key) &&
            !ll &&
            !rl)
          continue;
      }
      if (sameValue(ls, bs)) {
        _takeField(row, r, key);
      } else {
        _takeField(row, l, key);
        conflict(key);
      }
    }
    dynamic boardingState(TicketRecord? record) => record == null
        ? null
        : {for (final key in boardingFields) key: record[key]};
    final lb = boardingState(l), rb = boardingState(r), bb = boardingState(b);
    if (sameValue(lb, rb) || sameValue(rb, bb)) {
      _takeBoarding(row, l);
    } else if (sameValue(lb, bb) ||
        b == null &&
            _empty(l['boardingCode']) &&
            !l.lockedFields.contains('boardingCode')) {
      _takeBoarding(row, r);
    } else if (b == null &&
        _empty(r['boardingCode']) &&
        !r.lockedFields.contains('boardingCode')) {
      _takeBoarding(row, l);
    } else {
      conflict('boardingCode');
    }
    row['sources'] = _union(l['sources'], r['sources']);
    row['mergedIds'] = _union(
      l['mergedIds'],
      r['mergedIds'],
    ).where((value) => value != id).toList();
    row['updatedAt'] = ([
      l.text('updatedAt'),
      r.text('updatedAt'),
    ]..sort()).last;
    records.add(TicketRecord.fromJson(row));
  }
  return ArchiveMerge(records, conflicts);
}
