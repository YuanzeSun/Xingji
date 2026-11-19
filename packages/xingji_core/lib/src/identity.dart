bool hasMaskedIdentity(String value) => RegExp(r'[*＊﹡]').hasMatch(value);

void requireCompleteIdentity(String value) {
  if (hasMaskedIdentity(value)) {
    throw const FormatException('请填写完整证件号，证件号不能包含星号。');
  }
}

String maskRailIdentity(String value, {bool isNationalId = true}) {
  if (hasMaskedIdentity(value)) return '';
  final number = String.fromCharCodes(
    value.runes.map(
      (rune) => rune >= 0xff01 && rune <= 0xff5e ? rune - 0xfee0 : rune,
    ),
  ).replaceAll(RegExp(r'[\s　]'), '');
  if (isNationalId && RegExp(r'^\d{17}[\dXx]$').hasMatch(number)) {
    return '${number.substring(0, 10)}****${number.substring(14).toUpperCase()}';
  }
  final codePoints = number.runes.toList();
  final visible = (codePoints.length - (codePoints.length <= 11 ? 2 : 4)).clamp(
    0,
    codePoints.length,
  );
  return String.fromCharCodes(codePoints.take(visible)) +
      '*' * (codePoints.length - visible);
}
