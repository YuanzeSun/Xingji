import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';

import 'ticket_entry.dart';

class AppleNavigationBar extends StatefulWidget {
  const AppleNavigationBar({
    super.key,
    required this.selected,
    required this.demo,
    required this.canWrite,
    required this.interactive,
    required this.onSelect,
    required this.onAdd,
  });

  final int selected;
  final bool demo;
  final bool canWrite;
  final bool interactive;
  final ValueChanged<int> onSelect;
  final ValueChanged<TicketEntry> onAdd;

  @override
  State<AppleNavigationBar> createState() => _AppleNavigationBarState();
}

class _AppleNavigationBarState extends State<AppleNavigationBar> {
  static const viewType = 'dev.yuanzesun.xingji/ios-navigation';
  MethodChannel? _channel;

  Map<String, Object> get _state => {
    'selected': widget.selected,
    'demo': widget.demo,
    'canWrite': widget.canWrite,
  };

  void _attach(int identifier) {
    if (!mounted) return;
    _channel = MethodChannel('$viewType/$identifier')
      ..setMethodCallHandler((call) async {
        if (!mounted || !widget.interactive) return;
        if (call.method == 'select' && call.arguments is int) {
          final index = call.arguments as int;
          if (index >= 0 && index < (widget.demo ? 3 : 4)) {
            widget.onSelect(index);
          }
        } else if (call.method == 'add' && !widget.demo && widget.canWrite) {
          for (final entry in TicketEntry.values) {
            if (entry.name == call.arguments) widget.onAdd(entry);
          }
        }
      });
    unawaited(_sendState());
  }

  Future<void> _sendState() async {
    try {
      await _channel?.invokeMethod<void>('update', _state);
    } on MissingPluginException {
      // The view can be removed by the engine during scene teardown.
    }
  }

  @override
  void didUpdateWidget(AppleNavigationBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected != widget.selected ||
        oldWidget.demo != widget.demo ||
        oldWidget.canWrite != widget.canWrite) {
      unawaited(_sendState());
    }
  }

  @override
  void dispose() {
    _channel?.setMethodCallHandler(null);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final extra = math.max(
      0.0,
      MediaQuery.textScalerOf(context).scale(11) - 11,
    );
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
        child: Center(
          heightFactor: 1,
          child: SizedBox(
            width: math.min(screen.width - 24, widget.demo ? 320 : 440),
            // iOS floats the glass capsule above the tab bar's layout bounds.
            // Include that area so Flutter's modal barrier covers the whole bar.
            height: 92 + extra,
            child: IgnorePointer(
              ignoring: !widget.interactive,
              child: UiKitView(
                viewType: viewType,
                onPlatformViewCreated: _attach,
                creationParams: _state,
                creationParamsCodec: const StandardMessageCodec(),
                layoutDirection: Directionality.of(context),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
