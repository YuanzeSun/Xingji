import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:cupertino_ui/cupertino_ui.dart'
    show CupertinoSearchTextField, CupertinoSliverRefreshControl;
import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'platform_services.dart';
import 'welcome_guide.dart';
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
  String query = '';
  bool includeRail = true, includeFlight = true, grid = true, small = false;
  bool searchVisible = false;
  final searchController = TextEditingController();
  final searchFocus = FocusNode();
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
    searchController.dispose();
    searchFocus.dispose();
    super.dispose();
  }

  List<TicketRecord> get records {
    final terms = query
        .split(RegExp(r'\s+'))
        .map(placeKey)
        .where((s) => s.isNotEmpty)
        .toList();
    final rows = widget.store.records.where((record) {
      if (record.isFlight ? !includeFlight : !includeRail) return false;
      if (terms.isEmpty) return true;
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
      return b.compareTo(a);
    }

    rows.sort((a, b) {
      final year = datePart(a.departure?.year, b.departure?.year);
      if (year != 0) return year;
      final day = datePart(a.departure?.dayOfYear, b.departure?.dayOfYear);
      if (day != 0) return day;
      final aTime = a.text('departureTime'), bTime = b.text('departureTime');
      if (aTime.isEmpty && bTime.isNotEmpty) return 1;
      if (bTime.isEmpty && aTime.isNotEmpty) return -1;
      final time = aTime.compareTo(bTime);
      return time == 0 ? a.id.compareTo(b.id) : -time;
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
    final rows = records;
    final gutter = archiveGutter(MediaQuery.sizeOf(context).width);
    final canRefresh = !widget.store.demo && widget.store.connected;
    final apple = AppleServices.available;
    final content = CustomScrollView(
      controller: scroll,
      physics: canRefresh ? const AlwaysScrollableScrollPhysics() : null,
      slivers: [
        if (canRefresh && apple)
          CupertinoSliverRefreshControl(onRefresh: _refresh),
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
                    if (!widget.store.demo)
                      TextButton(
                        onPressed: () =>
                            showWelcomeGuide(context, widget.store),
                        child: const Text('使用引导'),
                      ),
                    IconButton(
                      tooltip: searchVisible ? '关闭搜索' : '搜索票据',
                      onPressed: _toggleSearch,
                      icon: Icon(
                        searchVisible ? Icons.close : Icons.search,
                        size: 26,
                      ),
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
                AnimatedSize(
                  duration: MediaQuery.disableAnimationsOf(context)
                      ? Duration.zero
                      : const Duration(milliseconds: 220),
                  alignment: Alignment.topCenter,
                  curve: Curves.easeOutCubic,
                  child: searchVisible
                      ? Padding(
                          padding: const EdgeInsets.only(top: 16),
                          child: apple
                              ? CupertinoSearchTextField(
                                  backgroundColor: Colors.white,
                                  controller: searchController,
                                  focusNode: searchFocus,
                                  placeholder: '城市、车站、车次或旅客',
                                  onChanged: _setQuery,
                                  onSuffixTap: () {
                                    searchController.clear();
                                    _setQuery('');
                                  },
                                )
                              : TextField(
                                  controller: searchController,
                                  focusNode: searchFocus,
                                  textInputAction: TextInputAction.done,
                                  onChanged: _setQuery,
                                  decoration: InputDecoration(
                                    hintText: '城市、车站、车次或旅客',
                                    prefixIcon: const Icon(Icons.search),
                                    suffixIcon: query.isEmpty
                                        ? null
                                        : IconButton(
                                            tooltip: '清空搜索',
                                            onPressed: () {
                                              searchController.clear();
                                              _setQuery('');
                                            },
                                            icon: const Icon(Icons.clear),
                                          ),
                                  ),
                                ),
                        )
                      : const SizedBox(width: double.infinity),
                ),
                const SizedBox(height: 22),
                Text(
                  query.isNotEmpty
                      ? '搜索结果'
                      : includeRail != includeFlight
                      ? (includeRail ? '火车票据' : '机票票据')
                      : '全部票据',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                Wrap(
                  spacing: 5,
                  runSpacing: 4,
                  children: [
                    _displayToggle(
                      '火车票',
                      Icons.train_outlined,
                      includeRail,
                      () {
                        includeRail = !includeRail;
                        selected.clear();
                      },
                    ),
                    _displayToggle(
                      '机票',
                      Icons.flight_outlined,
                      includeFlight,
                      () {
                        includeFlight = !includeFlight;
                        selected.clear();
                      },
                    ),
                    _displayToggle(
                      '紧凑尺寸',
                      Icons.density_small,
                      small,
                      () => small = !small,
                    ),
                    _displayToggle(
                      '网格展示',
                      Icons.grid_view,
                      grid,
                      () => grid = !grid,
                    ),
                  ],
                ),
                const SizedBox(height: 12),
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
                      widget.store.records.isEmpty && query.isEmpty
                          ? '从第一张票开始'
                          : '没有找到匹配的票据',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      widget.store.records.isEmpty && query.isEmpty
                          ? '点击下方 +，收藏自己的旅程。'
                          : query.isEmpty
                          ? '可切换火车票和机票筛选。'
                          : '试试城市名、车次或航班号。',
                      style: const TextStyle(color: muted),
                    ),
                    if (!widget.store.demo &&
                        widget.store.records.isEmpty &&
                        query.isEmpty)
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
    );
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: archiveContentWidth),
        child: canRefresh && !apple
            ? RefreshIndicator.adaptive(onRefresh: _refresh, child: content)
            : content,
      ),
    );
  }

  Future<void> _refresh() async {
    if (widget.store.busy || widget.store.demo || !widget.store.connected) {
      return;
    }
    try {
      await widget.store.sync();
    } catch (error) {
      if (mounted) showError(context, error);
    }
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
    onLongPress: selecting || exporting
        ? null
        : () => setState(() {
            selecting = true;
            selected.add(record.id);
          }),
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
        ? '日期未知'
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

  Widget _displayToggle(
    String label,
    IconData icon,
    bool value,
    VoidCallback change,
  ) => IconButton(
    tooltip: label,
    isSelected: value,
    onPressed: exporting ? null : () => setState(change),
    icon: Icon(icon, size: 20),
    style: IconButton.styleFrom(
      backgroundColor: value ? mist : Colors.transparent,
      foregroundColor: value ? ink : muted,
    ),
  );

  void _setQuery(String value) {
    if (query == value) return;
    setState(() {
      query = value;
      selected.clear();
    });
  }

  void _toggleSearch() {
    if (searchVisible) {
      searchFocus.unfocus();
      searchController.clear();
      setState(() {
        searchVisible = false;
        query = '';
        selected.clear();
      });
    } else {
      setState(() => searchVisible = true);
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && searchVisible) searchFocus.requestFocus();
      });
    }
  }
}
