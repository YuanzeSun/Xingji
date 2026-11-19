import 'package:flutter/services.dart';
import 'package:xingji_core/xingji_core.dart';

class CompleteIdentityInput extends TextInputFormatter {
  const CompleteIdentityInput();

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) => hasMaskedIdentity(newValue.text) ? oldValue : newValue;
}

class UppercaseInput extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    // Do not interrupt a Chinese or predictive keyboard while it is composing.
    if (newValue.composing.isValid && !newValue.composing.isCollapsed) {
      return newValue;
    }
    int offset(int at) => newValue.text
        .substring(0, at.clamp(0, newValue.text.length))
        .toUpperCase()
        .length;
    return newValue.copyWith(
      text: newValue.text.toUpperCase(),
      composing: TextRange.empty,
      selection: newValue.selection.isValid
          ? TextSelection(
              baseOffset: offset(newValue.selection.baseOffset),
              extentOffset: offset(newValue.selection.extentOffset),
            )
          : newValue.selection,
    );
  }
}
