import 'dart:async';

import 'package:flutter/foundation.dart' show mapEquals;
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'archive_text_field.dart';
import 'platform_services.dart';

class ArchiveChoiceField<T> extends StatefulWidget {
  const ArchiveChoiceField({
    super.key,
    required this.label,
    required this.value,
    required this.choices,
    required this.onChanged,
  });

  final String label;
  final T? value;
  final Map<T, String> choices;
  final ValueChanged<T>? onChanged;

  @override
  State<ArchiveChoiceField<T>> createState() => _ArchiveChoiceFieldState<T>();
}

class _ArchiveChoiceFieldState<T> extends State<ArchiveChoiceField<T>> {
  static const viewType = 'dev.yuanzesun.xingji/choice-menu';
  MethodChannel? channel;

  Map<String, Object> get _state => {
    'label': widget.label,
    'choices': widget.choices.values.toList(),
    'selected': widget.choices.keys.toList().indexWhere(
      (key) => key == widget.value,
    ),
    'enabled': widget.onChanged != null,
  };

  void _attach(int id) {
    if (!mounted) return;
    channel = MethodChannel('$viewType/$id')
      ..setMethodCallHandler((call) async {
        final index = call.arguments;
        if (mounted &&
            call.method == 'select' &&
            index is int &&
            index >= 0 &&
            index < widget.choices.length) {
          widget.onChanged?.call(widget.choices.keys.elementAt(index));
        }
      });
    unawaited(_update());
  }

  Future<void> _update() async {
    try {
      await channel?.invokeMethod<void>('update', _state);
    } on MissingPluginException {
      // The view can be removed while a route is closing.
    }
  }

  @override
  void didUpdateWidget(ArchiveChoiceField<T> oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value ||
        oldWidget.label != widget.label ||
        !mapEquals(oldWidget.choices, widget.choices) ||
        (oldWidget.onChanged == null) != (widget.onChanged == null)) {
      unawaited(_update());
    }
  }

  @override
  void dispose() {
    channel?.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!AppleServices.available) {
      return DropdownButtonFormField<T>(
        key: ValueKey(widget.value),
        initialValue: widget.choices.containsKey(widget.value)
            ? widget.value
            : null,
        isExpanded: true,
        decoration: InputDecoration(labelText: widget.label),
        items: [
          for (final entry in widget.choices.entries)
            DropdownMenuItem(
              value: entry.key,
              child: Text(entry.value, overflow: TextOverflow.ellipsis),
            ),
        ],
        onChanged: widget.onChanged == null
            ? null
            : (value) {
                if (value != null) widget.onChanged!(value);
              },
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        archiveInputLabel(context, Text(widget.label)),
        const SizedBox(height: 5),
        SizedBox(
          height: archiveInputHeight(context),
          child: UiKitView(
            viewType: viewType,
            creationParams: _state,
            creationParamsCodec: const StandardMessageCodec(),
            onPlatformViewCreated: _attach,
          ),
        ),
      ],
    );
  }
}
