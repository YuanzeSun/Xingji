import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'sync_review.dart';
import 'design.dart';
import 'export_service.dart';
import 'ticket_face.dart';
import 'ticket_detail.dart';

class ArchivePage extends StatefulWidget {
  final AppStore store;
  const ArchivePage(this.store, {super.key});
  @override
  State<ArchivePage> createState() => _ArchivePageState();
}

class _ArchivePageState extends State<ArchivePage> {
  String filter = 'all', query = '';
  bool grid = true, small = false, recent = true;
  final scroll = ScrollController();
  final selected = <String>{};
  bool selecting = false, exporting = false;
  String progress = '';
  bool? lastDemo;

  void _toggle(TicketRecord record) => setState(() {
    if (!selected.add(record.id)) selected.remove(record.id);
  });

  void _open(TicketRecord record) {
    if (selecting) {
      _toggle(record);
    } else {
      openTicket(context, widget.store, record);
    }
  }

  Widget _checkbox(TicketRecord record) => Checkbox(
    semanticLabel: '选择 ${record.text('service')}',
    value: selected.contains(record.id),
    activeColor: ink,
    side: const BorderSide(color: ink, width: 1.5),
    onChanged: exporting ? null : (_) => _toggle(record),
  );

  Future<void> _export(String kind) async {
    final chosen = records.where((row) => selected.contains(row.id)).toList();
    if (chosen.isEmpty || exporting) return;
    setState(() {
      exporting = true;
      progress = '正在准备导出…';
    });
    try {
      switch (kind) {
        case 'book':
          await saveFile(
            '行迹旅行手册.pdf',
            await travelBook(chosen, widget.store.catalog),
            'application/pdf',
          );
        case 'csv':
          await saveFile(
            '行迹票据.csv',
            utf8.encode(ticketCsv(chosen)),
            'text/csv',
          );
        case 'images':
          final images = Archive();
          for (var i = 0; i < chosen.length; i++) {
            if (mounted) {
              setState(() => progress = '正在导出 ${i + 1} / ${chosen.length}');
            }
            final record = chosen[i];
            final name =
                '${record.departure?.calendarText ?? '日期未知'}-${record.text('service')}-${i + 1}'
                    .replaceAll(RegExp(r'[^\w\u3400-\u9fff.-]'), '_');
            final png = await ticketPng(record, widget.store.catalog);
            if (chosen.length == 1) {
              await saveFile('$name.png', png, 'image/png');
            } else {
              images.addFile(ArchiveFile.bytes('$name.png', png));
            }
          }
          if (chosen.length > 1) {
            await saveFile(
              '行迹票据图片.zip',
              Uint8List.fromList(ZipEncoder().encode(images, level: 0)),
              'application/zip',
            );
          }
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    } finally {
      if (mounted) {
        setState(() {
          exporting = false;
          progress = '';
        });
      }
    }
  }

  Future<void> _delete() async {
    final originals = records
        .where((row) => selected.contains(row.id))
        .toList();
    if (originals.isEmpty ||
        !await checkArchiveWrite(context, widget.store) ||
        !mounted ||
        !await confirmDeletion(
          context,
          title: '删除选中的 ${originals.length} 张票据？',
        )) {
      return;
    }
    if (!mounted) return;
    try {
      await widget.store.deleteMany(
        originals.map((row) => row.id).toSet(),
        originals: originals,
        pick: pickSyncConflicts(context),
      );
      if (mounted) {
        setState(() {
          selected.clear();
          selecting = false;
        });
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  Widget _selectionBar(List<TicketRecord> rows) => Padding(
    padding: const EdgeInsets.only(bottom: 20),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Checkbox(
              value:
                  rows.isNotEmpty && rows.every((r) => selected.contains(r.id)),
              onChanged: exporting
                  ? null
                  : (value) => setState(() {
                      selected.clear();
                      if (value == true) selected.addAll(rows.map((r) => r.id));
                    }),
            ),
            Text('全选 · 已选 ${selected.length}'),
            TextButton(
              onPressed: exporting
                  ? null
                  : () => setState(() {
                      selecting = false;
                      selected.clear();
                    }),
              child: const Text('完成'),
            ),
          ],
        ),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            if (selected.isNotEmpty)
              OutlinedButton.icon(
                onPressed: exporting ? null : () => _export('book'),
                icon: const Icon(Icons.menu_book_outlined),
                label: const Text('导出纪念册'),
              ),
            OutlinedButton.icon(
              onPressed: selected.isEmpty || exporting
                  ? null
                  : () => _export('images'),
              icon: const Icon(Icons.image_outlined),
              label: const Text('逐个导出'),
            ),
            OutlinedButton.icon(
              onPressed: selected.isEmpty || exporting
                  ? null
                  : () => _export('csv'),
              icon: const Icon(Icons.table_chart_outlined),
              label: const Text('导出 CSV'),
            ),
            OutlinedButton.icon(
              style: OutlinedButton.styleFrom(foregroundColor: ticketRed),
              onPressed: !widget.store.canWrite || selected.isEmpty || exporting
                  ? null
                  : _delete,
              icon: const Icon(Icons.delete_outline),
              label: const Text('删除'),
            ),
          ],
        ),
        if (exporting) ...[
          const SizedBox(height: 12),
          const LinearProgressIndicator(),
          Text(progress),
        ],
      ],
    ),
  );
  @override
  void dispose() {
    scroll.dispose();
    super.dispose();
  }

  List<TicketRecord> get records {
    final terms = query
        .split(RegExp(r'\s+'))
        .map(placeKey)
        .where((s) => s.isNotEmpty)
        .toList();
    final rows = widget.store.records.where((record) {
      if (filter != 'all' && (filter == 'flight') != record.isFlight) {
        return false;
      }
      final text = placeKey(
        [
          ...[
            'origin',
            'destination',
            'originCity',
            'destinationCity',
            'service',
            'passenger',
            'identity',
            'seatClass',
            'airline',
            'ticketNumber',
            'railModel',
            'railTrainsets',
          ].map(record.text),
          record.departure?.calendarText ?? '',
          for (final side in ['origin', 'destination'])
            ...?widget.store.catalog.endpoint(record, side)?.aliases,
        ].join(' '),
      );
      return terms.every(text.contains);
    }).toList();
    int datePart(int? a, int? b) {
      if (a == null) return b == null ? 0 : 1;
      if (b == null) return -1;
      return recent ? b.compareTo(a) : a.compareTo(b);
    }

    rows.sort((a, b) {
      final year = datePart(a.departure?.year, b.departure?.year);
      if (year != 0) return year;
      final day = datePart(a.departure?.dayOfYear, b.departure?.dayOfYear);
      if (day != 0) return day;
      final time = a.text('departureTime').compareTo(b.text('departureTime'));
      return time == 0 ? a.id.compareTo(b.id) : (recent ? -time : time);
    });
    return rows;
  }

  @override
  Widget build(BuildContext context) {
    if (lastDemo != widget.store.demo) {
      selected.clear();
      selecting = false;
      lastDemo = widget.store.demo;
    }
    final rows = records, width = MediaQuery.sizeOf(context).width;
    final wide = width >= 900, gutter = archiveGutter(width);
    final feature =
        !selecting &&
        recent &&
        grid &&
        !small &&
        query.isEmpty &&
        filter == 'all' &&
        rows.isNotEmpty;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: archiveContentWidth),
        child: CustomScrollView(
          controller: scroll,
          slivers: [
            SliverPadding(
              padding: EdgeInsets.fromLTRB(gutter, 28, gutter, 0),
              sliver: SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Expanded(
                          child: Text(
                            '我的票夹',
                            style: Theme.of(context).textTheme.headlineLarge,
                          ),
                        ),
                        IconButton(
                          tooltip: '搜索票据',
                          onPressed: _search,
                          icon: const Icon(Icons.search, size: 26),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      widget.store.demo
                          ? '示例模式 · ${rows.length} 张票据'
                          : '${rows.length} 张票据，收藏走过的旅程。',
                      style: const TextStyle(fontSize: 15, color: muted),
                    ),
                    const SizedBox(height: 28),
                    if (feature) ...[
                      _featured(rows, wide),
                      const SizedBox(height: 40),
                    ],
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            query.isEmpty
                                ? (feature
                                      ? '全部票据'
                                      : '${{'all': '全部', 'rail': '火车', 'flight': '飞机'}[filter]}票据')
                                : '“$query”的搜索结果',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                        ),
                        if (query.isNotEmpty)
                          IconButton(
                            tooltip: '清空搜索',
                            onPressed: () => setState(() {
                              query = '';
                              selected.clear();
                            }),
                            icon: const Icon(Icons.close),
                          ),
                        if (!selecting)
                          TextButton(
                            onPressed: () => setState(() => selecting = true),
                            child: const Text('选择'),
                          ),
                        TextButton.icon(
                          onPressed: exporting ? null : _options,
                          icon: const Icon(Icons.tune_outlined, size: 18),
                          label: const Text('整理'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
                    if (selecting) _selectionBar(rows),
                  ],
                ),
              ),
            ),
            if (rows.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.confirmation_number_outlined,
                          size: 48,
                          color: muted,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          query.isEmpty ? '从第一张票开始' : '没有找到这段旅程',
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          query.isEmpty ? '点击下方 +，收藏自己的旅程。' : '试试城市名、车次或航班号。',
                          style: const TextStyle(color: muted),
                        ),
                        if (!widget.store.demo && widget.store.records.isEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: TextButton.icon(
                              onPressed: () => widget.store.setDemo(true),
                              icon: const Icon(Icons.explore_outlined),
                              label: const Text('先看看示例模式'),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ..._collection(rows, gutter),
            const SliverToBoxAdapter(child: SizedBox(height: 120)),
          ],
        ),
      ),
    );
  }

  List<Widget> _collection(List<TicketRecord> rows, double gutter) {
    final padding = EdgeInsets.symmetric(horizontal: gutter);
    if (grid && small) {
      return [
        SliverPadding(
          padding: padding,
          sliver: SliverLayoutBuilder(
            builder: (context, constraints) => SliverGrid.builder(
              gridDelegate: const SliverGridDelegateWithMaxCrossAxisExtent(
                maxCrossAxisExtent: 265,
                childAspectRatio: 1.5,
                crossAxisSpacing: 16,
                mainAxisSpacing: 16,
              ),
              itemCount: rows.length,
              itemBuilder: (context, index) =>
                  _ticketTap(rows[index], Center(child: _face(rows[index]))),
            ),
          ),
        ),
      ];
    }
    final years = <int?, List<TicketRecord>>{};
    for (final record in rows) {
      (years[record.departure?.year] ??= []).add(record);
    }
    return [
      for (final MapEntry(key: year, value: trips) in years.entries) ...[
        SliverPadding(
          padding: padding,
          sliver: SliverToBoxAdapter(child: _yearHeading(year, trips.length)),
        ),
        SliverPadding(
          padding: padding,
          sliver: SliverLayoutBuilder(
            builder: (context, constraints) {
              final columns = grid
                  ? (constraints.crossAxisExtent / 340).floor().clamp(1, 3)
                  : 1;
              return SliverList.builder(
                itemCount: (trips.length + columns - 1) ~/ columns,
                itemBuilder: (context, row) {
                  final start = row * columns;
                  Widget entry(int index) => _timelineEntry(
                    trips[index],
                    first: index == 0,
                    last: index == trips.length - 1,
                    connect: !small && columns == 1,
                  );

                  if (columns == 1) return entry(start);
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      for (var col = 0; col < columns; col++) ...[
                        if (col > 0) const SizedBox(width: 24),
                        Expanded(
                          child: start + col < trips.length
                              ? entry(start + col)
                              : const SizedBox.shrink(),
                        ),
                      ],
                    ],
                  );
                },
              );
            },
          ),
        ),
      ],
    ];
  }

  Widget _yearHeading(int? year, int count) => Padding(
    padding: const EdgeInsets.only(top: 6, bottom: 16),
    child: Column(
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                year == null ? '年份未知' : '$year 年',
                style: const TextStyle(
                  color: ink,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            Text('$count 张', style: Theme.of(context).textTheme.bodySmall),
          ],
        ),
        const SizedBox(height: 8),
        const Divider(height: 1),
      ],
    ),
  );

  Widget _ticketTap(TicketRecord record, Widget child) => InkWell(
    onTap: exporting ? null : () => _open(record),
    borderRadius: BorderRadius.circular(12),
    child: child,
  );

  Widget _face(TicketRecord record) => Stack(
    children: [
      Hero(tag: record.id, child: TicketFace(record, widget.store.catalog)),
      if (selecting)
        PositionedDirectional(
          top: 0,
          start: 0,
          child: Stack(
            alignment: Alignment.center,
            children: [
              const DecoratedBox(
                decoration: BoxDecoration(
                  color: paper,
                  borderRadius: BorderRadius.all(Radius.circular(7)),
                ),
                child: SizedBox.square(dimension: 28),
              ),
              _checkbox(record),
            ],
          ),
        ),
    ],
  );

  Widget _timelineEntry(
    TicketRecord record, {
    required bool first,
    required bool last,
    required bool connect,
  }) {
    final date = record.departure;
    final calendar = date?.date;
    final day = calendar == null
        ? date?.label ?? '日期未知'
        : '${calendar.month.toString().padLeft(2, '0')}.${calendar.day.toString().padLeft(2, '0')}';
    final time = record.text('departureTime');
    final service = record.text('service');
    final metadata = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              flex: 3,
              child: Text(
                service.isEmpty ? '班次待补充' : service,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: ink,
                  fontSize: small ? 16 : 22,
                  height: 1.15,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(width: 8),
            Flexible(
              flex: 2,
              child: Text(
                calendar != null && time.isNotEmpty ? '$day  $time' : day,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
          ],
        ),
        const SizedBox(height: 5),
        Text(
          '${record.text('origin')} → ${record.text('destination')}',
          maxLines: grid ? 2 : 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      ],
    );
    return Stack(
      children: [
        Padding(
          padding: EdgeInsetsDirectional.only(
            start: small ? 0 : 19,
            bottom: grid ? 26 : 20,
          ),
          child: _ticketTap(
            record,
            grid
                ? Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      metadata,
                      const SizedBox(height: 10),
                      _face(record),
                    ],
                  )
                : Row(
                    children: [
                      if (selecting) _checkbox(record),
                      Expanded(child: metadata),
                      const SizedBox(width: 8),
                      const Icon(Icons.chevron_right, size: 19, color: muted),
                    ],
                  ),
          ),
        ),
        if (connect && !(first && last))
          PositionedDirectional(
            start: 4,
            width: 1,
            top: first ? 12 : 0,
            bottom: last ? null : 0,
            height: last ? 12 : null,
            child: const IgnorePointer(
              child: ColoredBox(color: Color(0xFFCDD7E6)),
            ),
          ),
        if (!small)
          PositionedDirectional(
            start: 0,
            top: 8,
            child: IgnorePointer(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: paper,
                  border: Border.all(
                    color: record.isFlight ? ticketRed : ink,
                    width: 1.5,
                  ),
                ),
                child: const SizedBox.square(dimension: 9),
              ),
            ),
          ),
      ],
    );
  }

  Widget _featured(List<TicketRecord> rows, bool wide) {
    final record = rows.first;
    final face = Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 16, 20),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          if (rows.length > 1)
            Positioned.fill(
              child: Transform.translate(
                offset: const Offset(10, 12),
                child: Transform.rotate(
                  angle: .025,
                  child: Opacity(
                    opacity: .5,
                    child: TicketFace(rows[1], widget.store.catalog),
                  ),
                ),
              ),
            ),
          DecoratedBox(
            decoration: BoxDecoration(
              boxShadow: [
                BoxShadow(
                  color: ink.withValues(alpha: .16),
                  blurRadius: 32,
                  offset: const Offset(0, 14),
                ),
              ],
            ),
            child: Hero(
              tag: 'featured:${record.id}',
              child: TicketFace(record, widget.store.catalog),
            ),
          ),
        ],
      ),
    );
    final route = Column(
      crossAxisAlignment: wide
          ? CrossAxisAlignment.start
          : CrossAxisAlignment.center,
      children: [
        if (wide) ...[
          Text(
            record.departure?.label ?? '',
            style: const TextStyle(color: muted),
          ),
          const SizedBox(height: 24),
          Text(
            record.text('origin'),
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 12),
            child: Icon(Icons.south, color: muted, size: 22),
          ),
          Text(
            record.text('destination'),
            style: Theme.of(context).textTheme.headlineLarge,
          ),
          const SizedBox(height: 24),
          Text(
            record.text('service'),
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: ink,
            ),
          ),
        ] else
          Row(
            children: [
              Expanded(
                child: Text(
                  record.text('origin'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w600,
                    color: ink,
                  ),
                ),
              ),
              const Icon(Icons.east, size: 20, color: muted),
              Expanded(
                child: Text(
                  record.text('destination'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w600,
                    color: ink,
                  ),
                ),
              ),
            ],
          ),
      ],
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text('最近一程', style: TextStyle(fontSize: 14, color: muted)),
            ),
            if (!wide)
              Flexible(
                flex: 3,
                child: Wrap(
                  spacing: 12,
                  alignment: WrapAlignment.end,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (record.text('service').isNotEmpty)
                      Text(
                        record.text('service'),
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w700,
                          color: ink,
                        ),
                      ),
                    Text(
                      record.departure?.label ?? '',
                      style: const TextStyle(fontSize: 14, color: muted),
                    ),
                  ],
                ),
              ),
          ],
        ),
        const SizedBox(height: 16),
        InkWell(
          borderRadius: BorderRadius.circular(20),
          onTap: () => openTicket(
            context,
            widget.store,
            record,
            heroTag: 'featured:${record.id}',
          ),
          child: wide
              ? Row(
                  children: [
                    Expanded(flex: 3, child: face),
                    const SizedBox(width: 56),
                    Expanded(flex: 2, child: route),
                  ],
                )
              : Column(children: [face, const SizedBox(height: 12), route]),
        ),
      ],
    );
  }

  Future<void> _search() async {
    final controller = TextEditingController(text: query);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('搜索旅程'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: '城市、车站、车次或旅客',
            prefixIcon: Icon(Icons.search),
          ),
          onSubmitted: (value) => Navigator.pop(context, value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('取消'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text),
            child: const Text('搜索'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (result != null && mounted) {
      setState(() {
        query = result;
        selected.clear();
      });
    }
  }

  Future<void> _options() async {
    await showModalBottomSheet(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => SafeArea(
        child: StatefulBuilder(
          builder: (context, update) => Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('整理票夹', style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 24),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final (id, label) in [
                      ('all', '全部'),
                      ('rail', '火车'),
                      ('flight', '飞机'),
                    ])
                      ChoiceChip(
                        label: Text(label),
                        selected: filter == id,
                        onSelected: (_) {
                          setState(() {
                            filter = id;
                            selected.clear();
                          });
                          update(() {});
                        },
                      ),
                  ],
                ),
                const SizedBox(height: 16),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('网格展示'),
                  value: grid,
                  onChanged: (value) {
                    setState(() => grid = value);
                    update(() {});
                  },
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('紧凑尺寸'),
                  value: small,
                  onChanged: (value) {
                    setState(() => small = value);
                    update(() {});
                  },
                ),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('由近及远'),
                  value: recent,
                  onChanged: (value) {
                    setState(() => recent = value);
                    update(() {});
                  },
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton(
                    onPressed: () => Navigator.pop(context),
                    child: const Text('完成'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
