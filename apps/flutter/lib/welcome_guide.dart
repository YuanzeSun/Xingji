import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import 'app_store.dart';
import 'design.dart';
import 'ticket_entry.dart';
import 'ticket_face.dart';

enum _GuideAction { addTicket, showExamples }

Future<void> showWelcomeGuide(BuildContext context, AppStore store) async {
  final action = await showModalBottomSheet<_GuideAction>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    constraints: const BoxConstraints(maxWidth: 520),
    backgroundColor: paper,
    sheetAnimationStyle: MediaQuery.disableAnimationsOf(context)
        ? AnimationStyle.noAnimation
        : const AnimationStyle(
            duration: Duration(milliseconds: 340),
            reverseDuration: Duration(milliseconds: 240),
          ),
    builder: (context) => _WelcomeGuide(store: store),
  );
  if (!context.mounted || action == null) return;
  switch (action) {
    case _GuideAction.addTicket:
      await openTicketEntry(context, store);
    case _GuideAction.showExamples:
      store.setDemo(true);
  }
}

const _steps = [
  (title: '收下第一张票', description: '点「＋」录入火车票或机票，也可以从「同步」导入已有票据。'),
  (title: '在地图上回看旅程', description: '保存出发地和目的地后，就能在地图里回看火车线路和飞过的航线。'),
  (title: '做一本旅行纪念册', description: '在票夹勾选几张票，就能把它们导出成一份 PDF 纪念册。'),
];

class _WelcomeGuide extends StatefulWidget {
  const _WelcomeGuide({required this.store});

  final AppStore store;

  @override
  State<_WelcomeGuide> createState() => _WelcomeGuideState();
}

class _WelcomeGuideState extends State<_WelcomeGuide> {
  final _pages = PageController();
  int _step = 0;
  int _furthestStep = 0;

  void _goTo(int step) {
    if (MediaQuery.disableAnimationsOf(context)) {
      _pages.jumpToPage(step);
    } else {
      _pages.animateToPage(
        step,
        duration: const Duration(milliseconds: 360),
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final reducedMotion = MediaQuery.disableAnimationsOf(context);
    final last = _step == _steps.length - 1;
    return SizedBox(
      height: math.min(514, MediaQuery.sizeOf(context).height * .94),
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.only(top: 8, bottom: 12),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.only(left: 24, right: 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      '使用引导',
                      style: Theme.of(context).textTheme.labelLarge,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: '关闭使用引导',
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pages,
                itemCount: _steps.length,
                physics: reducedMotion
                    ? const NeverScrollableScrollPhysics()
                    : null,
                onPageChanged: (index) => setState(() {
                  _step = index;
                  _furthestStep = math.max(_furthestStep, index);
                }),
                itemBuilder: (context, index) => _GuidePage(
                  store: widget.store,
                  step: index,
                  entered: index <= _furthestStep,
                  reducedMotion: reducedMotion,
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 0),
              child: Column(
                children: [
                  Semantics(
                    label: '第 ${_step + 1} 步，共 ${_steps.length} 步',
                    child: ExcludeSemantics(
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          for (var index = 0; index < _steps.length; index++)
                            AnimatedContainer(
                              duration: reducedMotion
                                  ? Duration.zero
                                  : const Duration(milliseconds: 230),
                              curve: Curves.easeOutCubic,
                              margin: const EdgeInsets.symmetric(horizontal: 3),
                              width: index == _step ? 22 : 6,
                              height: 6,
                              decoration: BoxDecoration(
                                color: index == _step ? ink : mist,
                                borderRadius: BorderRadius.circular(6),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Wrap(
                      alignment: WrapAlignment.end,
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        if (_step > 0)
                          TextButton(
                            onPressed: () => _goTo(_step - 1),
                            child: const Text('上一步'),
                          ),
                        if (last && widget.store.canWrite)
                          TextButton(
                            onPressed: () =>
                                Navigator.pop(context, _GuideAction.addTicket),
                            child: const Text('录入票据'),
                          ),
                        FilledButton(
                          onPressed: last
                              ? () => Navigator.pop(
                                  context,
                                  _GuideAction.showExamples,
                                )
                              : () => _goTo(_step + 1),
                          child: Text(last ? '浏览示例' : '下一步'),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GuidePage extends StatelessWidget {
  const _GuidePage({
    required this.store,
    required this.step,
    required this.entered,
    required this.reducedMotion,
  });

  final AppStore store;
  final int step;
  final bool entered, reducedMotion;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final compact = constraints.maxHeight < 350;
      final copy = _steps[step];
      final sample = store.examples.firstOrNull;
      final ticket = step == 0 && sample != null
          ? SizedBox(
              width: compact ? 112 : 195,
              child: TicketFace(sample, store.catalog),
            )
          : null;
      Widget artwork(double progress, Widget? child) => Stack(
        alignment: Alignment.center,
        fit: StackFit.expand,
        children: [
          CustomPaint(painter: _GuideArtwork(step, progress)),
          if (child != null)
            Center(
              child: Transform.translate(
                offset: Offset(0, 10 * (1 - progress)),
                child: Transform.rotate(
                  angle: -.08 * progress,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(8),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x24243C65),
                          offset: Offset(0, 8),
                          blurRadius: 12,
                        ),
                      ],
                    ),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: child,
                    ),
                  ),
                ),
              ),
            ),
        ],
      );
      return SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ExcludeSemantics(
              child: Container(
                height: compact ? 94 : 206,
                width: double.infinity,
                clipBehavior: Clip.antiAlias,
                decoration: BoxDecoration(
                  color: mist,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: reducedMotion
                    ? artwork(1, ticket)
                    : TweenAnimationBuilder<double>(
                        tween: Tween(begin: 0, end: entered ? 1 : 0),
                        duration: const Duration(milliseconds: 520),
                        curve: Curves.easeOutCubic,
                        builder: (_, value, child) => artwork(value, child),
                        child: ticket,
                      ),
              ),
            ),
            SizedBox(height: compact ? 12 : 20),
            Semantics(
              header: true,
              child: Text(
                copy.title,
                style: compact
                    ? Theme.of(context).textTheme.titleLarge
                    : Theme.of(context).textTheme.headlineMedium,
              ),
            ),
            const SizedBox(height: 6),
            Text(
              copy.description,
              style: Theme.of(context).textTheme.bodyLarge
                  ?.copyWith(color: muted),
            ),
          ],
        ),
      );
    },
  );
}

/// The short illustrations follow the actions described by each step.
class _GuideArtwork extends CustomPainter {
  const _GuideArtwork(this.step, this.progress);

  final int step;
  final double progress;

  @override
  void paint(Canvas canvas, Size size) {
    final scale = math.min(size.width / 330, size.height / 180);
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale);
    if (step == 1) {
      _route(canvas);
    } else {
      _papers(canvas, booklet: step == 2);
    }
  }

  void _route(Canvas canvas) {
    final outline = Paint()
      ..color = const Color(0xFFCCD7E7)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.3;
    for (final y in [-42.0, -7.0, 33.0]) {
      canvas.drawPath(
        Path()
          ..moveTo(-146, y + 16)
          ..quadraticBezierTo(-86, y - 28, -37, y)
          ..quadraticBezierTo(42, y + 29, 142, y - 11),
        outline,
      );
    }

    const start = Offset(-103, 40), end = Offset(108, -40);
    final curve = Path()
      ..moveTo(start.dx, start.dy)
      ..cubicTo(-51, -65, 30, 19, end.dx, end.dy);
    final path = curve.computeMetrics().single;
    canvas.drawPath(
      path.extractPath(0, path.length * progress),
      Paint()
        ..color = ink
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3.6
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(start, 6, Paint()..color = ink);
    final tip = path.getTangentForOffset(path.length * progress)?.position;
    if (tip != null) {
      canvas.drawCircle(tip, 10, Paint()..color = Colors.white);
      canvas.drawCircle(tip, 6, Paint()..color = ticketRed);
    }
  }

  void _papers(Canvas canvas, {required bool booklet}) {
    canvas.save();
    canvas.translate((booklet ? 22 : 15) * progress, 7);
    canvas.rotate((booklet ? .10 : .12) * progress);
    final back = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset.zero, width: 158, height: 106),
      const Radius.circular(9),
    );
    canvas.drawRRect(
      back,
      Paint()
        ..color = booklet ? const Color(0xFFC8D6E9) : const Color(0xFFBBCDE7),
    );
    canvas.restore();

    canvas.save();
    canvas.translate(-15 * progress, -5);
    canvas.rotate(-.07 * progress);
    final front = RRect.fromRectAndRadius(
      Rect.fromCenter(center: Offset.zero, width: 158, height: 106),
      const Radius.circular(9),
    );
    canvas.drawShadow(
      Path()..addRRect(front),
      const Color(0x32243C65),
      5,
      false,
    );
    canvas.drawRRect(front, Paint()..color = const Color(0xFFFAFBFD));
    if (booklet) {
      canvas.drawRRect(
        RRect.fromRectAndCorners(
          Rect.fromLTRB(-79, -53, -65, 53),
          topLeft: const Radius.circular(9),
          bottomLeft: const Radius.circular(9),
        ),
        Paint()..color = ink,
      );
    }
    final panel = RRect.fromRectAndRadius(
      Rect.fromLTWH(-59, -28, 118, booklet ? 49 : 39),
      const Radius.circular(5),
    );
    canvas.drawRRect(panel, Paint()..color = const Color(0xFFD2DFEE));
    final mark = Paint()
      ..color = ink
      ..strokeWidth = 2
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(const Offset(-47, -14), const Offset(-6, -14), mark);
    canvas.drawLine(
      const Offset(-59, 31),
      const Offset(37, 31),
      mark..color = muted,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_GuideArtwork oldDelegate) =>
      oldDelegate.step != step || oldDelegate.progress != progress;
}
