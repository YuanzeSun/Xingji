import 'package:material_ui/material_ui.dart';

import 'archive_choice_field.dart';
import 'archive_text_field.dart';

class SeatInput extends StatefulWidget {
  final TextEditingController controller;
  final String seatClass;
  final bool required, locked;
  final VoidCallback onChanged;
  const SeatInput({
    super.key,
    required this.controller,
    required this.seatClass,
    required this.required,
    required this.locked,
    required this.onChanged,
  });
  @override
  State<SeatInput> createState() => _SeatInputState();
}

class _SeatInputState extends State<SeatInput> {
  final number = TextEditingController();
  String berth = '';
  bool writing = false;
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(read);
    read();
  }

  void read() {
    if (writing) return;
    final match = RegExp(r'^(.*?)(?:号)?([上中下]铺)$')
        .firstMatch(widget.controller.text);
    number.text = match?[1] ?? widget.controller.text;
    berth = match?[2] ?? '';
  }

  @override
  void didUpdateWidget(SeatInput old) {
    super.didUpdateWidget(old);
    if (old.controller != widget.controller) {
      old.controller.removeListener(read);
      widget.controller.addListener(read);
      read();
    }
    if (old.seatClass != widget.seatClass && !widget.locked) write();
  }

  void write() {
    writing = true;
    widget.controller.text =
        number.text.trim() +
        (number.text.trim().isNotEmpty &&
                widget.seatClass.contains('卧') &&
                berth.isNotEmpty
            ? '号$berth'
            : '');
    widget.onChanged();
    writing = false;
  }

  @override
  void dispose() {
    widget.controller.removeListener(read);
    number.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      ArchiveTextField(
        controller: number,
        readOnly: widget.locked,
        decoration: InputDecoration(
          label: Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: '座位 / 铺位'),
                if (widget.required)
                  TextSpan(
                    text: ' *',
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
              ],
            ),
          ),
        ),
        validator: (value) => widget.required && (value ?? '').trim().isEmpty
            ? '请填写座位或铺位编号'
            : null,
        onChanged: (_) {
          final match = RegExp(r'^(.*?)(?:号)?([上中下]铺)$')
              .firstMatch(number.text);
          if (match != null) {
            number.text = match[1]!;
            berth = match[2]!;
          }
          write();
          setState(() {});
        },
      ),
      if (widget.seatClass.contains('卧')) ...[
        const SizedBox(height: 12),
        ArchiveChoiceField<String>(
          label: '铺位',
          value: berth,
          choices: const {'': '未收录', '上铺': '上铺', '中铺': '中铺', '下铺': '下铺'},
          onChanged: widget.locked
              ? null
              : (value) {
                  setState(() => berth = value);
                  write();
                },
        ),
      ],
    ],
  );
}
