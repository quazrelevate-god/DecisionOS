import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// User-owned app preferences (Settings → Language + Appearance).
///
/// Live-only for now — dark theme still needs an app-wide color refactor
/// before the switch actually flips the palette; the choice is persisted
/// so we don't lose the user's intent once that lands.
class AppSettings extends ChangeNotifier {
  AppSettings._();
  static final AppSettings I = AppSettings._();

  static const _kLang = 'settings.language';
  static const _kTheme = 'settings.theme';

  String _language = 'en';
  ThemeMode _themeMode = ThemeMode.light;

  String get language => _language;
  ThemeMode get themeMode => _themeMode;

  /// Load persisted values on app start. Called from `main()` before
  /// `runApp` so the first frame paints with the user's saved choice.
  Future<void> load() async {
    final p = await SharedPreferences.getInstance();
    _language = p.getString(_kLang) ?? _language;
    final saved = p.getString(_kTheme);
    _themeMode = saved == 'dark'
        ? ThemeMode.dark
        : saved == 'system'
            ? ThemeMode.system
            : ThemeMode.light;
    notifyListeners();
  }

  Future<void> setLanguage(String code) async {
    if (code == _language) return;
    _language = code;
    notifyListeners();
    final p = await SharedPreferences.getInstance();
    await p.setString(_kLang, code);
  }

  Future<void> setThemeMode(ThemeMode m) async {
    if (m == _themeMode) return;
    _themeMode = m;
    notifyListeners();
    final p = await SharedPreferences.getInstance();
    await p.setString(
      _kTheme,
      m == ThemeMode.dark
          ? 'dark'
          : m == ThemeMode.system
              ? 'system'
              : 'light',
    );
  }
}
