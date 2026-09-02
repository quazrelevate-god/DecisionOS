import 'package:cookie_jar/cookie_jar.dart';
import 'package:dio/dio.dart';
import 'package:dio_cookie_manager/dio_cookie_manager.dart';

import '../config.dart';

/// One Dio instance for the whole app. Cookie-based session mirrors the web
/// client (`withCredentials: true`), so once /auth/login succeeds every
/// subsequent request carries the session cookie automatically.
///
/// Callers pass the raw path (`/tasks?mine=true`) — the client prepends the
/// `/api` base. Errors come back as `DioException` and are translated at the
/// repository layer, not here.
class ApiClient {
  ApiClient._();
  static final ApiClient _instance = ApiClient._();
  factory ApiClient() => _instance;

  late final Dio _dio = _build();
  late final CookieJar cookieJar = CookieJar();

  Dio get dio => _dio;

  Dio _build() {
    final d = Dio(BaseOptions(
      baseUrl: AppConfig.apiUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
      // Never throw on non-2xx; repositories decide what to do with errors.
      validateStatus: (s) => s != null && s < 500,
    ));
    d.interceptors.add(CookieManager(cookieJar));
    return d;
  }

  /// Wipes the cookie jar on logout so the next login starts clean.
  Future<void> clearSession() async {
    await cookieJar.deleteAll();
  }
}
