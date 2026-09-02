/// Runtime config for the mobile app. Values are compiled in via
/// `--dart-define` so a single binary can point at dev, staging, or prod.
class AppConfig {
  /// Backend base URL WITHOUT the trailing `/api`.
  ///
  /// Default is `http://10.0.2.2:8000` — the Android emulator's alias for
  /// `localhost` on the host machine. On iOS simulator use `http://localhost:8000`.
  /// Override for staging/prod at build time:
  /// `flutter run --dart-define=API_BASE_URL=https://api.decisionos.app`
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );

  static String get apiUrl => '$apiBaseUrl/api';
}
