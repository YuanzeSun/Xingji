import 'dart:convert';

Map<String, dynamic> normalizeCodeData(Map value) {
  const formats = {
    'QRCode',
    'MicroQRCode',
    'PDF417',
    'Aztec',
    'DataMatrix',
    'Code128',
  };
  final raw = value['rawBytes'];
  if (value['version'] != 1 ||
      !formats.contains(value['format']) ||
      raw is! String ||
      raw.length > 10924) {
    throw const FormatException('条码数据无效');
  }
  final bytes = base64Decode(raw);
  if (bytes.isEmpty ||
      bytes.length > 8192 ||
      value['format'] == 'Code128' && bytes.length > 500 ||
      base64Encode(bytes) != raw) {
    throw const FormatException('条码原始字节无效');
  }
  if (value['symbologyIdentifier'] is! String ||
      !RegExp(r'^\][A-Za-z][A-Za-z0-9]$')
          .hasMatch(value['symbologyIdentifier']) ||
      value['gs1'] is! bool ||
      value['eci'] is! List ||
      (value['eci'] as List).length > 128 ||
      value['parameters'] is! Map) {
    throw const FormatException('条码编码参数不完整');
  }
  var previous = -1;
  final eci = <Map<String, int>>[];
  for (final part in value['eci']) {
    if (part is! Map ||
        part['offset'] is! int ||
        part['value'] is! int ||
        part['offset'] <= previous ||
        part['offset'] < 0 ||
        part['offset'] >= bytes.length ||
        part['value'] < 0 ||
        part['value'] > 999999) {
      throw const FormatException('条码字符编码参数无效');
    }
    previous = part['offset'];
    eci.add({'offset': part['offset'], 'value': part['value']});
  }
  final parameters = value['parameters'] as Map,
      version = parameters['symbolVersion'] ?? '',
      level = parameters['errorCorrectionLevel'] ?? '',
      mask = parameters['mask'];
  if (version is! String ||
      !RegExp(r'^[A-Za-z0-9x]{0,12}$').hasMatch(version) ||
      level is! String ||
      !RegExp(r'^[A-Za-z0-9%.]{0,12}$').hasMatch(level) ||
      mask != null && (mask is! int || mask < 0 || mask > 7) ||
      value['format'] == 'QRCode' &&
          (version.isNotEmpty &&
                  !RegExp(r'^(?:[1-9]|[1-3][0-9]|40)$').hasMatch(version) ||
              level.isNotEmpty && !RegExp(r'^[LMQH]$').hasMatch(level)) ||
      value['format'] == 'MicroQRCode' &&
          (version.isNotEmpty && !RegExp(r'^M[1-4]$').hasMatch(version) ||
              mask != null && mask > 3)) {
    throw const FormatException('条码生成参数无效');
  }
  return {
    'version': 1,
    'format': value['format'],
    'rawBytes': raw,
    'symbologyIdentifier': value['symbologyIdentifier'],
    'gs1': value['gs1'],
    'eci': eci,
    'parameters': {
      'symbolVersion': version,
      'errorCorrectionLevel': level,
      'mask': mask,
    },
  };
}
