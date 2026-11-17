import 'package:flutter/services.dart';
import 'package:xingji_core/xingji_core.dart';

/// Native hosts implement this contract later; unavailable is a real capability.
class SystemRecognition implements RecognitionService {
  static const channel = MethodChannel('dev.yuanzesun.xingji/recognition');
  @override
  Future<bool> available() async {
    try {
      final value = await channel.invokeMapMethod<String, dynamic>(
        'capabilities',
      );
      return value?['ocr'] == true && value?['barcode'] == true;
    } on MissingPluginException {
      return false;
    }
  }

  @override
  Future<RecognitionResult> recognize(Uint8List image) async {
    final result = await channel.invokeMapMethod<String, dynamic>(
      'recognizeImage',
      {
        'bytes': image,
        'languages': ['zh-Hans', 'en'],
        'barcodes': true,
      },
    );
    if (result == null) throw const FormatException('没有收到识别结果');
    return RecognitionResult.fromJson(result);
  }
}
