import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:xingji_core/xingji_core.dart';

/// Each host reports the recognition features it implements.
class SystemRecognition implements RecognitionService {
  static const channel = MethodChannel('dev.yuanzesun.xingji/recognition');
  Future<bool> supports(String capability) async {
    try {
      final value = await channel.invokeMapMethod<String, dynamic>(
        'capabilities',
      );
      return value?[capability] == true;
    } on MissingPluginException {
      return false;
    }
  }

  Future<Map<String, dynamic>?> extractTicketImage(
    Uint8List bytes,
    String text, {
    bool? flight,
  }) => channel.invokeMapMethod<String, dynamic>('extractTicketImage', {
    'bytes': bytes,
    'text': text,
    'flight': flight,
  });

  Future<Map<String, dynamic>?> extractTicketText(String text) => channel
      .invokeMapMethod<String, dynamic>('extractTicketText', {'text': text});

  Future<List<RecognitionResult>> recognizePdf(Uint8List bytes) async {
    final pages = await channel.invokeListMethod<Map<Object?, Object?>>(
      'recognizePDF',
      {'bytes': bytes},
    );
    return [
      for (final page in pages ?? const [])
        RecognitionResult.fromJson(Map<String, dynamic>.from(page)),
    ];
  }

  Future<
    ({
      Uint8List? image,
      RecognitionResult reading,
      bool retryWithDocumentCamera,
    })?
  >
  scanLiveBoarding() async {
    final result = await channel.invokeMapMethod<String, dynamic>(
      'scanLiveBoarding',
    );
    if (result == null) return null;
    return (
      image: result['image'] as Uint8List?,
      reading: RecognitionResult.fromJson(result),
      retryWithDocumentCamera: result['retryWithDocumentCamera'] == true,
    );
  }

  @override
  Future<bool> available() async {
    try {
      final value = await channel.invokeMapMethod<String, dynamic>(
        'capabilities',
      );
      return value?['ocr'] == true || value?['barcode'] == true;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<RecognitionResult> recognize(
    Uint8List image, {
    bool flight = false,
  }) async {
    final result = await channel.invokeMapMethod<String, dynamic>(
      'recognizeImage',
      {
        'bytes': image,
        'languages': ['zh-Hans', 'en'],
        'barcodes': true,
        'flight': flight,
      },
    );
    if (result == null) throw const FormatException('没有收到识别结果');
    return RecognitionResult.fromJson(result);
  }
}

class TicketImportFile {
  final String id, name, kind;
  const TicketImportFile(this.id, this.name, this.kind);
  factory TicketImportFile.fromJson(Map entry) => TicketImportFile(
    entry['id'] as String,
    entry['name'] as String,
    entry['kind'] as String,
  );
}

/// iOS owns the system UI and stores secrets without exposing them to preferences.
abstract final class AppleServices {
  static const channel = MethodChannel('dev.yuanzesun.xingji/apple');

  static bool get available =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.iOS;

  static Future<String?> credential(String key) =>
      channel.invokeMethod<String>('readCredential', {'key': key});

  static Future<void> writeCredential(String key, String value) => channel
      .invokeMethod<void>('writeCredential', {'key': key, 'value': value});

  static Future<void> deleteCredential(String key) =>
      channel.invokeMethod<void>('deleteCredential', {'key': key});

  static Future<String?> chooseUploadSource() =>
      channel.invokeMethod<String>('chooseUploadSource');

  static Future<bool> directShareAvailable() async =>
      await channel.invokeMethod<bool>('directShareAvailable') ?? false;

  static Future<List<TicketImportFile>> sharedTicketFiles() async {
    final files = await channel.invokeListMethod<Map<Object?, Object?>>(
      'sharedTicketFiles',
    );
    return [
      for (final file in files ?? const []) TicketImportFile.fromJson(file),
    ];
  }

  static Future<Uint8List> sharedTicketData(String id) async {
    final bytes = await channel.invokeMethod<Uint8List>('sharedTicketData', {
      'id': id,
    });
    if (bytes == null) throw const FormatException('待导入文件已移除');
    return bytes;
  }

  static Future<void> removeSharedTicket(String id) =>
      channel.invokeMethod<void>('removeSharedTicket', {'id': id});

  static Future<Uint8List?> pickPhoto() =>
      channel.invokeMethod<Uint8List>('pickPhoto');

  static Future<bool> openGitHubSetup(String url) async =>
      await channel.invokeMethod<bool>('openGitHubSetup', {'url': url}) ??
      false;

  static Future<Map<String, dynamic>?> pasteTicket() =>
      channel.invokeMapMethod<String, dynamic>('pasteTicket');

  static Future<Uint8List?> scanDocument() =>
      channel.invokeMethod<Uint8List>('scanDocument');

  static Future<(int, int)?> pickMonthDay(DateTime initial) async {
    final result = await channel.invokeListMethod<int>('pickMonthDay', {
      'year': initial.year,
      'month': initial.month,
      'day': initial.day,
    });
    return result == null ? null : (result[0], result[1]);
  }

  static Future<TimeParts?> pickTime(int hour, int minute) async {
    final result = await channel.invokeListMethod<int>('pickTime', {
      'hour': hour,
      'minute': minute,
    });
    return result == null ? null : (hour: result[0], minute: result[1]);
  }

  static Future<DateTime?> pickDate(
    DateTime initial,
    DateTime first,
    DateTime last,
  ) async {
    List<int> parts(DateTime date) => [date.year, date.month, date.day];
    final values = await channel.invokeListMethod<int>('pickDate', {
      'initial': parts(initial),
      'first': parts(first),
      'last': parts(last),
    });
    return values == null ? null : DateTime(values[0], values[1], values[2]);
  }

  static Future<void> shareFile(String name, Uint8List bytes) =>
      channel.invokeMethod<void>('shareFile', {'name': name, 'bytes': bytes});

  static Future<List<({String id, String text, DateTime receivedAt})>>
  travelMessages() async {
    final rows = await channel.invokeListMethod<Map<Object?, Object?>>(
      'travelMessages',
    );
    return [
      for (final row in rows ?? const [])
        (
          id: row['id'] as String,
          text: row['text'] as String,
          receivedAt: DateTime.fromMillisecondsSinceEpoch(
            ((row['receivedAt'] as num) * 1000).round(),
            isUtc: true,
          ),
        ),
    ];
  }

  static Future<void> acknowledgeTravelMessage(String id) =>
      channel.invokeMethod<void>('acknowledgeTravelMessage', {'id': id});
}

typedef TimeParts = ({int hour, int minute});
