import 'dart:async';

import 'package:cupertino_ui/cupertino_ui.dart'
    show CupertinoColors, CupertinoTextFormFieldRow;
import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'platform_services.dart';

double archiveInputHeight(BuildContext context) =>
    44 + (MediaQuery.textScalerOf(context).scale(17) - 17).clamp(0, 34);

Widget archiveInputLabel(BuildContext context, Widget label) =>
    DefaultTextStyle.merge(
      style: TextStyle(
        color: CupertinoColors.secondaryLabel.resolveFrom(context),
        fontSize: 13,
      ),
      child: label,
    );

class ArchiveTextField extends StatelessWidget {
  const ArchiveTextField({
    super.key,
    required this.controller,
    required this.decoration,
    this.focusNode,
    this.enabled = true,
    this.readOnly = false,
    this.native = false,
    this.obscureText = false,
    this.autocorrect = true,
    this.enableSuggestions = true,
    this.autofocus = false,
    this.minLines,
    this.maxLines = 1,
    this.keyboardType,
    this.inputFormatters,
    this.onChanged,
    this.onTap,
    this.validator,
  });

  final TextEditingController controller;
  final InputDecoration decoration;
  final FocusNode? focusNode;
  final bool enabled,
      readOnly,
      native,
      obscureText,
      autocorrect,
      enableSuggestions;
  final TextInputType? keyboardType;
  final bool autofocus;
  final int? minLines, maxLines;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String>? onChanged;
  final VoidCallback? onTap;
  final FormFieldValidator<String>? validator;

  @override
  Widget build(BuildContext context) {
    if (!AppleServices.available) {
      return TextFormField(
        controller: controller,
        focusNode: focusNode,
        decoration: decoration,
        enabled: enabled,
        readOnly: readOnly,
        obscureText: obscureText,
        autocorrect: autocorrect,
        enableSuggestions: enableSuggestions,
        autofocus: autofocus,
        minLines: minLines,
        maxLines: maxLines,
        keyboardType: keyboardType,
        inputFormatters: inputFormatters,
        onChanged: onChanged,
        onTap: onTap,
        validator: validator,
      );
    }
    final label = decoration.label ?? Text(decoration.labelText ?? '');
    final row = native
        ? FormField<String>(
            initialValue: controller.text,
            validator: validator == null
                ? null
                : (_) => validator!(controller.text),
            builder: (field) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _NativeTextField(
                  controller: controller,
                  label: decoration.labelText ?? '',
                  secret: obscureText,
                  numeric: keyboardType == TextInputType.number,
                  enabled: enabled,
                  onChanged: (value) {
                    field.didChange(value);
                    onChanged?.call(value);
                  },
                ),
                if (field.errorText case final error?)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      error,
                      style: TextStyle(
                        color: Theme.of(context).colorScheme.error,
                      ),
                    ),
                  ),
              ],
            ),
          )
        : CupertinoTextFormFieldRow(
            controller: controller,
            focusNode: focusNode,
            padding: EdgeInsets.zero,
            enabled: enabled,
            readOnly: readOnly,
            obscureText: obscureText,
            autocorrect: autocorrect,
            enableSuggestions: enableSuggestions,
            autofocus: autofocus,
            minLines: minLines,
            maxLines: maxLines,
            placeholder: decoration.hintText,
            keyboardType: keyboardType,
            inputFormatters: inputFormatters,
            onChanged: onChanged,
            onTap: onTap,
            validator: validator,
            style: TextStyle(
              color: CupertinoColors.label.resolveFrom(context),
              fontSize: 17,
            ),
          );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        archiveInputLabel(context, label),
        const SizedBox(height: 5),
        if (native)
          row
        else
          DecoratedBox(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 44),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
                child: Row(
                  children: [
                    Expanded(child: row),
                    if (decoration.suffixIcon case final icon?)
                      GestureDetector(
                        onTap: enabled ? onTap : null,
                        child: icon,
                      ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _NativeTextField extends StatefulWidget {
  const _NativeTextField({
    required this.controller,
    required this.label,
    required this.secret,
    required this.numeric,
    required this.enabled,
    required this.onChanged,
  });

  final TextEditingController controller;
  final String label;
  final bool secret, numeric, enabled;
  final ValueChanged<String> onChanged;

  @override
  State<_NativeTextField> createState() => _NativeTextFieldState();
}

class _NativeTextFieldState extends State<_NativeTextField> {
  static const viewType = 'dev.yuanzesun.xingji/text-field';
  MethodChannel? channel;

  Map<String, Object> get state => {
    'text': widget.controller.text,
    'label': widget.label,
    'secret': widget.secret,
    'numeric': widget.numeric,
    'enabled': widget.enabled,
  };

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_update);
  }

  @override
  void didUpdateWidget(_NativeTextField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_update);
      widget.controller.addListener(_update);
    }
    if (oldWidget.controller != widget.controller ||
        oldWidget.enabled != widget.enabled) {
      _update();
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_update);
    channel?.setMethodCallHandler(null);
    super.dispose();
  }

  void _update() => unawaited(_send());

  Future<void> _send() async {
    try {
      await channel?.invokeMethod<void>('update', state);
    } on MissingPluginException {
      // The platform view may be closing while the controller updates.
    }
  }

  void _attach(int id) {
    if (!mounted) return;
    channel = MethodChannel('$viewType/$id')
      ..setMethodCallHandler((call) async {
        if (mounted && call.method == 'change' && call.arguments is String) {
          final value = call.arguments as String;
          widget.controller.text = value;
          widget.onChanged(value);
        }
      });
    _update();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
    height: archiveInputHeight(context),
    child: UiKitView(
      viewType: viewType,
      onPlatformViewCreated: _attach,
      creationParams: state,
      creationParamsCodec: const StandardMessageCodec(),
    ),
  );
}
