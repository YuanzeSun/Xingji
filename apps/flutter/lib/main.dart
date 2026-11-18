import 'dart:async';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'app_store.dart';
import 'apple_navigation_bar.dart';
import 'archive_page.dart';
import 'design.dart';
import 'map_page.dart';
import 'platform_services.dart';
import 'settings_page.dart';
import 'statistics_page.dart';
import 'ticket_entry.dart';
import 'travel_message_inbox.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  LicenseRegistry.addLicense(() async* {
    yield LicenseEntryWithLineBreaks([
      'Xingji ticket renderer',
    ], await rootBundle.loadString('assets/renderer-notices.txt'));
  });
  runApp(const ArchiveBootstrap());
}

class ArchiveBootstrap extends StatefulWidget {
  const ArchiveBootstrap({super.key});
  @override
  State<ArchiveBootstrap> createState() => _ArchiveBootstrapState();
}

class _ArchiveBootstrapState extends State<ArchiveBootstrap> {
  Future<AppStore> loading = AppStore.load();
  @override
  Widget build(BuildContext context) => FutureBuilder<AppStore>(
    future: loading,
    builder: (context, snapshot) {
      if (snapshot.hasData) return XingjiApp(store: snapshot.data!);
      return MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: archiveTheme(),
        home: Scaffold(
          body: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    snapshot.hasError ? '本机票库暂时无法打开。请保留应用数据，重新启动后再试。' : '行迹',
                    style: snapshot.hasError
                        ? null
                        : const TextStyle(fontSize: 32, color: ink),
                  ),
                  const SizedBox(height: 16),
                  if (snapshot.hasError)
                    FilledButton(
                      onPressed: () =>
                          setState(() => loading = AppStore.load()),
                      child: const Text('重试'),
                    )
                  else
                    const SizedBox(
                      width: 100,
                      child: LinearProgressIndicator(minHeight: 2),
                    ),
                ],
              ),
            ),
          ),
        ),
      );
    },
  );
}

class XingjiApp extends StatelessWidget {
  final AppStore store;
  const XingjiApp({super.key, required this.store});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: '行迹',
    debugShowCheckedModeBanner: false,
    theme: archiveTheme(),
    locale: const Locale('zh', 'CN'),
    supportedLocales: const [Locale('zh', 'CN'), Locale('en')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    home: ArchiveShell(store),
  );
}

class ArchiveShell extends StatefulWidget {
  final AppStore store;
  const ArchiveShell(this.store, {super.key});
  @override
  State<ArchiveShell> createState() => _ArchiveShellState();
}

class _ArchiveShellState extends State<ArchiveShell>
    with SingleTickerProviderStateMixin {
  final _openedPages = <int>{};
  int page = 0;
  late final transition = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 320),
    value: 1,
  );
  AppStore get store => widget.store;
  late final AppLifecycleListener lifecycle;
  late final Timer connectionTimer;

  @override
  void initState() {
    super.initState();
    lifecycle = AppLifecycleListener(onResume: _refreshPlatform);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_refreshPlatform());
    });
    connectionTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      final state = WidgetsBinding.instance.lifecycleState;
      if (state == null || state == AppLifecycleState.resumed) {
        unawaited(_refreshPlatform());
      }
    });
  }

  bool _refreshing = false;

  Future<void> _refreshPlatform() async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      await store.restoreConnection();
      if (!mounted) return;
      await store.refreshConnection();
      if (mounted) await importPendingTravelMessages(store);
    } catch (_) {
      // Leave pending messages in the inbox for the next check or review.
    } finally {
      _refreshing = false;
    }
  }

  @override
  void dispose() {
    connectionTimer.cancel();
    lifecycle.dispose();
    transition.dispose();
    super.dispose();
  }

  void _demo(bool value) {
    if (page == 3 || !value) page = 0;
    store.setDemo(value);
  }

  void _navigate(int value) {
    if (page == value) return;
    setState(() => page = value);
    if (!MediaQuery.disableAnimationsOf(context)) transition.forward(from: 0);
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: store,
    builder: (context, _) {
      final width = MediaQuery.sizeOf(context).width, wide = width >= 900;
      final showActiveLabel =
          store.demo ||
          width >=
              (MediaQuery.textScalerOf(context).scale(14) > 18 ? 430 : 360);
      final destinations = [
        (Icons.confirmation_number_outlined, '票夹'),
        (Icons.map_outlined, '地图'),
        (Icons.insights_outlined, '统计'),
        if (!store.demo) (Icons.cloud_outlined, '同步'),
      ];
      if (page >= destinations.length) page = 0;
      final pages = [
        ArchivePage(store),
        MapPage(store),
        StatisticsPage(store),
        if (!store.demo) SettingsPage(store),
      ];
      _openedPages.add(page);
      final content = [
        for (final (index, child) in pages.indexed)
          if (_openedPages.contains(index))
            TickerMode(enabled: page == index, child: child)
          else
            const SizedBox.shrink(),
      ];
      final motion = transition.drive(CurveTween(curve: Curves.easeOutCubic));
      const brand = Text(
        '行迹',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(fontFamily: 'TicketSong', fontSize: 30, color: ink),
      );
      return Scaffold(
        extendBody: true,
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(
                  wide ? 40 : 24,
                  12,
                  wide ? 40 : 24,
                  8,
                ),
                child: Row(
                  children: [
                    if (store.demo) brand else const Expanded(child: brand),
                    if (store.demo)
                      Expanded(
                        child: LayoutBuilder(
                          builder: (context, constraints) {
                            final textScale =
                                MediaQuery.textScalerOf(context).scale(14) / 14;
                            return TextButton.icon(
                              onPressed: () => _demo(false),
                              style: TextButton.styleFrom(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                ),
                              ),
                              icon: const Icon(
                                Icons.explore_outlined,
                                size: 16,
                              ),
                              label: Text(
                                constraints.maxWidth >= 164 * textScale
                                    ? '示例票库 · 返回票夹'
                                    : '返回票夹',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            );
                          },
                        ),
                      ),
                    if (!store.demo) ...[
                      if (width >= 380 ||
                          MediaQuery.textScalerOf(context).scale(14) <= 18) ...[
                        Tooltip(
                          message: store.readOnlyReason ?? store.status,
                          child: Text(
                            store.connection == null
                                ? '本机票库'
                                : store.readOnlyReason != null
                                ? '同步暂停'
                                : store.busy
                                ? '同步中'
                                : '已连接',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                        const SizedBox(width: 12),
                      ],
                      const ExcludeSemantics(
                        child: Text('示例', style: TextStyle(color: muted)),
                      ),
                      const SizedBox(width: 4),
                    ],
                    Semantics(
                      label: '示例模式',
                      child: Switch.adaptive(
                        value: store.demo,
                        onChanged: store.busy ? null : _demo,
                      ),
                    ),
                  ],
                ),
              ),
              if (store.readOnlyReason case final reason?
                  when !store.demo && page != 3)
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: wide ? 40 : 24),
                  child: Row(
                    children: [
                      Expanded(child: Text(reason)),
                      TextButton(
                        onPressed: () => _navigate(3),
                        child: const Text('查看同步'),
                      ),
                    ],
                  ),
                ),
              if (store.busy) const LinearProgressIndicator(minHeight: 2),
              Expanded(
                child: FadeTransition(
                  opacity: Tween<double>(begin: .25, end: 1).animate(motion),
                  child: SlideTransition(
                    position: Tween<Offset>(
                      begin: const Offset(0, .015),
                      end: Offset.zero,
                    ).animate(motion),
                    child: IndexedStack(index: page, children: content),
                  ),
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: AppleServices.available
            ? AppleNavigationBar(
                interactive: ModalRoute.isCurrentOf(context) ?? true,
                selected: page,
                demo: store.demo,
                canWrite: store.canWrite,
                onSelect: _navigate,
                onAdd: (choice) =>
                    openTicketEntry(context, store, choice: choice),
              )
            : SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
                  child: Center(
                    heightFactor: 1,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(32),
                          child: BackdropFilter(
                            filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
                            child: Container(
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: .93),
                                borderRadius: BorderRadius.circular(32),
                                border: Border.all(color: Colors.white),
                              ),
                              padding: const EdgeInsets.all(6),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  for (final (index, item)
                                      in destinations.indexed)
                                    _navigationItem(
                                      index,
                                      item,
                                      wide,
                                      showActiveLabel,
                                    ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        if (!store.demo) ...[
                          const SizedBox(width: 12),
                          SizedBox.square(
                            dimension: 60,
                            child: FilledButton(
                              style: FilledButton.styleFrom(
                                padding: EdgeInsets.zero,
                                shape: const CircleBorder(),
                              ),
                              onPressed: !store.canWrite
                                  ? null
                                  : () => openTicketEntry(context, store),
                              child: const Icon(
                                Icons.add,
                                size: 28,
                                semanticLabel: '录入票据',
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ),
      );
    },
  );
  Widget _navigationItem(
    int index,
    (IconData, String) item,
    bool wide,
    bool showActiveLabel,
  ) {
    final active = page == index;
    return Semantics(
      selected: active,
      button: true,
      label: item.$2,
      child: Tooltip(
        excludeFromSemantics: true,
        message: item.$2,
        child: InkWell(
          key: ValueKey('nav-${item.$2}'),
          onTap: () => _navigate(index),
          borderRadius: BorderRadius.circular(26),
          child: AnimatedContainer(
            duration: Duration(
              milliseconds: MediaQuery.disableAnimationsOf(context) ? 0 : 260,
            ),
            curve: Curves.easeOutCubic,
            padding: EdgeInsets.symmetric(
              horizontal: wide ? 24 : 12,
              vertical: 12,
            ),
            decoration: BoxDecoration(
              color: active ? ink : Colors.transparent,
              borderRadius: BorderRadius.circular(26),
            ),
            child: ExcludeSemantics(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(item.$1, size: 22, color: active ? Colors.white : muted),
                  if (wide || active && showActiveLabel) ...[
                    const SizedBox(width: 8),
                    Text(
                      item.$2,
                      style: TextStyle(
                        color: active ? Colors.white : muted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
