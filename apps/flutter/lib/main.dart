import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'app_store.dart';
import 'archive_page.dart';
import 'design.dart';
import 'editor.dart';
import 'map_page.dart';
import 'settings_page.dart';
import 'statistics_page.dart';

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
  int page = 0;
  bool localAccess = false;
  late final transition = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 320),
    value: 1,
  );
  AppStore get store => widget.store;
  @override
  void dispose() {
    transition.dispose();
    super.dispose();
  }

  void _demo(bool value) {
    if (page == 3) page = 0;
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
      if (!store.demo && !store.connected && !localAccess) {
        return WelcomePage(
          store,
          onLocal: () => setState(() => localAccess = true),
        );
      }
      final wide = MediaQuery.sizeOf(context).width >= 900;
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
      final motion = transition.drive(CurveTween(curve: Curves.easeOutCubic));
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
                    const Text(
                      '行迹',
                      style: TextStyle(
                        fontFamily: 'TicketSong',
                        fontSize: 30,
                        color: ink,
                      ),
                    ),
                    if (!store.demo || store.connected) const Spacer(),
                    if (store.demo && !store.connected)
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
                                    ? '示例票库 · 开始使用'
                                    : '开始使用',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            );
                          },
                        ),
                      ),
                    if (!store.demo) ...[
                      Icon(
                        store.pending
                            ? Icons.cloud_upload_outlined
                            : Icons.cloud_done_outlined,
                        size: 16,
                        color: muted,
                      ),
                      const SizedBox(width: 8),
                      if (wide)
                        Text(
                          store.status,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      const SizedBox(width: 16),
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
              if (store.busy) const LinearProgressIndicator(minHeight: 2),
              Expanded(
                child: FadeTransition(
                  opacity: Tween<double>(begin: .25, end: 1).animate(motion),
                  child: SlideTransition(
                    position: Tween<Offset>(
                      begin: const Offset(0, .015),
                      end: Offset.zero,
                    ).animate(motion),
                    child: IndexedStack(index: page, children: pages),
                  ),
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: SafeArea(
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
                            for (final (index, item) in destinations.indexed)
                              _navigationItem(index, item, wide),
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
                        onPressed: store.busy
                            ? null
                            : () => openEditor(context, store),
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
  Widget _navigationItem(int index, (IconData, String) item, bool wide) {
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
                  if (active || wide) ...[
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

class WelcomePage extends StatelessWidget {
  final AppStore store;
  final VoidCallback onLocal;
  const WelcomePage(this.store, {super.key, required this.onLocal});
  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(28),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '行迹',
                  style: TextStyle(
                    fontFamily: 'TicketSong',
                    fontSize: 54,
                    color: ink,
                  ),
                ),
                const SizedBox(height: 24),
                Text(
                  '把走过的路，留在票里。',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 16),
                const Text(
                  '收藏火车票与登机牌，在地图中重看旅程。',
                  style: TextStyle(color: muted, fontSize: 16),
                ),
                const SizedBox(height: 40),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: () => connectDialog(context, store),
                    icon: const Icon(Icons.cloud_outlined),
                    label: const Text('连接私人票库'),
                  ),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () => store.setDemo(true),
                    icon: const Icon(Icons.explore_outlined),
                    label: const Text('先看看示例模式'),
                  ),
                ),
                const SizedBox(height: 12),
                TextButton(onPressed: onLocal, child: const Text('先在本机使用')),
                const SizedBox(height: 56),
                const Text(
                  'by @YuanzeSun',
                  style: TextStyle(color: muted, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
