import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'design.dart';
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
  @override
  void dispose() {
    scroll.dispose();
    super.dispose();
  }

  List<TicketRecord> get records =>
      widget.store.records
          .where(
            (record) =>
                (filter == 'all' || (filter == 'flight') == record.isFlight) &&
                placeKey(
                  [
                    record.text('origin'),
                    record.text('destination'),
                    record.text('originCity'),
                    record.text('destinationCity'),
                    record.text('service'),
                    record.text('passenger'),
                    record.departure?.calendarText ?? '',
                  ].join(' '),
                ).contains(placeKey(query)),
          )
          .toList()
        ..sort(
          (a, b) =>
              (recent ? -1 : 1) *
              (a.departure?.calendarText ?? '').compareTo(
                b.departure?.calendarText ?? '',
              ),
        );
  @override
  Widget build(BuildContext context) {
    final rows = records, wide = MediaQuery.sizeOf(context).width >= 900;
    final gutter = wide ? 48.0 : 24.0;
    final feature = grid && query.isEmpty && filter == 'all' && rows.isNotEmpty;
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1240),
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
                            onPressed: () => setState(() => query = ''),
                            icon: const Icon(Icons.close),
                          ),
                        TextButton.icon(
                          onPressed: _options,
                          icon: const Icon(Icons.tune_outlined, size: 18),
                          label: const Text('整理'),
                        ),
                      ],
                    ),
                    const SizedBox(height: 20),
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
                      ],
                    ),
                  ),
                ),
              ),
            SliverPadding(
              padding: EdgeInsets.fromLTRB(gutter, 0, gutter, 120),
              sliver: grid
                  ? SliverLayoutBuilder(
                      builder: (context, constraints) {
                        final count =
                                (constraints.crossAxisExtent /
                                        (small ? 230 : 370))
                                    .floor()
                                    .clamp(1, 4),
                            width =
                                (constraints.crossAxisExtent -
                                    (count - 1) * 24) /
                                count;
                        return SliverGrid.builder(
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: count,
                                crossAxisSpacing: 24,
                                mainAxisSpacing: small ? 24 : 32,
                                mainAxisExtent: width / 1.5 + (small ? 0 : 72),
                              ),
                          itemCount: rows.length,
                          itemBuilder: (context, index) => _tile(rows[index]),
                        );
                      },
                    )
                  : SliverList.builder(
                      itemCount: rows.length,
                      itemBuilder: (context, index) {
                        final record = rows[index],
                            year = record.departure?.year,
                            heading =
                                index == 0 ||
                                rows[index - 1].departure?.year != year;
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (heading)
                              Padding(
                                padding: const EdgeInsets.only(
                                  top: 8,
                                  bottom: 20,
                                ),
                                child: Text(
                                  year?.toString() ?? '年份未知',
                                  style: Theme.of(context).textTheme.titleLarge,
                                ),
                              ),
                            Material(
                              color: Colors.transparent,
                              child: InkWell(
                                onTap: () =>
                                    openTicket(context, widget.store, record),
                                borderRadius: BorderRadius.circular(16),
                                child: Padding(
                                  padding: EdgeInsets.symmetric(
                                    vertical: small ? 14 : 20,
                                  ),
                                  child: Row(
                                    children: [
                                      if (!small) ...[
                                        SizedBox(
                                          width: 110,
                                          child: Hero(
                                            tag: record.id,
                                            child: TicketFace(
                                              record,
                                              widget.store.catalog,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 20),
                                      ],
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              '${record.text('origin')} → ${record.text('destination')}',
                                              style: const TextStyle(
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                            const SizedBox(height: 6),
                                            Text(
                                              '${record.departure?.label ?? '日期未知'}  ${record.text('service')}',
                                              style: Theme.of(context)
                                                  .textTheme
                                                  .bodySmall,
                                            ),
                                          ],
                                        ),
                                      ),
                                      const Icon(
                                        Icons.chevron_right,
                                        size: 20,
                                        color: muted,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                            const Divider(height: 1),
                          ],
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
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
            style: const TextStyle(fontSize: 16, color: muted),
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
              Text(
                record.departure?.label ?? '',
                style: const TextStyle(fontSize: 14, color: muted),
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

  Widget _tile(TicketRecord record) => InkWell(
    onTap: () => openTicket(context, widget.store, record),
    borderRadius: BorderRadius.circular(16),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Align(
            alignment: Alignment.center,
            child: Hero(
              tag: record.id,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  boxShadow: [
                    BoxShadow(
                      color: ink.withValues(alpha: .07),
                      blurRadius: 16,
                      offset: const Offset(0, 6),
                    ),
                  ],
                ),
                child: TicketFace(record, widget.store.catalog),
              ),
            ),
          ),
        ),
        if (!small)
          Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${record.text('origin')} → ${record.text('destination')}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${record.departure?.label ?? '日期未知'}  ${record.text('service')}',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.north_east, size: 16, color: muted),
              ],
            ),
          ),
      ],
    ),
  );
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
    if (result != null) setState(() => query = result);
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
                          setState(() => filter = id);
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
