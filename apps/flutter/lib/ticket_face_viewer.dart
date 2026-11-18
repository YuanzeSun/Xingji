import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'ticket_face.dart';

class TicketFaceViewer extends StatefulWidget {
  const TicketFaceViewer(this.record, this.catalog, this.heroTag, {super.key});

  final TicketRecord record;
  final ReferenceCatalog catalog;
  final Object heroTag;

  @override
  State<TicketFaceViewer> createState() => _TicketFaceViewerState();
}

class _TicketFaceViewerState extends State<TicketFaceViewer> {
  final transform = TransformationController();
  Offset tapPoint = Offset.zero;

  void _doubleTap() {
    if (transform.value.getMaxScaleOnAxis() > 1.01) {
      transform.value = Matrix4.identity();
      return;
    }
    const scale = 2.5;
    transform.value = Matrix4.translationValues(
      tapPoint.dx * (1 - scale),
      tapPoint.dy * (1 - scale),
      0,
    )..scaleByDouble(scale, scale, 1, 1);
  }

  @override
  void dispose() {
    transform.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: const Color(0xFF111923),
    appBar: AppBar(
      title: const Text('查看票面'),
      backgroundColor: const Color(0xFF111923),
      foregroundColor: Colors.white,
      actions: [
        IconButton(
          onPressed: () => transform.value = Matrix4.identity(),
          tooltip: '恢复票面大小',
          icon: const Icon(Icons.fit_screen_outlined),
        ),
      ],
    ),
    body: SafeArea(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onDoubleTapDown: (event) => tapPoint = event.localPosition,
        onDoubleTap: _doubleTap,
        child: InteractiveViewer(
          transformationController: transform,
          minScale: 1,
          maxScale: 8,
          boundaryMargin: const EdgeInsets.all(24),
          child: Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Hero(
                tag: widget.heroTag,
                child: TicketFace(widget.record, widget.catalog),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
