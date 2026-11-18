import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:file_selector/file_selector.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:xingji_core/xingji_core.dart';

import 'platform_services.dart';
import 'ticket_face.dart';

Future<void> saveFile(String name, Uint8List data, String mime) async {
  if (AppleServices.available) {
    await AppleServices.shareFile(name, data);
    return;
  }
  final file = XFile.fromData(data, name: name, mimeType: mime);
  if (kIsWeb) {
    await file.saveTo(name);
    return;
  }
  if (defaultTargetPlatform == TargetPlatform.android) {
    throw UnsupportedError('此平台的系统文件导出尚未接入');
  }
  final location = await getSaveLocation(suggestedName: name);
  if (location != null) await file.saveTo(location.path);
}

Future<Uint8List> travelBook(
  List<TicketRecord> records,
  ReferenceCatalog catalog,
) async {
  final font = pw.Font.ttf(
    await rootBundle.load('assets/fonts/ticket-hei.ttf'),
  );
  final document = pw.Document(
    theme: pw.ThemeData.withFont(base: font, bold: font),
  );
  final teal = PdfColor.fromHex('#153D42');
  final ordered = [...records]
    ..sort(
      (a, b) => (a.departure?.calendarText ?? '').compareTo(
        b.departure?.calendarText ?? '',
      ),
    );
  document.addPage(
    pw.Page(
      pageFormat: PdfPageFormat.a4,
      build: (context) => pw.Column(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.Spacer(),
          pw.Text('行迹', style: pw.TextStyle(fontSize: 64, color: teal)),
          pw.SizedBox(height: 24),
          pw.Text('旅行手册', style: pw.TextStyle(fontSize: 26, color: teal)),
          pw.SizedBox(height: 12),
          pw.Text('${ordered.length} 张票据'),
          pw.Spacer(),
          pw.Divider(color: teal),
          pw.Text('by @YuanzeSun', style: const pw.TextStyle(fontSize: 9)),
        ],
      ),
    ),
  );
  for (var offset = 0; offset < ordered.length; offset += 2) {
    final batch = ordered.skip(offset).take(2).toList();
    final images = await Future.wait(
      batch.map((record) => ticketPng(record, catalog)),
    );
    document.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        margin: const pw.EdgeInsets.all(36),
        build: (context) => pw.Column(
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Text(
              '行迹 / 旅行手册',
              style: pw.TextStyle(fontSize: 12, color: teal),
            ),
            pw.SizedBox(height: 24),
            for (final (index, record) in batch.indexed) ...[
              pw.Text(
                record.departure?.label ?? '日期未知',
                style: const pw.TextStyle(fontSize: 11),
              ),
              pw.SizedBox(height: 8),
              pw.Image(
                pw.MemoryImage(images[index]),
                height: 230,
                fit: pw.BoxFit.contain,
              ),
              pw.SizedBox(height: 12),
              pw.Text(
                '${record.text('origin')} → ${record.text('destination')}   ${record.text('service')}',
                style: pw.TextStyle(fontSize: 13, color: teal),
              ),
              pw.SizedBox(height: 24),
            ],
            pw.Spacer(),
            pw.Divider(),
            pw.Row(
              mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
              children: [
                pw.Text(
                  'by @YuanzeSun',
                  style: const pw.TextStyle(fontSize: 9),
                ),
                pw.Text(
                  '${context.pageNumber}',
                  style: const pw.TextStyle(fontSize: 9),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
  return document.save();
}
