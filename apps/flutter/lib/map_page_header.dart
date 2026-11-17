import 'package:material_ui/material_ui.dart';

import 'design.dart';

class MapOverlay extends StatelessWidget {
  final Set<String> layers;
  final void Function(String, bool) onChanged;
  const MapOverlay(this.layers, this.onChanged, {super.key});
  @override
  Widget build(BuildContext context) => Positioned(
    top: 24,
    left: 24,
    right: 24,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('行程地图', style: Theme.of(context).textTheme.headlineLarge),
        const SizedBox(height: 20),
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
              FilterChip(
                backgroundColor: Colors.white,
                selectedColor: mist,
                label: Text(label),
                selected: layers.contains(id),
                onSelected: (value) => onChanged(id, value),
              ),
          ],
        ),
      ],
    ),
  );
}
