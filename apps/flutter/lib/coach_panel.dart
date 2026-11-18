import 'package:material_ui/material_ui.dart';

class CoachPanel extends StatefulWidget {
  final Map data;
  const CoachPanel(this.data, {super.key});
  @override
  State<CoachPanel> createState() => _CoachPanelState();
}

class _CoachPanelState extends State<CoachPanel> {
  int selected = 0;
  bool expanded = false;
  @override
  Widget build(BuildContext context) {
    final cars = (widget.data['cars'] as List? ?? []).where((car) {
      final uri = Uri.tryParse(car['url']?.toString() ?? '');
      return uri?.scheme == 'https' &&
          uri?.host == 'res.railgo.zenglingkun.cn' &&
          uri?.userInfo == '';
    }).toList();
    if (cars.isEmpty) return const SizedBox.shrink();
    final index = selected.clamp(0, cars.length - 1);
    return ExpansionTile(
      title: const Text('单节车厢示意图'),
      tilePadding: EdgeInsets.zero,
      onExpansionChanged: (value) => setState(() => expanded = value),
      children: expanded
          ? [
              DropdownButtonFormField<int>(
                initialValue: index,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '车厢'),
                items: [
                  for (var i = 0; i < cars.length; i++)
                    DropdownMenuItem(value: i, child: Text(cars[i]['name'])),
                ],
                onChanged: (value) => setState(() => selected = value!),
              ),
              const SizedBox(height: 16),
              InteractiveViewer(
                minScale: 1,
                maxScale: 4,
                child: Image.network(
                  webHtmlElementStrategy: WebHtmlElementStrategy.fallback,
                  cars[index]['url'],
                  loadingBuilder: (context, child, progress) => progress == null
                      ? child
                      : const Padding(
                          padding: EdgeInsets.all(24),
                          child: CircularProgressIndicator(),
                        ),
                  errorBuilder: (context, error, stack) => const Padding(
                    padding: EdgeInsets.all(20),
                    child: Text('图片暂时无法加载，请稍后重试'),
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ]
          : const [],
    );
  }
}
