import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:xingji_core/xingji_core.dart';

import 'app_store.dart';
import 'archive_text_field.dart';
import 'design.dart';
import 'import_review.dart';
import 'platform_services.dart';

Future<void> openVariFlightImport(BuildContext context, AppStore store) async {
  const account = 'variflight:mcp';
  final savedKey = await AppleServices.credential(account);
  if (!context.mounted) return;
  final sharedKey = store.settings['flightMcpKey'] as String? ?? '';
  final key = TextEditingController();
  final year = TextEditingController(text: '${DateTime.now().year}');
  var mask = true;
  final request = await showDialog<({String key, int? year, bool save})>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, update) {
        final hasKey = savedKey != null || sharedKey.isNotEmpty;
        void submit({required bool history}) {
          final entered = key.text.trim();
          final secret = entered.isEmpty ? savedKey ?? sharedKey : entered;
          final selectedYear = int.tryParse(year.text.trim());
          if (secret.isEmpty ||
              secret.length > 8192 ||
              RegExp(r'[\s\x00-\x1f\x7f]').hasMatch(secret)) {
            showError(context, '请填写有效的飞常准 MCP Key');
            return;
          }
          if (history &&
              (selectedYear == null ||
                  selectedYear < 1900 ||
                  selectedYear > DateTime.now().year)) {
            showError(context, '请填写有效年份');
            return;
          }
          Navigator.pop(context, (
            key: secret,
            year: history ? selectedYear : null,
            save: entered.isNotEmpty,
          ));
        }

        return AlertDialog(
          title: const Text('飞常准行程'),
          content: SizedBox(
            width: 480,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('使用飞常准 MCP Key 查询已授权的本人行程，核对后导入票库。'),
                  const SizedBox(height: 12),
                  ArchiveTextField(
                    controller: key,
                    obscureText: mask,
                    autocorrect: false,
                    enableSuggestions: false,
                    decoration: InputDecoration(
                      labelText: '飞常准 MCP Key',
                      hintText: savedKey != null
                          ? '已保存在本机钥匙串'
                          : hasKey
                          ? '可使用票库中的 Key'
                          : '粘贴个人 MCP Key',
                      suffixIcon: IconButton(
                        tooltip: mask ? '显示 Key' : '隐藏 Key',
                        onPressed: () => update(() => mask = !mask),
                        icon: Icon(
                          mask
                              ? Icons.visibility_outlined
                              : Icons.visibility_off_outlined,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  ArchiveTextField(
                    controller: year,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(labelText: '历史行程年份'),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('取消'),
            ),
            TextButton(
              onPressed: () => submit(history: false),
              child: const Text('查询未来行程'),
            ),
            FilledButton(
              onPressed: () => submit(history: true),
              child: const Text('查询历史行程'),
            ),
          ],
        );
      },
    ),
  );
  key.dispose();
  year.dispose();
  if (request == null || !context.mounted) return;
  final client = VariFlight(request.key);
  try {
    final payload = await client.trips(year: request.year);
    if (request.save) {
      try {
        await AppleServices.writeCredential(account, request.key);
      } catch (_) {
        if (context.mounted) showError(context, '查询已成功，但钥匙串未能保留 Key。');
      }
    }
    if (!context.mounted) return;
    final parsed = parseVariFlightTrips(payload, store.catalog);
    if (parsed.records.isNotEmpty) {
      if (!store.canWrite) {
        showError(context, store.readOnlyReason ?? '票库暂时不可写');
      } else {
        await reviewImport(context, store, parsed.records);
      }
    }
    if (!context.mounted) return;
    if (parsed.complete) {
      if (parsed.records.isEmpty) showError(context, '飞常准未返回该范围内的行程');
      return;
    }
    final raw =
        (payload is String
                ? payload
                : const JsonEncoder.withIndent('  ').convert(payload))
            .replaceAll(request.key, '[已隐藏]');
    final import = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('核对飞常准返回'),
        content: SizedBox(
          width: 540,
          child: SingleChildScrollView(
            child: SelectableText(
              '部分内容未能识别为票据，可核对后选择复制或作为文字导入。\n\n'
              '${raw.length > 12000 ? '${raw.substring(0, 12000)}\n…' : raw}',
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('关闭'),
          ),
          if (store.canWrite)
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('打开文字导入'),
            ),
        ],
      ),
    );
    if (import == true && context.mounted) {
      await importTextDialog(
        context,
        store,
        initialText: raw.length > 12000 ? '' : raw,
      );
    }
  } finally {
    client.close();
  }
}
