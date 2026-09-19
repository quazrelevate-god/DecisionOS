/// Plain-Dart models mirroring the FastAPI responses. No codegen — every
/// class has a hand-written `fromJson` factory. Keep these narrow: only the
/// fields the mobile UI actually reads.

class User {
  final String id;
  final String name;
  final String? email;
  final String? phone;
  final String? role;
  final String? tenantName;
  final List<String> permissions;

  User({
    required this.id,
    required this.name,
    this.email,
    this.phone,
    this.role,
    this.tenantName,
    this.permissions = const [],
  });

  factory User.fromJson(Map<String, dynamic> j) => User(
        id: (j['id'] ?? j['_id'] ?? '').toString(),
        name: (j['name'] ?? j['full_name'] ?? j['email'] ?? '').toString(),
        email: j['email'] as String?,
        phone: j['phone'] as String?,
        role: j['role'] as String?,
        tenantName: j['tenant_name'] as String? ?? j['company'] as String?,
        permissions:
            (j['permissions'] as List?)?.map((e) => e.toString()).toList() ?? const [],
      );

  String get initial => name.isNotEmpty ? name[0].toUpperCase() : '?';
}

class Task {
  final String id;
  final String title;
  final String? description;
  final String status; // todo, in_progress, waiting, review, done, cancelled, blocked
  final String priority; // low, medium, high
  final DateTime? dueAt;
  final String? assigneeName;
  final String? assigneeId;
  final String? taskType; // e.g. finance, logistics — used as the filter category
  final int attachmentCount;
  final String? source; // "escalation" | "handoff" | ...
  final DateTime? createdAt;
  final String? createdByName;
  final String? createdBy;
  final bool overdue;
  // Approval fields (populated on the /tasks?view=approvals feed).
  final bool approvalRequired;
  final String? approvalStatus; // pending | approved | rejected
  final String? approvalStage;  // start | close
  final String? approverId;
  final String? approverName;
  final String? rejectionReason;

  Task({
    required this.id,
    required this.title,
    this.description,
    required this.status,
    required this.priority,
    this.dueAt,
    this.assigneeName,
    this.assigneeId,
    this.taskType,
    this.attachmentCount = 0,
    this.source,
    this.createdAt,
    this.createdByName,
    this.createdBy,
    this.overdue = false,
    this.approvalRequired = false,
    this.approvalStatus,
    this.approvalStage,
    this.approverId,
    this.approverName,
    this.rejectionReason,
  });

  bool get isTerminal => status == 'done' || status == 'cancelled';
  bool get isEscalation => source == 'escalation';
  bool get isHandoff => source == 'handoff';
  bool get isPendingApproval =>
      approvalRequired && approvalStatus == 'pending' && !isTerminal;

  factory Task.fromJson(Map<String, dynamic> j) {
    final due = j['due_at'] ?? j['due_date'];
    final parsedDue = due is String ? DateTime.tryParse(due) : null;
    final status = (j['status'] ?? 'todo').toString();
    final terminal = status == 'done' || status == 'cancelled';
    final overdue = parsedDue != null && !terminal && parsedDue.isBefore(DateTime.now());
    return Task(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      title: (j['title'] ?? j['name'] ?? '').toString(),
      description: j['description'] as String?,
      status: status,
      priority: (j['priority'] ?? 'medium').toString(),
      dueAt: parsedDue,
      assigneeName: j['assignee_name'] as String? ?? j['owner_name'] as String?,
      assigneeId: j['assignee_id'] as String?,
      taskType: j['task_type'] as String?,
      attachmentCount: (j['attachment_count'] as num?)?.toInt() ?? 0,
      source: j['source'] as String?,
      createdAt: j['created_at'] is String ? DateTime.tryParse(j['created_at'] as String) : null,
      createdByName: j['created_by_name'] as String?,
      createdBy: j['created_by'] as String?,
      overdue: overdue,
      approvalRequired: (j['approval_required'] as bool?) ?? false,
      approvalStatus: j['approval_status'] as String?,
      approvalStage: j['approval_stage'] as String?,
      approverId: j['approver_id'] as String?,
      approverName: j['approver_name'] as String?,
      rejectionReason: j['rejection_reason'] as String?,
    );
  }
}

/// One decision-desk card. Contract mirrors `backend/routers/desk.py`:
/// {id, kind, title, context_line, amount?, amount_formatted?, cta,
///  target_id, target_kind, target_owner_id?}
class Decision {
  final String id;
  final String title;
  final String contextLine; // "Waiting 6 days · From Rajesh Sharma"
  final String? amountFormatted; // "₹4,80,000"
  final String cta; // review | chase | respond | nudge
  final String chip; // needs_decision | on_fire | due_today | important
  final String? targetId;
  final String? targetKind;

  Decision({
    required this.id,
    required this.title,
    required this.contextLine,
    this.amountFormatted,
    required this.cta,
    required this.chip,
    this.targetId,
    this.targetKind,
  });

  factory Decision.fromJson(Map<String, dynamic> j) => Decision(
        id: (j['id'] ?? j['_id'] ?? '').toString(),
        title: (j['title'] ?? j['summary'] ?? '').toString(),
        contextLine: (j['context_line'] ?? j['meta'] ?? '').toString(),
        amountFormatted: j['amount_formatted'] as String?,
        cta: (j['cta'] ?? 'review').toString(),
        chip: (j['chip'] ?? 'needs_decision').toString(),
        targetId: j['target_id'] as String?,
        targetKind: j['target_kind'] as String?,
      );
}

/// The response envelope from GET /api/desk?chip=…
class DeskChipData {
  final String chip;
  final Map<String, int> counters; // {needs_decision, on_fire, due_today, important}
  final List<Decision> cards;

  DeskChipData({required this.chip, required this.counters, required this.cards});

  factory DeskChipData.fromJson(Map<String, dynamic> j) {
    final chipKey = (j['chip'] ?? 'needs_decision').toString();
    final rawCounters = (j['counters'] as Map?) ?? const {};
    final counters = <String, int>{};
    for (final e in rawCounters.entries) {
      counters[e.key.toString()] = (e.value as num?)?.toInt() ?? 0;
    }
    final rawCards = (j['cards'] as List?) ?? const [];
    final cards = rawCards
        .whereType<Map<String, dynamic>>()
        .map((c) => Decision.fromJson({...c, 'chip': chipKey}))
        .toList();
    return DeskChipData(chip: chipKey, counters: counters, cards: cards);
  }
}

/// Everything /desk/summary returns that the header + tiles need.
class DeskSummary {
  final String greeting;         // "Good evening, Rajesh."
  final int delayed;
  final int completedYesterday;
  final int pendingDecisions;
  final int? complaintsValue;
  final int? complaintsNew7d;
  final double? overdueCashAmount;

  DeskSummary({
    required this.greeting,
    required this.delayed,
    required this.completedYesterday,
    required this.pendingDecisions,
    this.complaintsValue,
    this.complaintsNew7d,
    this.overdueCashAmount,
  });

  factory DeskSummary.fromJson(Map<String, dynamic> j) {
    final counters = (j['counters'] as Map?) ?? const {};
    final trends = (j['trends'] as Map?) ?? const {};
    final cash = trends['cash_flow'] as Map? ?? const {};
    final complaints = trends['complaints_trend'] as Map? ?? const {};
    return DeskSummary(
      greeting: (j['greeting'] ?? '').toString(),
      delayed: (counters['delayed'] as num?)?.toInt() ?? 0,
      completedYesterday: (counters['completed_yesterday'] as num?)?.toInt() ?? 0,
      pendingDecisions: (counters['pending_decisions'] as num?)?.toInt() ?? 0,
      complaintsValue: (complaints['value'] as num?)?.toInt(),
      complaintsNew7d: (complaints['new_7d'] as num?)?.toInt(),
      overdueCashAmount: (cash['overdue_receivables_amount'] as num?)?.toDouble(),
    );
  }
}

/// The operating-score endpoint response — score + weakest category.
class OperatingScore {
  final int? overall;
  final bool enough;
  final Map<String, int> categories;
  final OpsStats stats;
  final OpsMySnapshot mySnapshot;
  final List<OpsTeamMember> team;

  OperatingScore({
    required this.overall,
    required this.enough,
    required this.categories,
    required this.stats,
    required this.mySnapshot,
    this.team = const [],
  });

  factory OperatingScore.fromJson(Map<String, dynamic> j) {
    final company = (j['company'] as Map?) ?? const {};
    final rawCats = (company['categories'] as Map?) ?? const {};
    final cats = <String, int>{};
    for (final e in rawCats.entries) {
      final v = e.value;
      if (v is num) cats[e.key.toString()] = v.toInt();
    }
    final rawTeam = (j['users'] as List?) ?? (j['team'] as List?) ?? const [];
    return OperatingScore(
      overall: (company['overall'] as num?)?.toInt(),
      enough: company['enough_data'] != false,
      categories: cats,
      stats: OpsStats.fromJson(
          (j['stats'] as Map?)?.cast<String, dynamic>() ?? const {}),
      mySnapshot: OpsMySnapshot.fromJson(
          (j['mySnapshot'] as Map?)?.cast<String, dynamic>() ??
              (j['my_snapshot'] as Map?)?.cast<String, dynamic>() ??
              const {}),
      team: rawTeam
          .whereType<Map<String, dynamic>>()
          .map(OpsTeamMember.fromJson)
          .toList(),
    );
  }
}

/// One row in the Ops Team Execution leaderboard. Ports the shape the
/// frontend Leaderboard consumes.
class OpsTeamMember {
  final String id;
  final String name;
  final String? role;
  final int? score;
  final int done;
  final int open;
  final int overdue;
  final DateTime? lastActivity;
  const OpsTeamMember({
    required this.id,
    required this.name,
    this.role,
    this.score,
    this.done = 0,
    this.open = 0,
    this.overdue = 0,
    this.lastActivity,
  });
  factory OpsTeamMember.fromJson(Map<String, dynamic> j) => OpsTeamMember(
        id: (j['id'] ?? j['user_id'] ?? '').toString(),
        name: (j['name'] ?? j['full_name'] ?? '').toString(),
        role: j['role'] as String?,
        score: (j['score'] as num?)?.toInt(),
        done: (j['done'] as num?)?.toInt() ?? 0,
        open: (j['open'] as num?)?.toInt() ?? 0,
        overdue: (j['overdue'] as num?)?.toInt() ?? 0,
        lastActivity: j['last_activity'] is String
            ? DateTime.tryParse(j['last_activity'] as String)
            : null,
      );
}

/// Today's operations — company-wide task counts served by /operating-score.
class OpsStats {
  final int done;
  final int open;
  final int overdue;
  final int openComplaints;
  const OpsStats({
    this.done = 0,
    this.open = 0,
    this.overdue = 0,
    this.openComplaints = 0,
  });
  factory OpsStats.fromJson(Map<String, dynamic> j) => OpsStats(
        done: (j['done'] as num?)?.toInt() ?? 0,
        open: (j['open'] as num?)?.toInt() ?? 0,
        overdue: (j['overdue'] as num?)?.toInt() ?? 0,
        openComplaints:
            (j['open_complaints'] as num?)?.toInt() ?? 0,
      );
}

/// The current user's personal execution snapshot — /operating-score's
/// `mySnapshot` field (percentages for completion + proof, plus counts).
class OpsMySnapshot {
  final int completionRate;
  final int open;
  final int overdue;
  final int proofUploadRate;
  final int actionable;
  final int completed;
  const OpsMySnapshot({
    this.completionRate = 0,
    this.open = 0,
    this.overdue = 0,
    this.proofUploadRate = 0,
    this.actionable = 0,
    this.completed = 0,
  });
  factory OpsMySnapshot.fromJson(Map<String, dynamic> j) => OpsMySnapshot(
        completionRate: (j['completion_rate'] as num?)?.toInt() ?? 0,
        open: (j['open'] as num?)?.toInt() ?? 0,
        overdue: (j['overdue'] as num?)?.toInt() ?? 0,
        proofUploadRate: (j['proof_upload_rate'] as num?)?.toInt() ?? 0,
        actionable: (j['actionable'] as num?)?.toInt() ?? 0,
        completed: (j['completed'] as num?)?.toInt() ?? 0,
      );
}

/// /ledger/summary — the number tiles' money side.
class LedgerSummary {
  final double? netProfit;
  final double? lastMonthSpend;
  final double? revenueBilled;
  final double? revenueReceived;
  final double? totalSpend;
  final double? overdueAmount;
  final int overdueCount;
  final List<double> monthlyNet; // net over last N months for the sparkline
  final String currency;
  final List<OverdueReceivable> overdueReceivables;
  // KM — the six-KPI Overview + the Spend-by-category donut + Top-vendors bars.
  final double? assetValue;
  final double? inventoryValue;
  final double? revenueOutstanding; // receivables still owed to us
  final List<CategorySpend> byCategory;
  final List<VendorSpend> byVendor;

  LedgerSummary({
    this.netProfit,
    this.lastMonthSpend,
    this.revenueBilled,
    this.revenueReceived,
    this.totalSpend,
    this.overdueAmount,
    this.overdueCount = 0,
    this.monthlyNet = const [],
    this.currency = 'INR',
    this.overdueReceivables = const [],
    this.assetValue,
    this.inventoryValue,
    this.revenueOutstanding,
    this.byCategory = const [],
    this.byVendor = const [],
  });

  factory LedgerSummary.fromJson(Map<String, dynamic> j) {
    final totals = (j['totals'] as Map?) ?? const {};
    final byMonth = (j['by_month'] as List?) ?? const [];
    double? lastSpend;
    if (byMonth.isNotEmpty && byMonth.last is Map) {
      final a = (byMonth.last as Map)['amount'];
      if (a is num) lastSpend = a.toDouble();
    }
    final months = <double>[
      for (final m in byMonth)
        if (m is Map) ((m['net'] ?? m['amount']) as num?)?.toDouble() ?? 0,
    ];
    // Same fallback the frontend uses (Ledger.js line ~1001): if the summary
    // hasn't populated overdue_receivables yet, fall back to top-vendor rows
    // as an interim signal so the panel still has something to show.
    final rawOverdue = (j['overdue_receivables'] as List?)
        ?? (j['by_vendor'] as List?)
        ?? const [];
    final overdue = rawOverdue
        .whereType<Map<String, dynamic>>()
        .map(OverdueReceivable.fromJson)
        .toList();
    return LedgerSummary(
      netProfit: (totals['net_profit'] as num?)?.toDouble(),
      lastMonthSpend: lastSpend,
      revenueBilled: (totals['revenue_billed'] as num?)?.toDouble(),
      revenueReceived: (totals['revenue_received'] as num?)?.toDouble(),
      totalSpend: (totals['total_spend'] as num?)?.toDouble(),
      overdueAmount: ((totals['overdue_amount'] ?? totals['receivables_overdue']) as num?)?.toDouble(),
      overdueCount: ((totals['overdue_count'] ?? totals['receivables_overdue_count']) as num?)?.toInt() ?? 0,
      monthlyNet: months,
      currency: (j['currency'] ?? 'INR').toString(),
      overdueReceivables: overdue,
      assetValue: (totals['asset_value'] as num?)?.toDouble(),
      inventoryValue: (totals['inventory_value'] as num?)?.toDouble(),
      revenueOutstanding: (totals['revenue_outstanding'] as num?)?.toDouble(),
      byCategory: ((j['by_category'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CategorySpend.fromJson)
          .toList(),
      byVendor: ((j['by_vendor'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(VendorSpend.fromJson)
          .toList(),
    );
  }
}

/// One slice of the Spend-by-category donut (GET /ledger/summary → by_category).
class CategorySpend {
  final String category;
  final double amount;
  const CategorySpend({required this.category, required this.amount});
  factory CategorySpend.fromJson(Map<String, dynamic> j) => CategorySpend(
        category: (j['category'] ?? 'Other').toString(),
        amount: (j['amount'] as num?)?.toDouble() ?? 0,
      );
}

/// One row of the Top-vendors-by-spend list (GET /ledger/summary → by_vendor).
class VendorSpend {
  final String vendor;
  final double amount;
  const VendorSpend({required this.vendor, required this.amount});
  factory VendorSpend.fromJson(Map<String, dynamic> j) => VendorSpend(
        vendor: (j['vendor'] ?? '—').toString(),
        amount: (j['amount'] as num?)?.toDouble() ?? 0,
      );
}

/// The AI Finance Brief / Analysis payload (GET /ledger/ai/{scope}).
class FinanceBrief {
  final String headline;
  final List<FinanceInsight> insights;
  final DateTime? generatedAt;
  const FinanceBrief({
    this.headline = '',
    this.insights = const [],
    this.generatedAt,
  });
  factory FinanceBrief.fromJson(Map<String, dynamic> j) => FinanceBrief(
        headline: (j['headline'] ?? '').toString(),
        insights: ((j['insights'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(FinanceInsight.fromJson)
            .toList(),
        generatedAt: DateTime.tryParse('${j['generated_at'] ?? ''}'),
      );
}

/// One Action Item in the AI brief. `level` ∈ high | medium | low.
class FinanceInsight {
  final String level;
  final String title;
  final String detail;
  final String action;
  const FinanceInsight({
    required this.level,
    required this.title,
    this.detail = '',
    this.action = '',
  });
  factory FinanceInsight.fromJson(Map<String, dynamic> j) => FinanceInsight(
        level: () {
          final l = (j['level'] ?? 'medium').toString();
          return (l == 'high' || l == 'medium' || l == 'low') ? l : 'medium';
        }(),
        title: (j['title'] ?? '').toString(),
        detail: (j['detail'] ?? '').toString(),
        action: (j['action'] ?? j['title'] ?? '').toString(),
      );
}

/// A capture in the Inbox review queue (GET /captures?status=…).
class Capture {
  final String id;
  final String status;
  final String summary;
  final String classification;
  final String? explainer; // "why AI routed this"
  final String? text; // extracted text quote
  final double? amount;
  final int? confidence; // 0..100
  final String? fileUrl;
  final String? filename;
  final String? docType; // pdf | image | text …
  final bool needsOwner;
  final String? reviewerRole;
  final String? priority;
  const Capture({
    required this.id,
    required this.status,
    this.summary = '',
    this.classification = '',
    this.explainer,
    this.text,
    this.amount,
    this.confidence,
    this.fileUrl,
    this.filename,
    this.docType,
    this.needsOwner = false,
    this.reviewerRole,
    this.priority,
  });
  factory Capture.fromJson(Map<String, dynamic> j) {
    double? amt;
    // Amount can arrive on the capture or nested in extracted records.
    final rawAmt = j['amount'] ?? j['total_amount'] ?? j['money'];
    if (rawAmt is num) amt = rawAmt.toDouble();
    int? conf;
    final rawConf = j['confidence'] ?? j['ai_confidence'];
    if (rawConf is num) {
      final v = rawConf.toDouble();
      conf = (v <= 1 ? v * 100 : v).round();
    }
    return Capture(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      status: (j['status'] ?? 'pending_review').toString(),
      summary: (j['summary'] ?? j['title'] ?? j['description'] ?? '').toString(),
      classification:
          (j['classification'] ?? j['doc_type'] ?? j['kind'] ?? '').toString(),
      explainer: (j['explainer'] ?? j['why'] ?? j['routing_reason'])?.toString(),
      text: (j['text'] ?? j['extracted_text'] ?? j['quote'])?.toString(),
      amount: amt,
      confidence: conf,
      fileUrl: (j['file_url'] ?? j['url'])?.toString(),
      filename: (j['filename'] ?? j['file_name'])?.toString(),
      docType: (j['doc_type'] ?? j['type'])?.toString(),
      needsOwner: j['needs_owner'] == true || j['needs_owner_approval'] == true,
      reviewerRole: (j['reviewer_role'] ?? j['review_role'])?.toString(),
      priority: j['priority']?.toString(),
    );
  }
}

class OverdueReceivable {
  final String name;
  final int? overdueDays;
  final double amount;
  const OverdueReceivable({required this.name, this.overdueDays, required this.amount});
  factory OverdueReceivable.fromJson(Map<String, dynamic> j) => OverdueReceivable(
        name: (j['contact_name'] ?? j['vendor'] ?? j['name'] ?? '—').toString(),
        overdueDays: (j['overdue_days'] as num?)?.toInt(),
        amount: ((j['balance'] ?? j['amount']) as num?)?.toDouble() ?? 0,
      );
}

/// A revenue entry (invoice line). Shape mirrors `/revenue` response.
class Revenue {
  final String id;
  final String number;        // invoice number, e.g. SBT/25-26/0455
  final String product;       // the invoice line title, e.g. "Indigo lot — 600 m"
  final String contactName;   // the customer
  final double amount;
  final DateTime? date;        // due / invoice date
  final String status;        // paid | unpaid | overdue | partial | awaiting | received
  final bool hasAttachment;
  const Revenue({
    required this.id,
    this.number = '',
    this.product = '',
    this.contactName = '',
    required this.amount,
    this.date,
    required this.status,
  }) : hasAttachment = false;
  const Revenue._({
    required this.id,
    required this.number,
    required this.product,
    required this.contactName,
    required this.amount,
    required this.date,
    required this.status,
    required this.hasAttachment,
  });
  factory Revenue.fromJson(Map<String, dynamic> j) {
    final d = j['due_date'] ?? j['invoice_date'] ?? j['date'] ?? j['created_at'];
    return Revenue._(
      id: (j['id'] ?? '').toString(),
      number: (j['number'] ?? j['invoice_number'] ?? '').toString(),
      product: (j['title'] ?? j['description'] ?? j['line_title'] ?? '—').toString(),
      contactName: (j['contact_name'] ?? j['customer_name'] ?? '').toString(),
      amount: ((j['amount'] ?? j['balance']) as num?)?.toDouble() ?? 0,
      date: d is String ? DateTime.tryParse(d) : null,
      status: (j['status'] ?? 'unpaid').toString(),
      hasAttachment: j['attachment'] != null || j['attachment_url'] != null,
    );
  }
}

/// A recorded expense.
class Expense {
  final String id;
  final String title;
  final String? category;
  final String? vendor;
  final double amount;
  final DateTime? date;
  final String? status; // paid | unpaid | awaiting_bill
  final bool hasAttachment;
  const Expense({
    required this.id,
    required this.title,
    this.category,
    this.vendor,
    required this.amount,
    this.date,
    this.status,
    this.hasAttachment = false,
  });
  factory Expense.fromJson(Map<String, dynamic> j) {
    final d = j['date'] ?? j['created_at'];
    return Expense(
      id: (j['id'] ?? '').toString(),
      title: (j['description'] ?? j['title'] ?? j['vendor_name'] ?? j['vendor'] ?? '—').toString(),
      category: j['category'] as String?,
      vendor: (j['vendor_name'] ?? j['vendor']) as String?,
      amount: (j['amount'] as num?)?.toDouble() ?? 0,
      date: d is String ? DateTime.tryParse(d) : null,
      status: j['status'] as String?,
      hasAttachment: j['attachment'] != null || j['attachment_url'] != null || j['source'] != null,
    );
  }
}

class Asset {
  final String id;
  final String title;
  final String? category;
  final String? vendor;
  final DateTime? boughtDate;
  final String? status; // active | maintenance | disposed
  final bool hasAttachment;
  final double amount;
  const Asset({
    required this.id,
    required this.title,
    this.category,
    this.vendor,
    this.boughtDate,
    this.status,
    this.hasAttachment = false,
    required this.amount,
  });
  factory Asset.fromJson(Map<String, dynamic> j) {
    final d = j['purchase_date'] ?? j['bought_date'] ?? j['date'] ?? j['created_at'];
    return Asset(
      id: (j['id'] ?? '').toString(),
      title: (j['name'] ?? j['title'] ?? j['description'] ?? '—').toString(),
      category: j['category'] as String?,
      vendor: (j['vendor_name'] ?? j['vendor']) as String?,
      boughtDate: d is String ? DateTime.tryParse(d) : null,
      status: j['status'] as String?,
      hasAttachment: j['attachment'] != null || j['attachment_url'] != null,
      amount: ((j['purchase_amount'] ?? j['amount']) as num?)?.toDouble() ?? 0,
    );
  }
}

class InventoryItem {
  final String id;
  final String title;
  final String? sku;
  final String? vendor;
  final String? unit; // pcs, m, kg …
  final double quantity;
  final double? unitCost;
  final double? value; // server-computed value, else quantity × unitCost
  const InventoryItem({
    required this.id,
    required this.title,
    this.sku,
    this.vendor,
    this.unit,
    required this.quantity,
    this.unitCost,
    this.value,
  });
  double get lineValue => value ?? (unitCost ?? 0) * quantity;
  factory InventoryItem.fromJson(Map<String, dynamic> j) => InventoryItem(
        id: (j['id'] ?? '').toString(),
        title: (j['item'] ?? j['name'] ?? j['title'] ?? j['sku'] ?? '—').toString(),
        sku: j['sku'] as String?,
        vendor: (j['vendor_name'] ?? j['vendor']) as String?,
        unit: j['unit'] as String?,
        quantity: (j['quantity'] as num?)?.toDouble() ?? 0,
        unitCost: (j['unit_cost'] as num?)?.toDouble(),
        value: (j['value'] as num?)?.toDouble(),
      );
}

class Person {
  final String id;
  final String name;
  final String? role;
  final String? department;
  final String? phone;
  final String? email;
  final int? score;
  final int? tasksDone;
  final int? tasksOpen;
  final int? tasksOverdue;
  // Team-screen fields (from /users)
  final String inviteStatus; // active | pending | suspended
  final int permissionCount;
  final String? jobTitle;
  final String? avatarUrl;
  final String? about;              // the "what to bring them" blurb
  final String? reportingManagerId; // resolves the "Reports to" row
  final List<String> permissionKeys; // granted areas (effective_permissions)

  Person({
    required this.id,
    required this.name,
    this.role,
    this.department,
    this.phone,
    this.email,
    this.score,
    this.tasksDone,
    this.tasksOpen,
    this.tasksOverdue,
    this.inviteStatus = 'active',
    this.permissionCount = 0,
    this.jobTitle,
    this.avatarUrl,
    this.about,
    this.reportingManagerId,
    this.permissionKeys = const [],
  });

  factory Person.fromJson(Map<String, dynamic> j) {
    // The granted areas: prefer the server-resolved `effective_permissions`
    // list; fall back to a `permissions` list or a {key: bool} map.
    List<String> keys = const [];
    final eff = j['effective_permissions'];
    final raw = j['permissions'];
    if (eff is List) {
      keys = eff.map((e) => e.toString()).toList();
    } else if (raw is List) {
      keys = raw.map((e) => e.toString()).toList();
    } else if (raw is Map) {
      keys = raw.entries
          .where((e) => e.value == true)
          .map((e) => e.key.toString())
          .toList();
    }
    final count = keys.isNotEmpty
        ? keys.length
        : (j['permission_count'] is int ? j['permission_count'] as int : 0);
    return Person(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      name: (j['name'] ?? j['full_name'] ?? j['email'] ?? '').toString(),
      role: j['role'] as String?,
      department: j['department'] as String?,
      phone: j['phone'] as String?,
      email: j['email'] as String?,
      score: j['score'] as int?,
      tasksDone: j['tasks_done'] as int?,
      tasksOpen: j['tasks_open'] as int?,
      tasksOverdue: j['tasks_overdue'] as int?,
      inviteStatus: (j['invite_status'] as String?) ?? 'active',
      permissionCount: count,
      jobTitle: (j['job_title'] ?? j['title']) as String?,
      avatarUrl: (j['avatar_url'] ?? j['avatar'] ?? j['photo_url']) as String?,
      about: j['about'] as String?,
      reportingManagerId: j['reporting_manager_id'] as String?,
      permissionKeys: keys,
    );
  }

  String get initial => name.isNotEmpty ? name[0].toUpperCase() : '?';
}

/// One journaled decision from GET /journal. `dtype` is the category
/// (observation / directive / decision / …) and `status` drives the pill
/// (approved / rejected / pending_approval / …).
class JournalEntry {
  final String id;
  final String dtype;
  final String status;
  final String title;
  const JournalEntry({
    required this.id,
    required this.dtype,
    required this.status,
    required this.title,
  });
  factory JournalEntry.fromJson(Map<String, dynamic> j) => JournalEntry(
        id: (j['id'] ?? '').toString(),
        dtype: (j['dtype'] ?? 'decision').toString(),
        status: (j['status'] ?? '').toString(),
        title: (j['title'] ?? '').toString(),
      );
}

/// A free-form note attached to a day on the CEO Journal.
class JournalNote {
  final String id;
  final String text;
  final String? tag;
  const JournalNote({required this.id, required this.text, this.tag});
  factory JournalNote.fromJson(Map<String, dynamic> j) => JournalNote(
        id: (j['id'] ?? '').toString(),
        text: (j['text'] ?? '').toString(),
        tag: j['tag'] as String?,
      );
}

/// One day bucket on the CEO Journal.
class JournalDay {
  final String date; // yyyy-MM-dd
  final List<JournalEntry> decisions;
  final List<JournalNote> notes;
  const JournalDay(
      {required this.date, required this.decisions, required this.notes});
  factory JournalDay.fromJson(Map<String, dynamic> j) => JournalDay(
        date: (j['date'] ?? '').toString(),
        decisions: ((j['decisions'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(JournalEntry.fromJson)
            .toList(),
        notes: ((j['notes'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(JournalNote.fromJson)
            .toList(),
      );
}

/// GET /journal response — days already grouped and ordered by the server.
class JournalFeed {
  final List<JournalDay> days;
  const JournalFeed({required this.days});
  factory JournalFeed.fromJson(Map<String, dynamic> j) => JournalFeed(
        days: ((j['days'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(JournalDay.fromJson)
            .toList(),
      );
}

/// One event on a decision's timeline (GET /decisions/{id}/timeline).
class DecisionTimelineEvent {
  final String kind;   // captured | proposed | approved | rejected | task | …
  final String label;
  final String? actor;
  final DateTime? ts;
  const DecisionTimelineEvent({
    required this.kind,
    required this.label,
    this.actor,
    this.ts,
  });
  factory DecisionTimelineEvent.fromJson(Map<String, dynamic> j) {
    final t = j['ts'];
    return DecisionTimelineEvent(
      kind: (j['kind'] ?? '').toString(),
      label: (j['label'] ?? '').toString(),
      actor: j['actor'] as String?,
      ts: t is String ? DateTime.tryParse(t) : null,
    );
  }
}

/// The payload behind the "View timeline" dialog on a journal decision card.
class DecisionTimeline {
  final String title;
  final String status;
  final List<DecisionTimelineEvent> events;
  const DecisionTimeline(
      {required this.title, required this.status, required this.events});
  factory DecisionTimeline.fromJson(Map<String, dynamic> j) => DecisionTimeline(
        title: (j['title'] ?? '').toString(),
        status: (j['status'] ?? '').toString(),
        events: ((j['timeline'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(DecisionTimelineEvent.fromJson)
            .toList(),
      );
}

/// A single event on the Business Calendar. Ported from the /calendar
/// payload: type drives icon + tile color + filter bucket. `contactId`
/// determines whether the card is tappable (opens the contact route).
class CalendarEvent {
  final String type; // meeting | payment_due | task | delivery | complaint | birthday | leave
  final String title;
  final String? subtitle;
  final bool overdue;
  final String? contactId;
  final String? refId;

  const CalendarEvent({
    required this.type,
    required this.title,
    this.subtitle,
    this.overdue = false,
    this.contactId,
    this.refId,
  });

  factory CalendarEvent.fromJson(Map<String, dynamic> j) => CalendarEvent(
        type: (j['type'] ?? 'task').toString(),
        title: (j['title'] ?? '').toString(),
        subtitle: j['subtitle'] as String?,
        overdue: j['overdue'] == true,
        contactId: (j['contact_id'])?.toString(),
        refId: (j['ref_id'])?.toString(),
      );
}

/// One day bucket returned by /calendar. `date` is an ISO local-tz yyyy-MM-dd
/// string — the server does the grouping already.
class CalendarDay {
  final String date; // yyyy-MM-dd
  final List<CalendarEvent> events;
  const CalendarDay({required this.date, required this.events});

  factory CalendarDay.fromJson(Map<String, dynamic> j) => CalendarDay(
        date: (j['date'] ?? '').toString(),
        events: ((j['events'] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(CalendarEvent.fromJson)
            .toList(),
      );
}

/// Combined /calendar response — days already sorted ascending, counts per
/// type computed server-side, `total` == counts across all types.
class CalendarFeed {
  final List<CalendarDay> days;
  final Map<String, int> counts;
  final int total;
  const CalendarFeed(
      {required this.days, required this.counts, required this.total});

  factory CalendarFeed.fromJson(Map<String, dynamic> j) {
    final rawCounts = (j['counts'] as Map?) ?? const {};
    return CalendarFeed(
      days: ((j['days'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(CalendarDay.fromJson)
          .toList(),
      counts: rawCounts.map((k, v) => MapEntry(k.toString(), (v as num).toInt())),
      total: (j['total'] as num?)?.toInt() ?? 0,
    );
  }
}

/// One CRM activity row — from `GET /api/crm/activity/{contact_id}`. Kinds
/// are the frontend's exact set: call | meeting | note | whatsapp | email | other.
class CrmActivity {
  final String id;
  final String kind;
  final String text;
  final String? actorName;
  final DateTime? createdAt;
  const CrmActivity({
    required this.id,
    required this.kind,
    required this.text,
    this.actorName,
    this.createdAt,
  });
  factory CrmActivity.fromJson(Map<String, dynamic> j) => CrmActivity(
        id: (j['id'] ?? '').toString(),
        kind: (j['kind'] ?? 'note').toString(),
        text: (j['text'] ?? '').toString(),
        actorName: j['actor_name'] as String?,
        createdAt: j['created_at'] is String
            ? DateTime.tryParse(j['created_at'] as String)
            : null,
      );
}

/// Slim 360°-profile summary rolled up from `GET /api/contacts/{id}/profile`.
/// Full response is much fatter (invoices, payments, workflows, tasks…);
/// this pulls out the pieces the mobile detail screen actually shows.
/// The 360° contact profile (GET /contacts/{id}/profile) — one payload feeding
/// the whole detail screen's accordion sections.
class ContactProfile {
  final Contact contact;
  final double totalBilled;
  final double totalPaid;
  final double outstanding;
  final String? lastPayment;
  final int openComplaints;
  final List<ProfileInvoice> invoices;
  final List<ProfilePayment> payments;
  final List<ProfileLine> workflows; // title + stage
  final List<ProfileDelivery> pendingDeliveries;
  final List<ProfileFollowUp> followUps;
  final List<ProfileTask> tasks;
  final List<ProfileLine> complaints; // title + status
  final List<ProfilePrice> priceHistory;
  final AiRelationship? ai;
  const ContactProfile({
    required this.contact,
    this.totalBilled = 0,
    this.totalPaid = 0,
    this.outstanding = 0,
    this.lastPayment,
    this.openComplaints = 0,
    this.invoices = const [],
    this.payments = const [],
    this.workflows = const [],
    this.pendingDeliveries = const [],
    this.followUps = const [],
    this.tasks = const [],
    this.complaints = const [],
    this.priceHistory = const [],
    this.ai,
  });
  factory ContactProfile.fromJson(Map<String, dynamic> j) {
    final c = (j['contact'] as Map?)?.cast<String, dynamic>() ?? const {};
    final s = (j['summary'] as Map?)?.cast<String, dynamic>() ?? const {};
    List<T> parse<T>(String key, T Function(Map<String, dynamic>) f) =>
        ((j[key] as List?) ?? const [])
            .whereType<Map<String, dynamic>>()
            .map(f)
            .toList();
    return ContactProfile(
      contact: Contact.fromJson(c),
      totalBilled: (s['total_billed'] as num?)?.toDouble() ?? 0,
      totalPaid: (s['total_paid'] as num?)?.toDouble() ?? 0,
      outstanding: (s['outstanding'] as num?)?.toDouble() ?? 0,
      lastPayment: s['last_payment'] as String?,
      openComplaints: (s['open_complaints'] as num?)?.toInt() ?? 0,
      invoices: parse('invoices', ProfileInvoice.fromJson),
      payments: parse('payments', ProfilePayment.fromJson),
      workflows: parse('workflows',
          (m) => ProfileLine((m['title'] ?? 'Workflow').toString(), m['stage']?.toString())),
      pendingDeliveries: parse('pending_deliveries', ProfileDelivery.fromJson),
      followUps: parse('follow_ups', ProfileFollowUp.fromJson),
      tasks: parse('tasks', ProfileTask.fromJson),
      complaints: parse('complaints',
          (m) => ProfileLine((m['title'] ?? m['text'] ?? 'Complaint').toString(), m['status']?.toString())),
      priceHistory: parse('price_history', ProfilePrice.fromJson),
      ai: j['ai_relationship'] is Map
          ? AiRelationship.fromJson((j['ai_relationship'] as Map).cast<String, dynamic>())
          : null,
    );
  }
}

class ProfileInvoice {
  final String number;
  final String? status;
  final String? dueDate;
  final double amount;
  final double paidAmount;
  const ProfileInvoice({
    required this.number,
    this.status,
    this.dueDate,
    this.amount = 0,
    this.paidAmount = 0,
  });
  double get balance => (amount - paidAmount) > 0 ? amount - paidAmount : 0;
  factory ProfileInvoice.fromJson(Map<String, dynamic> j) => ProfileInvoice(
        number: (j['number'] ?? 'Invoice').toString(),
        status: j['status']?.toString(),
        dueDate: j['due_date']?.toString(),
        amount: (j['amount'] as num?)?.toDouble() ?? 0,
        paidAmount: (j['paid_amount'] as num?)?.toDouble() ?? 0,
      );
}

class ProfilePayment {
  final double amount;
  final String? mode;
  final String? reference;
  final String? date;
  const ProfilePayment({this.amount = 0, this.mode, this.reference, this.date});
  factory ProfilePayment.fromJson(Map<String, dynamic> j) => ProfilePayment(
        amount: (j['amount'] as num?)?.toDouble() ?? 0,
        mode: (j['mode'] ?? j['method'])?.toString(),
        reference: j['reference']?.toString(),
        date: j['date']?.toString(),
      );
}

/// A title + a secondary status/stage line (workflows, complaints).
class ProfileLine {
  final String title;
  final String? sub;
  const ProfileLine(this.title, this.sub);
}

class ProfileDelivery {
  final String title;
  final String? dueDate;
  final double? amount;
  const ProfileDelivery({required this.title, this.dueDate, this.amount});
  factory ProfileDelivery.fromJson(Map<String, dynamic> j) => ProfileDelivery(
        title: (j['title'] ?? 'Delivery').toString(),
        dueDate: j['due_date']?.toString(),
        amount: (j['amount'] as num?)?.toDouble(),
      );
}

class ProfileFollowUp {
  final String title;
  final String? ownerName;
  final String? dueDate;
  const ProfileFollowUp({required this.title, this.ownerName, this.dueDate});
  factory ProfileFollowUp.fromJson(Map<String, dynamic> j) => ProfileFollowUp(
        title: (j['title'] ?? 'Follow-up').toString(),
        ownerName: j['owner_name']?.toString(),
        dueDate: j['due_date']?.toString(),
      );
}

class ProfileTask {
  final String id;
  final String title;
  const ProfileTask({required this.id, required this.title});
  factory ProfileTask.fromJson(Map<String, dynamic> j) => ProfileTask(
        id: (j['id'] ?? '').toString(),
        title: (j['title'] ?? 'Task').toString(),
      );
}

class ProfilePrice {
  final String item;
  final double rate;
  final String? unit;
  final String? date;
  const ProfilePrice({required this.item, this.rate = 0, this.unit, this.date});
  factory ProfilePrice.fromJson(Map<String, dynamic> j) => ProfilePrice(
        item: (j['item'] ?? '—').toString(),
        rate: (j['rate'] as num?)?.toDouble() ?? 0,
        unit: j['unit']?.toString(),
        date: j['date']?.toString(),
      );
}

class AiRelationship {
  final int? score;
  final String? reason;
  final List<String> signals;
  const AiRelationship({this.score, this.reason, this.signals = const []});
  factory AiRelationship.fromJson(Map<String, dynamic> j) => AiRelationship(
        score: (j['relationship_score'] as num?)?.toInt(),
        reason: j['reason']?.toString(),
        signals: ((j['signals'] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
      );
}

/// Tenant-configured role — used to group the Team screen and to render the
/// role label ("Sales", "Ops"). Comes from `tenant.roles` on /auth/me.
class TenantRole {
  final String key;
  final String label;
  const TenantRole({required this.key, required this.label});
  factory TenantRole.fromJson(Map<String, dynamic> j) => TenantRole(
        key: (j['key'] ?? j['id'] ?? '').toString(),
        label: (j['label'] ?? j['name'] ?? '').toString(),
      );
}

/// A CRM contact — customer, dealer, or vendor. Ported from the frontend
/// `/contacts` payload used by CRM.js. `type` is `customer` | `dealer` |
/// `vendor`; status is `lead` | `active` | `inactive`.
class Contact {
  final String id;
  final String name;
  final String? company;
  final String type;
  final String status;
  final String? phone;
  final String? email;
  final String? ownerId;
  final String? ownerName;
  final String? address;
  final String? city;
  final String? lifecycleStage;
  final DateTime? touchedAt;

  /// Enrichment fields — merged in after the /contacts fetch.
  final int complaintCount;
  final double receivables;
  final double payables;
  final int oldestDays;

  const Contact({
    required this.id,
    required this.name,
    this.company,
    this.type = 'customer',
    this.status = 'active',
    this.phone,
    this.email,
    this.ownerId,
    this.ownerName,
    this.address,
    this.city,
    this.lifecycleStage,
    this.touchedAt,
    this.complaintCount = 0,
    this.receivables = 0,
    this.payables = 0,
    this.oldestDays = 0,
  });

  /// `customer` and `dealer` both count as buyers; `vendor` = supplier.
  bool get isBuyer => type == 'customer' || type == 'dealer';
  bool get isSupplier => type == 'vendor';

  factory Contact.fromJson(Map<String, dynamic> j) {
    DateTime? parseDate(dynamic v) {
      if (v is String && v.isNotEmpty) return DateTime.tryParse(v);
      return null;
    }
    return Contact(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      name: (j['name'] ?? j['full_name'] ?? '').toString(),
      company: (j['company'] ?? j['company_name']) as String?,
      type: (j['type'] as String?) ?? 'customer',
      status: (j['status'] as String?) ?? 'active',
      phone: j['phone'] as String?,
      email: j['email'] as String?,
      ownerId: (j['owner_id'] ?? j['owner'])?.toString(),
      ownerName: (j['owner_name']) as String?,
      address: j['address'] as String?,
      city: j['city'] as String?,
      lifecycleStage: (j['lifecycle_stage'] ?? j['stage']) as String?,
      touchedAt: parseDate(j['last_touched_at'] ?? j['updated_at']),
    );
  }

  Contact copyWith({
    int? complaintCount,
    double? receivables,
    double? payables,
    int? oldestDays,
    String? ownerName,
  }) {
    return Contact(
      id: id,
      name: name,
      company: company,
      type: type,
      status: status,
      phone: phone,
      email: email,
      ownerId: ownerId,
      ownerName: ownerName ?? this.ownerName,
      address: address,
      city: city,
      lifecycleStage: lifecycleStage,
      touchedAt: touchedAt,
      complaintCount: complaintCount ?? this.complaintCount,
      receivables: receivables ?? this.receivables,
      payables: payables ?? this.payables,
      oldestDays: oldestDays ?? this.oldestDays,
    );
  }
}

class MoneyEntry {
  final String id;
  final String title; // client / vendor / description
  final double amount;
  final DateTime? date;
  final String status; // pending | overdue | completed
  final bool income; // true = receivable/income, false = payable/expense

  MoneyEntry({
    required this.id,
    required this.title,
    required this.amount,
    this.date,
    required this.status,
    required this.income,
  });

  factory MoneyEntry.fromJson(Map<String, dynamic> j) {
    final d = j['date'] ?? j['created_at'];
    return MoneyEntry(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      title: (j['title'] ?? j['description'] ?? j['client'] ?? '').toString(),
      amount: (j['amount'] as num?)?.toDouble() ?? 0,
      date: d is String ? DateTime.tryParse(d) : null,
      status: (j['status'] ?? 'pending').toString(),
      income: (j['type'] ?? j['direction'] ?? 'income').toString() == 'income',
    );
  }
}

/// A workflow-stage task summary — the small pills that live inside a
/// workflow card's body (backend returns them via `?with_tasks=true`).
class WorkflowStageTask {
  final String id;
  final String title;
  final String? assigneeName;
  final String? assigneeRole;
  const WorkflowStageTask({
    required this.id,
    required this.title,
    this.assigneeName,
    this.assigneeRole,
  });
  factory WorkflowStageTask.fromJson(Map<String, dynamic> j) =>
      WorkflowStageTask(
        id: (j['id'] ?? '').toString(),
        title: (j['title'] ?? '').toString(),
        assigneeName: j['assignee_name'] as String?,
        assigneeRole: j['assignee_role'] as String?,
      );

  String get initial {
    final n = assigneeName ?? '';
    if (n.isNotEmpty) return n[0].toUpperCase();
    final r = assigneeRole ?? '';
    if (r.isNotEmpty) return r[0].toUpperCase();
    return '?';
  }
}

/// A single workflow (a job moving through a pipeline). Shape mirrors
/// `backend/routers/workflows.py` output.
class Workflow {
  final String id;
  final String title;
  final String type;                 // pipeline key
  final String stage;                // current stage key
  final List<String> stages;
  final String? counterparty;        // client / vendor name
  final double? amount;
  final List<WorkflowStageTask> stageTasks;
  final DateTime? updatedAt;         // last history entry's `at` or created_at
  final String? updateLabel;         // last history entry's `note` or "Created"
  final DateTime? createdAt;
  final String? decisionId;          // the decision this workflow came from
  final String? decisionTitle;       // hydrated server-side ("From decision: …")

  Workflow({
    required this.id,
    required this.title,
    required this.type,
    required this.stage,
    required this.stages,
    this.counterparty,
    this.amount,
    this.stageTasks = const [],
    this.updatedAt,
    this.updateLabel,
    this.createdAt,
    this.decisionId,
    this.decisionTitle,
  });

  factory Workflow.fromJson(Map<String, dynamic> j) {
    final ca = j['created_at'];
    final history = (j['history'] as List?) ?? const [];
    Map<String, dynamic>? last;
    if (history.isNotEmpty && history.last is Map) {
      last = (history.last as Map).cast<String, dynamic>();
    }
    final upAt = last?['at'] ?? ca;
    return Workflow(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      title: (j['title'] ?? '').toString(),
      type: (j['type'] ?? '').toString(),
      stage: (j['stage'] ?? '').toString(),
      stages: ((j['stages'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      counterparty: j['counterparty'] as String?
          ?? j['customer_name'] as String?
          ?? j['vendor_name'] as String?,
      amount: (j['amount'] as num?)?.toDouble(),
      stageTasks: ((j['stage_tasks'] as List?) ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(WorkflowStageTask.fromJson)
          .toList(),
      updatedAt: upAt is String ? DateTime.tryParse(upAt) : null,
      updateLabel: (last?['note'] as String?) ?? 'Created',
      createdAt: ca is String ? DateTime.tryParse(ca) : null,
      decisionId: j['decision_id'] as String?,
      decisionTitle: j['decision_title'] as String?,
    );
  }
}

/// A single leave request. Statuses match the backend: pending, approved,
/// rejected, info_requested, cancelled.
class LeaveRequest {
  final String id;
  final String userName;
  final String leaveType; // sick | casual | earned | ...
  final String dayPortion; // full | half
  final bool isEmergency;
  final String status;
  final String? reason;
  final DateTime? fromDate;
  final DateTime? toDate;
  final DateTime? createdAt;
  final String? approverName;
  final String? infoNote;

  LeaveRequest({
    required this.id,
    required this.userName,
    required this.leaveType,
    required this.dayPortion,
    required this.isEmergency,
    required this.status,
    this.reason,
    this.fromDate,
    this.toDate,
    this.createdAt,
    this.approverName,
    this.infoNote,
  });

  factory LeaveRequest.fromJson(Map<String, dynamic> j) {
    DateTime? parse(dynamic v) => v is String ? DateTime.tryParse(v) : null;
    return LeaveRequest(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      userName: (j['user_name'] ?? '—').toString(),
      leaveType: (j['leave_type'] ?? 'casual').toString(),
      dayPortion: (j['day_portion'] ?? 'full').toString(),
      isEmergency: (j['is_emergency'] as bool?) ?? false,
      status: (j['status'] ?? 'pending').toString(),
      reason: j['reason'] as String?,
      fromDate: parse(j['from_date']),
      toDate: parse(j['to_date']),
      createdAt: parse(j['created_at']),
      approverName: j['approver_name'] as String?,
      infoNote: j['info_note'] as String?,
    );
  }
}

/// A workflow pipeline definition (from tenant.operating_model.pipelines).
/// Each pipeline has a key + display label + optional sub caption + stages.
class Pipeline {
  final String key;
  final String label;
  final String? sub;
  final List<String> stages;
  final Map<String, String> stageLabels; // stage key → display label
  const Pipeline({
    required this.key,
    required this.label,
    this.sub,
    this.stages = const [],
    this.stageLabels = const {},
  });

  /// The display label for a stage key — the tenant's label if present,
  /// else the key word-cased with underscores turned to spaces.
  String labelForStage(String key) {
    final l = stageLabels[key];
    if (l != null && l.isNotEmpty) return l;
    return key
        .split(RegExp(r'[_\s]+'))
        .map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1))
        .join(' ');
  }

  factory Pipeline.fromJson(Map<String, dynamic> j) {
    final rawStages =
        ((j['stages'] as List?) ?? const []).whereType<Map>().toList();
    final keys = <String>[];
    final labels = <String, String>{};
    for (final s in rawStages) {
      final k = (s['key'] ?? '').toString();
      if (k.isEmpty) continue;
      keys.add(k);
      final l = (s['label'] ?? '').toString();
      if (l.isNotEmpty) labels[k] = l;
    }
    return Pipeline(
      key: (j['key'] ?? '').toString(),
      label: (j['label'] ?? '').toString(),
      sub: j['sub'] as String?,
      stages: keys,
      stageLabels: labels,
    );
  }

  /// Fallback pipelines (matches frontend `DEFAULT_OPERATING_MODEL.pipelines`)
  /// used when the backend hasn't populated the tenant yet.
  static const List<Pipeline> defaults = [
    Pipeline(key: 'production', label: 'Production'),
    Pipeline(key: 'distribution', label: 'Distribution'),
    Pipeline(key: 'purchase_payment', label: 'Procurement'),
  ];
}

class AppNotification {
  final String id;
  final String title;
  final String? body;
  final DateTime? at;
  final String? kind; // task | decision | mention | system
  final bool read;

  AppNotification({
    required this.id,
    required this.title,
    this.body,
    this.at,
    this.kind,
    this.read = false,
  });

  factory AppNotification.fromJson(Map<String, dynamic> j) {
    final t = j['created_at'] ?? j['at'];
    return AppNotification(
      id: (j['id'] ?? j['_id'] ?? '').toString(),
      title: (j['title'] ?? j['message'] ?? '').toString(),
      body: j['body'] as String?,
      at: t is String ? DateTime.tryParse(t) : null,
      kind: j['kind'] as String?,
      read: (j['read'] as bool?) ?? false,
    );
  }
}
