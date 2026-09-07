import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import '../models/models.dart';
import 'api_client.dart';

/// One tiny repo per feature. Every method returns typed models or throws a
/// human-readable message. Repositories NEVER catch and swallow — a screen's
/// FutureBuilder decides whether to show error/empty/data.

class DeskRepository {
  final _api = ApiClient();

  /// `GET /api/desk?chip=<key>` — returns the envelope with counters + cards.
  Future<DeskChipData> chip(String chipKey) async {
    final r = await _api.dio.get('/desk', queryParameters: {'chip': chipKey});
    _ensureOk(r);
    if (r.data is! Map<String, dynamic>) {
      return DeskChipData(chip: chipKey, counters: const {}, cards: const []);
    }
    return DeskChipData.fromJson(r.data as Map<String, dynamic>);
  }

  Future<DeskSummary> summary() async {
    final r = await _api.dio.get('/desk/summary');
    _ensureOk(r);
    return DeskSummary.fromJson(r.data as Map<String, dynamic>);
  }

  Future<void> nudge(String decisionId) async {
    final r = await _api.dio.post('/desk/nudge/$decisionId');
    _ensureOk(r);
  }
}

class OpsRepository {
  final _api = ApiClient();
  Future<OperatingScore> score() async {
    final r = await _api.dio.get('/operating-score');
    _ensureOk(r);
    return OperatingScore.fromJson(r.data as Map<String, dynamic>);
  }
}

class LedgerRepository {
  final _api = ApiClient();
  Future<LedgerSummary> summary() async {
    final r = await _api.dio.get('/ledger/summary');
    _ensureOk(r);
    return LedgerSummary.fromJson(r.data as Map<String, dynamic>);
  }
}

class TasksRepository {
  final _api = ApiClient();

  Future<List<Task>> list({bool mine = true}) async {
    final r = await _api.dio.get('/tasks', queryParameters: {'mine': mine});
    _ensureOk(r);
    final list = (r.data as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(Task.fromJson).toList();
  }

  Future<Task> get(String id) async {
    final r = await _api.dio.get('/tasks/$id');
    _ensureOk(r);
    return Task.fromJson(r.data as Map<String, dynamic>);
  }

  Future<void> approve(String id) async {
    final r = await _api.dio.post('/tasks/$id/approve');
    _ensureOk(r);
  }

  Future<void> addUpdate(String id, String text) async {
    final r = await _api.dio.post('/tasks/$id/updates', data: {'text': text});
    _ensureOk(r);
  }

  /// POST /tasks/{id}/updates — full frontend shape. `action` is
  /// `note` (default), `handoff`, or `escalate`. Handoff/escalate carry
  /// either `to_id` (a user) or `to_role` (a team key).
  Future<void> postUpdate(
    String id, {
    required String text,
    String action = 'note',
    String? toId,
    String? toRole,
    String? stepId,
  }) async {
    final r = await _api.dio.post('/tasks/$id/updates', data: {
      'text': text,
      'action': action,
      if (toId != null && toId.isNotEmpty) 'to_id': toId,
      if (toRole != null && toRole.isNotEmpty) 'to_role': toRole,
      if (stepId != null && stepId.isNotEmpty) 'step_id': stepId,
    });
    _ensureOk(r);
  }

  /// Reorders the list by AI priority score. Backend returns
  /// `{tasks: [...], scored: N}` — we unwrap the `tasks` key. The
  /// previous cast-to-List treated the whole Map as a list and threw
  /// a TypeError, which surfaced as the Work screen's "Could not load
  /// your tasks" error every time AI priority was tapped.
  Future<List<Task>> prioritize() async {
    final r = await _api.dio.post('/tasks/prioritize');
    _ensureOk(r);
    final data = r.data;
    final list = (data is Map ? data['tasks'] : data) as List? ?? const [];
    return list.whereType<Map<String, dynamic>>().map(Task.fromJson).toList();
  }

  /// PATCH /tasks/{id} — status changes and lightweight field edits.
  /// Frontend calls this for Complete (`{status: "done"}`),
  /// Cancel (`{status: "cancelled"}`), and status-track pill taps
  /// (`{status: "todo"|"in_progress"|"waiting"|"review"}`).
  Future<void> patch(String id, Map<String, dynamic> body) async {
    final r = await _api.dio.patch('/tasks/$id', data: body);
    _ensureOk(r);
  }

  /// POST /tasks — create a new task from the mobile "+" circle.
  Future<Task> create(Map<String, dynamic> body) async {
    final r = await _api.dio.post('/tasks', data: body);
    _ensureOk(r);
    return Task.fromJson(r.data as Map<String, dynamic>);
  }

  /// DELETE /tasks/{id}.
  Future<void> delete(String id) async {
    final r = await _api.dio.delete('/tasks/$id');
    _ensureOk(r);
  }

  /// Escalations and handoffs on the frontend both hit the same `/updates`
  /// endpoint with an `action` field, not dedicated sub-routes. The mobile
  /// escalate/handoff pill uses this convention so the backend records
  /// the same event log.
  Future<void> escalate(String id, {String reason = ''}) async {
    final r = await _api.dio.post('/tasks/$id/updates', data: {
      'text': reason,
      'action': 'escalate',
    });
    _ensureOk(r);
  }

  Future<void> handoff(String id, {String reason = ''}) async {
    final r = await _api.dio.post('/tasks/$id/updates', data: {
      'text': reason,
      'action': 'handoff',
    });
    _ensureOk(r);
  }

  /// POST /tasks/{id}/execution-plan/generate  |
  /// PATCH /tasks/{id}/execution-plan  |
  /// DELETE /tasks/{id}/execution-plan.
  Future<void> generatePlan(String id) async {
    final r = await _api.dio.post('/tasks/$id/execution-plan/generate');
    _ensureOk(r);
  }

  Future<void> setPlan(String id, Map<String, dynamic> plan) async {
    final r = await _api.dio.patch('/tasks/$id/execution-plan', data: plan);
    _ensureOk(r);
  }

  Future<void> clearPlan(String id) async {
    final r = await _api.dio.delete('/tasks/$id/execution-plan');
    _ensureOk(r);
  }

  /// POST /tasks/{id}/attachment — multipart. `bytes` + `filename` are
  /// enough for the backend; MIME is inferred server-side.
  Future<void> attach(String id,
      {required List<int> bytes,
      required String filename,
      String? mimeType}) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    final r = await _api.dio.post('/tasks/$id/attachment', data: form);
    _ensureOk(r);
  }
}

class PeopleRepository {
  final _api = ApiClient();

  Future<List<Person>> list() async {
    final r = await _api.dio.get('/users');
    _ensureOk(r);
    final list = (r.data as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(Person.fromJson).toList();
  }

  /// POST /users — matches MemberDialog on the frontend. Password + OTP
  /// are optional; the backend mints an invite_token when both are absent.
  Future<Map<String, dynamic>> create({
    required String name,
    required String email,
    required String role,
    String? phone,
    String? password,
  }) async {
    final r = await _api.dio.post('/users', data: {
      'name': name,
      'email': email,
      'role': role,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (password != null && password.isNotEmpty) 'password': password,
    });
    _ensureOk(r);
    return (r.data as Map).cast<String, dynamic>();
  }

  /// Team router exposes `deprovision` (removes an active member) and
  /// `uninvite` (revokes a pending invite) rather than a plain DELETE.
  Future<void> deprovision(String id) async {
    final r = await _api.dio.post('/users/$id/deprovision');
    _ensureOk(r);
  }

  Future<void> uninvite(String id) async {
    final r = await _api.dio.post('/users/$id/uninvite');
    _ensureOk(r);
  }

  /// PATCH /users/{id} — edit a member (name, phone, role,
  /// reporting_manager_id, permissions map).
  Future<void> update(String id, Map<String, dynamic> body) async {
    final r = await _api.dio.patch('/users/$id', data: body);
    _ensureOk(r);
  }

  /// GET /users/{id} — single-member fetch (Person shape).
  Future<Person> get(String id) async {
    final r = await _api.dio.get('/users/$id');
    _ensureOk(r);
    return Person.fromJson(r.data as Map<String, dynamic>);
  }
}

/// One at-risk task returned by GET /leaves/{id}/impact.
class LeaveImpactTask {
  final String id;
  final String title;
  final DateTime? dueAt;
  final String? assigneeName;
  final String? reason;
  const LeaveImpactTask({
    required this.id,
    required this.title,
    this.dueAt,
    this.assigneeName,
    this.reason,
  });
  factory LeaveImpactTask.fromJson(Map<String, dynamic> j) => LeaveImpactTask(
        id: (j['id'] ?? j['task_id'] ?? '').toString(),
        title: (j['title'] ?? '').toString(),
        dueAt: j['due_at'] is String
            ? DateTime.tryParse(j['due_at'] as String)
            : null,
        assigneeName: j['assignee_name'] as String?,
        reason: j['reason'] as String?,
      );
}

/// The CRM data layer — pulls `/contacts`, enriches with open-complaint
/// counts (`/complaints?status=open`) and A/R + A/P (`/crm/outstanding`),
/// then hands one merged list to the CRM screen. Any enrichment call that
/// fails just contributes empty data — the base list still renders.
/// Fetches the Business Calendar feed. Mirrors the frontend Calendar.js
/// call — one endpoint returns days (with events) + per-type counts + total.
/// GET /journal — powers the CEO Journal. Search is a server round-trip:
/// pass `q` and the endpoint returns the same day-grouped shape scoped to
/// entries whose title/notes/tags match.
/// Owner/user-scoped settings mutations. Ports the frontend Settings.js
/// PATCH/POST calls into a narrow client that swallows shape variance.
class SettingsRepository {
  final _api = ApiClient();

  Future<void> updateProfile({required String name, String? phone}) async {
    final r = await _api.dio.patch('/auth/profile', data: {
      'name': name,
      if (phone != null) 'phone': phone,
    });
    _ensureOk(r);
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    final r = await _api.dio.post('/auth/change-password', data: {
      'current_password': currentPassword,
      'new_password': newPassword,
    });
    _ensureOk(r);
  }

  Future<void> updateTenantSettings({
    double? highValueThreshold,
    bool? requireOwnerSignoff,
    String? currency,
  }) async {
    final r = await _api.dio.patch('/tenant/settings', data: {
      if (highValueThreshold != null)
        'high_value_threshold': highValueThreshold,
      if (requireOwnerSignoff != null)
        'require_owner_signoff': requireOwnerSignoff,
      if (currency != null) 'currency': currency,
    });
    _ensureOk(r);
  }

  /// Full company patch — Company Details card.
  Future<void> patchTenant(Map<String, dynamic> body) async {
    final r = await _api.dio.patch('/tenant', data: body);
    _ensureOk(r);
  }

  /// Business Vocabulary — save + regenerate.
  Future<void> patchLexicon(Map<String, dynamic> lexicon) async {
    final r =
        await _api.dio.patch('/tenant/lexicon', data: {'lexicon': lexicon});
    _ensureOk(r);
  }

  Future<void> regenerateLexicon() async {
    final r = await _api.dio.post('/tenant/lexicon/regenerate');
    _ensureOk(r);
  }

  /// Finance Categories.
  Future<void> patchFinanceCategories(Map<String, dynamic> categories) async {
    final r = await _api.dio.patch('/tenant/finance-categories',
        data: {'finance_categories': categories});
    _ensureOk(r);
  }

  Future<void> regenerateFinanceCategories() async {
    final r = await _api.dio.post('/tenant/finance-categories/regenerate');
    _ensureOk(r);
  }

  /// Operating Model — pipelines/stages editor.
  Future<void> patchOperatingModel(Map<String, dynamic> model) async {
    final r = await _api.dio
        .patch('/tenant/operating-model', data: {'operating_model': model});
    _ensureOk(r);
  }

  Future<void> regenerateOperatingModel() async {
    final r = await _api.dio.post('/tenant/operating-model/regenerate');
    _ensureOk(r);
  }

  /// PATCH /tenant/leave-approvers — {approvers: {roleKey: userId}}.
  Future<void> patchLeaveApprovers(Map<String, String?> approvers) async {
    final r = await _api.dio
        .patch('/tenant/leave-approvers', data: {'approvers': approvers});
    _ensureOk(r);
  }

  /// OS blueprint — free-standing operational tasks + org-wide approval rules.
  Future<void> patchOsBlueprint({
    required List<Map<String, dynamic>> operationalTaskTemplates,
    required List<Map<String, dynamic>> approvalRules,
  }) async {
    final r = await _api.dio.patch('/tenant/os-blueprint', data: {
      'operational_task_templates': operationalTaskTemplates,
      'approval_rules': approvalRules,
    });
    _ensureOk(r);
  }

  /// Roles CRUD.
  Future<void> addRole({required String key, required String label}) async {
    final r = await _api.dio
        .post('/tenant/roles', data: {'key': key, 'label': label});
    _ensureOk(r);
  }

  Future<void> renameRole({required String key, required String label}) async {
    final r =
        await _api.dio.patch('/tenant/roles/$key', data: {'label': label});
    _ensureOk(r);
  }

  Future<void> deleteRole(String key) async {
    final r = await _api.dio.delete('/tenant/roles/$key');
    _ensureOk(r);
  }
}

class JournalRepository {
  final _api = ApiClient();

  Future<JournalFeed> feed({String q = ''}) async {
    final r = await _api.dio.get(
      '/journal',
      queryParameters: q.isEmpty ? null : {'q': q},
    );
    _ensureOk(r);
    if (r.data is Map<String, dynamic>) {
      return JournalFeed.fromJson(r.data as Map<String, dynamic>);
    }
    return const JournalFeed(days: []);
  }
}

class CalendarRepository {
  final _api = ApiClient();

  Future<CalendarFeed> feed({int days = 45}) async {
    final r = await _api.dio.get('/calendar', queryParameters: {'days': days});
    _ensureOk(r);
    if (r.data is Map<String, dynamic>) {
      return CalendarFeed.fromJson(r.data as Map<String, dynamic>);
    }
    return const CalendarFeed(days: [], counts: {}, total: 0);
  }
}

class ContactsRepository {
  final _api = ApiClient();

  /// POST /contacts — matches the New Buyer / New Supplier submit on
  /// `AddContactMenu`. `type` is `customer` (or `dealer`) for buyers,
  /// `vendor` for suppliers.
  Future<Contact> create({
    required String name,
    required String type,
    String? company,
    String? phone,
    String? email,
    String status = 'active',
  }) async {
    final r = await _api.dio.post('/contacts', data: {
      'name': name,
      'type': type,
      'status': status,
      if (company != null && company.isNotEmpty) 'company': company,
      if (phone != null && phone.isNotEmpty) 'phone': phone,
      if (email != null && email.isNotEmpty) 'email': email,
    });
    _ensureOk(r);
    return Contact.fromJson(r.data as Map<String, dynamic>);
  }

  /// DELETE /contacts/{id}.
  Future<void> delete(String id) async {
    final r = await _api.dio.delete('/contacts/$id');
    _ensureOk(r);
  }

  /// POST /complaints — used when adding a complaint against a contact.
  Future<void> logComplaint({
    required String contactId,
    required String text,
    String severity = 'medium',
  }) async {
    final r = await _api.dio.post('/complaints', data: {
      'customer_id': contactId,
      'text': text,
      'severity': severity,
    });
    _ensureOk(r);
  }

  /// PATCH /contacts/{id} — edit contact fields. Any subset of
  /// {name, company, type, status, phone, email} is accepted.
  Future<Contact> update(String id, Map<String, dynamic> body) async {
    final r = await _api.dio.patch('/contacts/$id', data: body);
    _ensureOk(r);
    return Contact.fromJson(r.data as Map<String, dynamic>);
  }

  /// GET /contacts/{id}/profile — 360° per-contact rollup (invoices,
  /// payments, complaints, workflows, tasks, price history). Requires the
  /// `finance` perm on the backend.
  Future<ContactProfile> profile(String id) async {
    final r = await _api.dio.get('/contacts/$id/profile');
    _ensureOk(r);
    return ContactProfile.fromJson(r.data as Map<String, dynamic>);
  }

  /// GET /crm/activity/{contact_id} — activity feed, newest first.
  Future<List<CrmActivity>> activity(String contactId, {int limit = 50}) async {
    final r = await _api.dio
        .get('/crm/activity/$contactId', queryParameters: {'limit': limit});
    _ensureOk(r);
    final data = r.data;
    List raw = const [];
    if (data is List) raw = data;
    if (data is Map && data['items'] is List) raw = data['items'] as List;
    return raw
        .whereType<Map<String, dynamic>>()
        .map(CrmActivity.fromJson)
        .toList();
  }

  /// POST /crm/activity/{contact_id} — log a call/meeting/note/whatsapp/email.
  Future<void> logActivity({
    required String contactId,
    required String kind,
    required String text,
  }) async {
    final r = await _api.dio.post('/crm/activity/$contactId', data: {
      'kind': kind,
      'text': text,
    });
    _ensureOk(r);
  }

  Future<List<Contact>> list() async {
    final base = await _fetchContacts();
    if (base.isEmpty) return base;

    // Enrich in parallel — a failure in either leg is a no-op.
    final results = await Future.wait([
      _complaintCounts().catchError((_) => <String, int>{}),
      _outstanding().catchError((_) => <String, _Outstanding>{}),
    ]);
    final counts = results[0] as Map<String, int>;
    final owed = results[1] as Map<String, _Outstanding>;

    return base.map((c) {
      final o = owed[c.id];
      return c.copyWith(
        complaintCount: counts[c.id] ?? 0,
        receivables: o?.receivables ?? 0,
        payables: o?.payables ?? 0,
        oldestDays: o?.oldestDays ?? 0,
      );
    }).toList();
  }

  Future<List<Contact>> _fetchContacts() async {
    final r = await _api.dio.get('/contacts');
    _ensureOk(r);
    final data = r.data;
    List raw = const [];
    if (data is List) {
      raw = data;
    } else if (data is Map && data['items'] is List) {
      raw = data['items'] as List;
    }
    return raw
        .whereType<Map<String, dynamic>>()
        .map(Contact.fromJson)
        .toList();
  }

  Future<Map<String, int>> _complaintCounts() async {
    final r = await _api.dio.get(
      '/complaints',
      queryParameters: {'status': 'open'},
    );
    _ensureOk(r);
    final data = r.data;
    List raw = const [];
    if (data is List) {
      raw = data;
    } else if (data is Map && data['items'] is List) {
      raw = data['items'] as List;
    }
    final out = <String, int>{};
    for (final row in raw.whereType<Map<String, dynamic>>()) {
      final cid = (row['customer_id'] ?? row['contact_id'])?.toString();
      if (cid == null || cid.isEmpty) continue;
      out[cid] = (out[cid] ?? 0) + 1;
    }
    return out;
  }

  Future<Map<String, _Outstanding>> _outstanding() async {
    final r = await _api.dio.get('/crm/outstanding');
    _ensureOk(r);
    final data = r.data;
    if (data is! Map) return const {};
    final out = <String, _Outstanding>{};
    data.forEach((k, v) {
      if (v is Map) {
        out[k.toString()] = _Outstanding(
          receivables: (v['receivables'] as num?)?.toDouble() ?? 0,
          payables: (v['payables'] as num?)?.toDouble() ?? 0,
          oldestDays: (v['oldest_days'] as num?)?.toInt() ?? 0,
        );
      }
    });
    return out;
  }
}

class _Outstanding {
  final double receivables;
  final double payables;
  final int oldestDays;
  const _Outstanding({
    required this.receivables,
    required this.payables,
    required this.oldestDays,
  });
}

class MoneyRepository {
  final _api = ApiClient();

  /// GET /ledger/summary — the finance overview payload used by the Money
  /// screen's Overview tab (net profit, KPIs, sparkline, overdue list).
  Future<LedgerSummary> summary() async {
    final r = await _api.dio.get('/ledger/summary');
    _ensureOk(r);
    return LedgerSummary.fromJson(r.data as Map<String, dynamic>);
  }

  /// One combined feed via the ledger AI endpoint. `scope` is `all`, `receivables`,
  /// `payables`, or `transactions`.
  Future<List<MoneyEntry>> feed(String scope) async {
    final r = await _api.dio.get('/ledger/ai/$scope');
    _ensureOk(r);
    final data = r.data;
    List raw = const [];
    if (data is List) {
      raw = data;
    } else if (data is Map && data['items'] is List) {
      raw = data['items'] as List;
    }
    return raw
        .whereType<Map<String, dynamic>>()
        .map(MoneyEntry.fromJson)
        .toList();
  }

  Future<List<Revenue>> revenue() async {
    final r = await _api.dio.get('/revenue');
    _ensureOk(r);
    // Backend returns a MAP: {currency, totals, invoices, payments,
    // unmatched_payments, open_invoices}. The mobile Revenue tab renders
    // the invoice list, so unwrap that. Fall back to a raw list if a
    // future backend version starts returning one directly.
    final data = r.data;
    List raw = const [];
    if (data is List) {
      raw = data;
    } else if (data is Map && data['invoices'] is List) {
      raw = data['invoices'] as List;
    }
    return raw
        .whereType<Map<String, dynamic>>()
        .map(Revenue.fromJson)
        .toList();
  }

  Future<List<Expense>> expenses() async {
    final r = await _api.dio.get('/expenses');
    _ensureOk(r);
    final list = (r.data as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(Expense.fromJson).toList();
  }

  Future<List<Asset>> assets() async {
    final r = await _api.dio.get('/assets');
    _ensureOk(r);
    final list = (r.data as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(Asset.fromJson).toList();
  }

  Future<List<InventoryItem>> inventory() async {
    final r = await _api.dio.get('/inventory');
    _ensureOk(r);
    final list = (r.data as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(InventoryItem.fromJson).toList();
  }

  /// POST /ledger/ask — natural-language ledger Q&A. Returns the plain
  /// text answer. Errors surface as the empty string so the caller renders
  /// a soft "no answer" hint rather than crashing the AI card.
  Future<String> ask(String question, {String scope = 'all'}) async {
    try {
      final r = await _api.dio.post('/ledger/ask', data: {
        'question': question,
        'scope': scope,
      });
      _ensureOk(r);
      final data = r.data;
      if (data is String) return data;
      if (data is Map) {
        for (final k in ['answer', 'reply', 'text', 'response']) {
          final v = data[k];
          if (v is String && v.isNotEmpty) return v;
        }
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  /// POST /ledger/ai/{scope}/refresh — recompute the AI ledger panel.
  Future<void> refreshAi(String scope) async {
    final r = await _api.dio.post('/ledger/ai/$scope/refresh');
    _ensureOk(r);
  }

  Future<int> pendingCaptureCount() async {
    try {
      final r = await _api.dio.get('/captures/pending-count');
      _ensureOk(r);
      if (r.data is Map) return ((r.data['count'] as num?)?.toInt()) ?? 0;
    } catch (_) {/* ignore — non-critical */}
    return 0;
  }

  // ── Add-forms (no file variant) ────────────────────────────────────────────
  // The frontend's *-with-file endpoints accept multipart; here we hit the
  // same routes without the file leg so a mobile user can key in fields
  // directly. File uploads (Upload bill / Scan / CSV) require a picker
  // package that isn't in pubspec yet.

  Future<void> addExpense(Map<String, dynamic> body) async {
    final r = await _api.dio.post('/expenses/with-file', data: body);
    _ensureOk(r);
  }

  Future<void> addAsset(Map<String, dynamic> body) async {
    final r = await _api.dio.post('/assets/with-file', data: body);
    _ensureOk(r);
  }

  Future<void> addInventory(Map<String, dynamic> body) async {
    final r = await _api.dio.post('/inventory/with-file', data: body);
    _ensureOk(r);
  }

  Future<void> addRevenue(Map<String, dynamic> body) async {
    final r = await _api.dio.post('/revenue/with-file', data: body);
    _ensureOk(r);
  }

  // ── Deletes per row ────────────────────────────────────────────────────────
  Future<void> deleteExpense(String id) async {
    final r = await _api.dio.delete('/expenses/$id');
    _ensureOk(r);
  }

  Future<void> deleteAsset(String id) async {
    final r = await _api.dio.delete('/assets/$id');
    _ensureOk(r);
  }

  Future<void> deleteInventory(String id) async {
    final r = await _api.dio.delete('/inventory/$id');
    _ensureOk(r);
  }

  Future<void> deleteInvoice(String id) async {
    final r = await _api.dio.delete('/revenue/invoice/$id');
    _ensureOk(r);
  }

  // ── Inbox (captures) ───────────────────────────────────────────────────────
  Future<void> approveCapture(String id) async {
    final r = await _api.dio.post('/captures/$id/approve');
    _ensureOk(r);
  }

  Future<void> rejectCapture(String id, {String reason = ''}) async {
    final r = await _api.dio
        .post('/captures/$id/reject', data: {'reason': reason});
    _ensureOk(r);
  }

  // ── Ingest (multipart — needs a file picker package to call from UI) ──────
  Future<void> ingestDocument(
      {required List<int> bytes, required String filename}) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    final r = await _api.dio.post('/ingest/document', data: form);
    _ensureOk(r);
  }

  Future<void> ingestCsv(
      {required List<int> bytes, required String filename}) async {
    final form = FormData.fromMap({
      'file': MultipartFile.fromBytes(bytes, filename: filename),
    });
    final r = await _api.dio.post('/ingest/csv', data: form);
    _ensureOk(r);
  }
}

class WorkflowsRepository {
  final _api = ApiClient();

  /// GET /api/workflows?type={key}&with_tasks=true
  Future<List<Workflow>> list(String pipelineKey) async {
    final r = await _api.dio.get('/workflows', queryParameters: {
      'type': pipelineKey,
      'with_tasks': true,
    });
    _ensureOk(r);
    final list = (r.data as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(Workflow.fromJson).toList();
  }

  /// PATCH /api/workflows/{id}/advance — move workflow to targetStage.
  Future<void> advance(String id, String targetStage, {bool override = false, String? reason}) async {
    final r = await _api.dio.patch('/workflows/$id/advance', data: {
      'stage': targetStage,
      if (override) 'override': true,
      if (reason != null) 'reason': reason,
    });
    _ensureOk(r);
  }

  /// POST /workflows — matches NewWorkflowDialog on the frontend.
  Future<void> create({
    required String type,
    required String title,
    String? detail,
    String? counterparty,
    String? contactId,
    double? amount,
  }) async {
    final r = await _api.dio.post('/workflows', data: {
      'type': type,
      'title': title,
      if (detail != null && detail.isNotEmpty) 'detail': detail,
      if (counterparty != null && counterparty.isNotEmpty)
        'counterparty': counterparty,
      if (contactId != null && contactId.isNotEmpty) 'contact_id': contactId,
      if (amount != null) 'amount': amount,
    });
    _ensureOk(r);
  }

  /// DELETE /workflows/{id}.
  Future<void> delete(String id) async {
    final r = await _api.dio.delete('/workflows/$id');
    _ensureOk(r);
  }
}

class LeaveRepository {
  final _api = ApiClient();

  /// GET /api/leaves?scope=(mine|approvals)
  Future<List<LeaveRequest>> list(String scope) async {
    final r = await _api.dio.get('/leaves', queryParameters: {'scope': scope});
    _ensureOk(r);
    final list = (r.data as List?) ?? const [];
    return list.whereType<Map<String, dynamic>>().map(LeaveRequest.fromJson).toList();
  }

  /// POST /api/leaves/{id}/{kind} — approve | reject | request-info
  Future<void> decide(String id, String kind, {String? note}) async {
    final r = await _api.dio.post('/leaves/$id/$kind', data: {
      if (note != null) 'note': note,
    });
    _ensureOk(r);
  }

  /// POST /leaves — planned time off. `dayPortion` is `full` or `half`.
  Future<void> request({
    required String leaveType,
    required DateTime fromDate,
    required DateTime toDate,
    required String dayPortion,
    String reason = '',
  }) async {
    String p(int n) => n.toString().padLeft(2, '0');
    String iso(DateTime d) => '${d.year}-${p(d.month)}-${p(d.day)}';
    final r = await _api.dio.post('/leaves', data: {
      'leave_type': leaveType,
      'from_date': iso(fromDate),
      'to_date': iso(toDate),
      'day_portion': dayPortion,
      'reason': reason,
    });
    _ensureOk(r);
  }

  /// GET /leaves/{id}/impact — the AI-suggested cover panel on approved leaves.
  Future<List<LeaveImpactTask>> impact(String leaveId) async {
    final r = await _api.dio.get('/leaves/$leaveId/impact');
    _ensureOk(r);
    final data = r.data;
    List raw = const [];
    if (data is List) {
      raw = data;
    } else if (data is Map) {
      if (data['tasks'] is List) raw = data['tasks'] as List;
      else if (data['at_risk'] is List) raw = data['at_risk'] as List;
      else if (data['items'] is List) raw = data['items'] as List;
    }
    return raw
        .whereType<Map<String, dynamic>>()
        .map(LeaveImpactTask.fromJson)
        .toList();
  }

  /// POST /leaves/absence — same-day emergency notification.
  Future<void> reportAbsence({
    required String reason,
    String note = '',
  }) async {
    final r = await _api.dio.post('/leaves/absence', data: {
      'reason': reason,
      'note': note,
    });
    _ensureOk(r);
  }
}

class NotificationsRepository {
  final _api = ApiClient();

  /// Backend returns `{notifications: [...], unread: N}`. This value is
  /// pushed to `unreadCount` so the header bell badge across every screen
  /// can react without re-fetching itself.
  static final ValueNotifier<int> unreadCount = ValueNotifier<int>(0);

  Future<List<AppNotification>> list() async {
    final r = await _api.dio.get('/notifications');
    _ensureOk(r);
    final data = r.data;
    List raw = const [];
    int unread = 0;
    if (data is List) {
      raw = data;
    } else if (data is Map) {
      if (data['notifications'] is List) raw = data['notifications'] as List;
      if (data['unread'] is num) unread = (data['unread'] as num).toInt();
    }
    // Update the shared badge value; if the backend didn't send `unread`,
    // fall back to counting !read entries client-side.
    if (unread == 0 && raw.isNotEmpty) {
      unread = raw
          .whereType<Map<String, dynamic>>()
          .where((n) => n['read'] != true)
          .length;
    }
    unreadCount.value = unread;
    return raw
        .whereType<Map<String, dynamic>>()
        .map(AppNotification.fromJson)
        .toList();
  }

  /// POST /notifications/{id}/read — marks a single notification as read.
  Future<void> markRead(String id) async {
    final r = await _api.dio.post('/notifications/$id/read');
    _ensureOk(r);
    if (unreadCount.value > 0) unreadCount.value -= 1;
  }
}

/// Talks to the Brain `/api/ask` endpoint — the general Dex Q&A wire.
/// Returns the plain-text answer. Falls back to a soft message if the
/// backend didn't return one so the caller can render a bubble either
/// way.
class DexRepository {
  final _api = ApiClient();
  Future<String> ask(String question) async {
    try {
      final r = await _api.dio.post('/ask', data: {'question': question});
      _ensureOk(r);
      final data = r.data;
      if (data is Map) {
        // /api/ask returns a shaped response; the human answer lives on
        // `answer`, with `message` as the fallback used for permission
        // denials and insufficient-data types.
        for (final k in ['answer', 'message', 'reply', 'text']) {
          final v = data[k];
          if (v is String && v.isNotEmpty) return v;
        }
        return "I couldn't find an answer.";
      }
      if (data is String) return data;
      return "I couldn't find an answer.";
    } catch (_) {
      return "I couldn't reach the assistant just now.";
    }
  }
}

void _ensureOk(dynamic response) {
  final code = response.statusCode as int?;
  if (code == null || code >= 400) {
    throw ApiError(code, 'Request failed with status $code');
  }
}

class ApiError implements Exception {
  final int? statusCode;
  final String message;
  ApiError(this.statusCode, this.message);
  @override
  String toString() => message;
}
