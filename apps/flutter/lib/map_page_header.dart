import 'package:material_ui/material_ui.dart';

import 'design.dart';

class MapOverlay extends StatelessWidget {
  final Set<String> layers;
  final void Function(String, bool) onChanged;
  final VoidCallback? onFullscreen;
  final Widget? mapStyle;
  const MapOverlay(
    this.layers,
    this.onChanged, {
    super.key,
    this.onFullscreen,
    this.mapStyle,
  });
  @override
  Widget build(BuildContext context) => Positioned(
    top: 24,
    left: 24,
    right: 24,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                '行程地图',
                style: Theme.of(context).textTheme.headlineLarge,
              ),
            ),
            if (onFullscreen != null)
              IconButton.filledTonal(
                onPressed: onFullscreen,
                tooltip: '全屏显示地图',
                icon: const Icon(Icons.fullscreen),
              ),
          ],
        ),
        const SizedBox(height: 10),
        if (mapStyle != null) ...[mapStyle!, const SizedBox(height: 8)],
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final (id, label) in [
              ('rail', '火车'),
              ('flight', '飞机'),
              ('routes', '航线'),
              ('railway', '铁路线'),
            ])
              _LayerButton(
                label,
                selected: layers.contains(id),
                onPressed: () => onChanged(id, !layers.contains(id)),
              ),
          ],
        ),
      ],
    ),
  );
}

class _LayerButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onPressed;
  const _LayerButton(
    this.label, {
    required this.selected,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    selected: selected,
    child: TextButton(
      onPressed: onPressed,
      style: TextButton.styleFrom(
        foregroundColor: selected ? ink : muted,
        backgroundColor: Colors.transparent,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        minimumSize: const Size(44, 44),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (selected) ...[
            const Icon(Icons.check, size: 16),
            const SizedBox(width: 6),
          ],
          Text(
            label,
            style: TextStyle(
              fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            ),
          ),
        ],
      ),
    ),
  );
}
