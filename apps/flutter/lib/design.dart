import 'package:material_ui/material_ui.dart';

const ink = Color(0xFF243C65);
const paper = Color(0xFFF5F6FA);
const mist = Color(0xFFE6ECF5);
const muted = Color(0xFF657187);
const ticketRed = Color(0xFFBF5862);
ThemeData archiveTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: ink,
    surface: paper,
    primary: ink,
    error: const Color(0xFFA22E3A),
  );
  return ThemeData(
    colorScheme: scheme,
    scaffoldBackgroundColor: paper,
    fontFamily: 'UiSans',
    textTheme: const TextTheme(
      headlineLarge: TextStyle(
        fontSize: 34,
        height: 1.2,
        fontWeight: FontWeight.w700,
        color: ink,
      ),
      headlineMedium: TextStyle(
        fontSize: 28,
        height: 1.3,
        fontWeight: FontWeight.w700,
        color: ink,
      ),
      titleLarge: TextStyle(
        fontSize: 21,
        height: 1.4,
        fontWeight: FontWeight.w600,
      ),
      bodyLarge: TextStyle(fontSize: 16, height: 1.5),
      bodyMedium: TextStyle(fontSize: 14, height: 1.5),
      bodySmall: TextStyle(fontSize: 13, height: 1.4, color: muted),
    ),
    inputDecorationTheme: InputDecorationTheme(
      floatingLabelBehavior: FloatingLabelBehavior.always,
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFB9C8C4)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0xFFB9C8C4)),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(48, 48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(minimumSize: const Size(48, 48)),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: paper,
      foregroundColor: ink,
      scrolledUnderElevation: 0,
    ),
    navigationBarTheme: const NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: mist,
      elevation: 0,
      height: 72,
    ),
    dividerTheme: const DividerThemeData(color: Color(0xFFD5DFDB), space: 32),
  );
}

class SectionTitle extends StatelessWidget {
  final String title;
  final Widget? trailing;
  const SectionTitle(this.title, {this.trailing, super.key});
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 24, bottom: 16),
    child: Row(
      children: [
        Expanded(
          child: Text(title, style: Theme.of(context).textTheme.titleLarge),
        ),
        ?trailing,
      ],
    ),
  );
}

void showError(BuildContext context, Object error) =>
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          error
              .toString()
              .replaceFirst('FormatException: ', '')
              .replaceFirst('Bad state: ', ''),
        ),
        duration: const Duration(seconds: 6),
        showCloseIcon: true,
      ),
    );
