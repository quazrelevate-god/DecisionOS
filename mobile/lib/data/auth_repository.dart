import 'package:flutter/foundation.dart';

import '../models/models.dart';
import 'api_client.dart';

enum AuthStatus { unknown, unauthenticated, authenticating, authenticated }

/// Cookie-based auth. Login/register set a session cookie the api_client
/// automatically carries; logout wipes it. `refresh()` runs on startup to see
/// if a previously-saved cookie still hands back a user.
class AuthRepository extends ChangeNotifier {
  AuthRepository._();
  static final AuthRepository I = AuthRepository._();

  final _api = ApiClient();

  AuthStatus _status = AuthStatus.unknown;
  User? _user;
  List<Pipeline> _pipelines = const [];
  List<TenantRole> _roles = const [];
  String? _lastError;

  AuthStatus get status => _status;
  User? get user => _user;
  String? get lastError => _lastError;

  /// Tenant-configured workflow pipelines. Falls back to defaults if the
  /// backend hasn't backfilled the tenant yet or the call is racing.
  List<Pipeline> get pipelines => _pipelines.isEmpty ? Pipeline.defaults : _pipelines;

  /// Tenant-configured roles used for grouping the Team screen ("Sales",
  /// "Ops", …). Owner is implicit and rendered before this list.
  List<TenantRole> get roles => _roles;

  Future<void> refresh() async {
    try {
      final r = await _api.dio.get('/auth/me');
      if (r.statusCode == 200 && r.data is Map<String, dynamic>) {
        final body = r.data as Map<String, dynamic>;
        // /auth/me returns `{user, tenant}`; older shapes returned user
        // directly. Support both.
        final userJson = body['user'] is Map<String, dynamic>
            ? body['user'] as Map<String, dynamic>
            : body;
        _user = User.fromJson(userJson);
        final tenant = body['tenant'] as Map<String, dynamic>?;
        final om = tenant?['operating_model'] as Map<String, dynamic>?;
        final rawPipes = (om?['pipelines'] as List?) ?? const [];
        _pipelines = rawPipes
            .whereType<Map<String, dynamic>>()
            .map(Pipeline.fromJson)
            .where((p) => p.key.isNotEmpty)
            .toList();
        final rawRoles = (tenant?['roles'] as List?) ?? const [];
        _roles = rawRoles
            .whereType<Map<String, dynamic>>()
            .map(TenantRole.fromJson)
            .where((r) => r.key.isNotEmpty)
            .toList();
        _status = AuthStatus.authenticated;
      } else {
        _status = AuthStatus.unauthenticated;
        _user = null;
        _pipelines = const [];
        _roles = const [];
      }
    } catch (_) {
      _status = AuthStatus.unauthenticated;
      _user = null;
      _pipelines = const [];
      _roles = const [];
    }
    notifyListeners();
  }

  Future<bool> login(String email, String password) async {
    _status = AuthStatus.authenticating;
    _lastError = null;
    notifyListeners();
    try {
      final r = await _api.dio.post('/auth/login', data: {
        'email': email,
        'password': password,
      });
      if (r.statusCode == 200) {
        await refresh();
        return _status == AuthStatus.authenticated;
      }
      _lastError = _parseError(r.data) ?? 'Invalid email or password.';
    } catch (e) {
      _lastError = 'Could not reach the server. Check your connection.';
    }
    _status = AuthStatus.unauthenticated;
    notifyListeners();
    return false;
  }

  Future<bool> register(Map<String, dynamic> payload) async {
    _status = AuthStatus.authenticating;
    _lastError = null;
    notifyListeners();
    try {
      final r = await _api.dio.post('/auth/register', data: payload);
      if (r.statusCode == 200 || r.statusCode == 201) {
        await refresh();
        return _status == AuthStatus.authenticated;
      }
      _lastError = _parseError(r.data) ?? 'Could not create your account.';
    } catch (_) {
      _lastError = 'Could not reach the server. Check your connection.';
    }
    _status = AuthStatus.unauthenticated;
    notifyListeners();
    return false;
  }

  Future<void> logout() async {
    try {
      await _api.dio.post('/auth/logout');
    } catch (_) {/* ignore — clear locally anyway */}
    await _api.clearSession();
    _user = null;
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }

  String? _parseError(dynamic body) {
    if (body is Map && body['detail'] is String) return body['detail'] as String;
    if (body is Map && body['message'] is String) return body['message'] as String;
    return null;
  }
}
