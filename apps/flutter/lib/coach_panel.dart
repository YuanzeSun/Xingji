import 'package:material_ui/material_ui.dart';

class CoachPanel extends StatefulWidget {
  final Map data;
  final String carriage;
  const CoachPanel(this.data, {required this.carriage, super.key});
  @override
  State<CoachPanel> createState() => _CoachPanelState();
}

class _CoachPanelState extends State<CoachPanel> {
  int? selected;
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
    final number = int.tryParse(
      RegExp(r'\d+').stringMatch(widget.carriage) ?? '',
    );
    final matching = number == null
        ? -1
        : cars.indexWhere(
            (car) => int.tryParse(car['number']?.toString() ?? '') == number,
          );
    final index = (selected ?? matching).clamp(0, cars.length - 1);
    return ExpansionTile(
      title: const Text('单节车厢示意图'),
      subtitle: const Text('当前编组参考'),
      tilePadding: EdgeInsets.zero,
      onExpansionChanged: (value) => setState(() => expanded = value),
      children: expanded
          ? [
              DropdownButtonFormField<int>(
                key: ValueKey(index),
                initialValue: index,
                isExpanded: true,
                decoration: const InputDecoration(labelText: '车厢'),
                items: [
                  for (var i = 0; i < cars.length; i++)
                    DropdownMenuItem(
                      value: i,
                      child: Text(
                        '${cars[i]['name']}${i == matching ? '（你的车厢）' : ''}',
                      ),
                    ),
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
