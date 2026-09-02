import 'package:flutter/material.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/neumorphic.dart';
import '../widgets/sparkline.dart';
import '../widgets/states.dart';

/// The Money (finance) screen — ported from frontend/src/pages/Ledger.js.
///
/// Layout mirrors the mobile Ledger:
///   • header: "Money" + "Money in one place" subtitle
///   • horizontally-snapping tab rail with 6 pills (Overview / Revenue /
///     Expenses / Assets / Inventory / Inbox)
///   • capture-hero row: 4 quick upload chips + pending inbox pill
///   • tab body:
///       overview  → net-profit hero + 2×2 KPI grid + view-all pill +
///                   cash-flow-needs-attention panel
///       revenue   → invoice cards (client, amount, status, due)
///       expenses  → placeholder AI card + expense list
///       assets    → placeholder AI card + asset list
///       inventory → placeholder AI card + inventory list
///       inbox     → capture review queue placeholder
///
/// Tab switching is instant (each tab's future is cached). Guards against
/// past bugs: block-syntax setState, no Expanded inside unbounded columns,
/// no scroll controller collisions.
class MoneyScreen extends StatefulWidget {
  const MoneyScreen({super.key});
  @override
  State<MoneyScreen> createState() => _MoneyScreenState();
}

class _MoneyScreenState extends State<MoneyScreen> {
  String _tab = 'overview';

  // Cached futures — one per tab, populated lazily on first visit so tab
  // switching is a pure `setState`, not a network round-trip.
  late Future<LedgerSummary> _summaryFuture;
  Future<List<Revenue>>? _revenueFuture;
  Future<List<Expense>>? _expensesFuture;
  Future<List<Asset>>? _assetsFuture;
  Future<List<InventoryItem>>? _inventoryFuture;
  Future<int>? _pendingFuture;

  @override
  void initState() {
    super.initState();
    _summaryFuture = MoneyRepository().summary();
    _pendingFuture = MoneyRepository().pendingCaptureCount();
  }

  void _setTab(String t) {
    if (t == _tab) return;
    setState(() {
      _tab = t;
    });
    // Lazy-fetch the tab's data on first visit.
    switch (t) {
      case 'revenue':
        _revenueFuture ??= MoneyRepository().revenue();
        break;
      case 'expenses':
        _expensesFuture ??= MoneyRepository().expenses();
        break;
      case 'assets':
        _assetsFuture ??= MoneyRepository().assets();
        break;
      case 'inventory':
        _inventoryFuture ??= MoneyRepository().inventory();
        break;
    }
  }

  /// Refresh every fetch after a mutation — expense/asset/inventory adds
  /// or capture approve/reject can move numbers across tabs, so we clear
  /// the cached futures and re-fetch the currently-visible one plus the
  /// summary (which powers Overview KPIs).
  void _refresh() {
    setState(() {
      _summaryFuture = MoneyRepository().summary();
      _pendingFuture = MoneyRepository().pendingCaptureCount();
      _revenueFuture = null;
      _expensesFuture = null;
      _assetsFuture = null;
      _inventoryFuture = null;
    });
    // Warm the visible tab immediately.
    switch (_tab) {
      case 'revenue':
        _revenueFuture = MoneyRepository().revenue();
        break;
      case 'expenses':
        _expensesFuture = MoneyRepository().expenses();
        break;
      case 'assets':
        _assetsFuture = MoneyRepository().assets();
        break;
      case 'inventory':
        _inventoryFuture = MoneyRepository().inventory();
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const AppHeader(),
        Expanded(
          child: SingleChildScrollView(
            physics: const ClampingScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(0, 0, 0, 120),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                  child: _Title(),
                ),
                const SizedBox(height: AppSpacing.lg),
                _TabRail(active: _tab, onSelect: _setTab),
                const SizedBox(height: AppSpacing.lg),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                  child: _CaptureHero(
                    pendingFuture: _pendingFuture!,
                    onRefresh: _refresh,
                    onTabChange: _setTab,
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
                  child: _TabBody(
                    tab: _tab,
                    summaryFuture: _summaryFuture,
                    revenueFuture: _revenueFuture,
                    expensesFuture: _expensesFuture,
                    assetsFuture: _assetsFuture,
                    inventoryFuture: _inventoryFuture,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

class _Title extends StatelessWidget {
  const _Title();
  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Finance',
            style: AppText.display().copyWith(fontSize: 30, height: 1.05)),
        const SizedBox(height: 6),
        Text('Money in one place',
            style: AppText.small().copyWith(color: AppColors.textSecondary)),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6-tab horizontal snap rail (KM-4)
// ─────────────────────────────────────────────────────────────────────────────

class _TabRail extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  const _TabRail({required this.active, required this.onSelect});

  static const _tabs = <(String, String, IconData)>[
    ('overview', 'Overview', Icons.auto_awesome_rounded),
    ('revenue', 'Revenue', Icons.attach_money_rounded),
    ('expenses', 'Expenses', Icons.receipt_long_outlined),
    ('assets', 'Assets', Icons.apartment_rounded),
    ('inventory', 'Inventory', Icons.inventory_2_outlined),
    ('inbox', 'Inbox', Icons.inbox_outlined),
  ];

  @override
  Widget build(BuildContext context) {
    // All 6 pills fit within the screen width via `Expanded` (equal-width
    // segments). Each pill wears the KrPop / KrPressed neumorphic material,
    // stacked icon-over-label so the row stays compact.
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Row(
        children: [
          for (int i = 0; i < _tabs.length; i++) ...[
            Expanded(
              child: _TabPill(
                label: _tabs[i].$2,
                icon: _tabs[i].$3,
                active: _tabs[i].$1 == active,
                onTap: () => onSelect(_tabs[i].$1),
              ),
            ),
            if (i != _tabs.length - 1) const SizedBox(width: 5),
          ],
        ],
      ),
    );
  }
}

class _TabPill extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;
  const _TabPill({
    required this.label,
    required this.icon,
    required this.active,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final child = Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 14, color: AppColors.textPrimary),
        const SizedBox(height: 2),
        Text(
          label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.small().copyWith(
            fontSize: 10,
            fontWeight: active ? FontWeight.w700 : FontWeight.w500,
            color: AppColors.textPrimary.withValues(alpha: active ? 1 : 0.7),
          ),
        ),
      ]),
    );
    return active
        ? KrPressed(
            borderRadius: BorderRadius.circular(AppRadius.md),
            onTap: onTap,
            child: child,
          )
        : KrPop(
            borderRadius: BorderRadius.circular(AppRadius.md),
            onTap: onTap,
            child: child,
          );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Capture hero — 4 upload chips + pending count pill
// ─────────────────────────────────────────────────────────────────────────────

class _CaptureHero extends StatelessWidget {
  final Future<int> pendingFuture;
  final VoidCallback onRefresh;
  final ValueChanged<String> onTabChange;
  const _CaptureHero({
    required this.pendingFuture,
    required this.onRefresh,
    required this.onTabChange,
  });

  // Four tinted-icon tiles matching the frontend Capture Hero row —
  // Upload bill/receipt (orange PDF) · Scan receipt (green camera) · Add
  // expense (purple plus) · CSV/Excel Export (blue upload). All sit inside
  // ONE white card, tapping any triggers the corresponding capture flow.
  static const _tiles = <(String, String, IconData, Color, Color)>[
    ('Upload bill', '/receipt', Icons.picture_as_pdf_rounded,
        Color(0xFFFDE5CC), Color(0xFFEA580C)),
    ('Scan', 'receipt', Icons.photo_camera_outlined,
        Color(0xFFD3F5DF), Color(0xFF16A34A)),
    ('Add', 'expense', Icons.add_rounded,
        Color(0xFFEADFF9), Color(0xFF7C3AED)),
    ('CSV /Excel', 'Export', Icons.upload_rounded,
        Color(0xFFDCE7F8), Color(0xFF2563EB)),
  ];

  Future<void> _onTileTap(BuildContext context, int i) async {
    switch (i) {
      case 0: // Upload bill /receipt
      case 1: // Scan receipt
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text(
                  'File uploads need the file_picker package — add it to pubspec.yaml to enable /ingest/document from mobile.')),
        );
        break;
      case 2: // Add expense — real form
        final saved = await showModalBottomSheet<bool>(
          context: context,
          isScrollControlled: true,
          backgroundColor: AppColors.surface,
          shape: const RoundedRectangleBorder(
            borderRadius:
                BorderRadius.vertical(top: Radius.circular(AppRadius.lg)),
          ),
          builder: (_) => const _AddExpenseSheet(),
        );
        if (saved == true) onRefresh();
        break;
      case 3: // CSV/Excel export
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text(
                  'CSV import needs the file_picker package — add it to pubspec.yaml to enable /ingest/csv.')),
        );
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KrPop(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md, vertical: AppSpacing.lg),
          child: Row(
            children: [
              for (int i = 0; i < _tiles.length; i++)
                Expanded(
                  child: _CaptureTile(
                    label: _tiles[i].$1,
                    sub: _tiles[i].$2,
                    icon: _tiles[i].$3,
                    bg: _tiles[i].$4,
                    fg: _tiles[i].$5,
                    onTap: () => _onTileTap(context, i),
                  ),
                ),
            ],
          ),
        ),
        // "N in Inbox →" pending pill — only rendered when there's a queue.
        FutureBuilder<int>(
          future: pendingFuture,
          builder: (context, snap) {
            final count = snap.data ?? 0;
            if (count == 0) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: Align(
                alignment: Alignment.centerRight,
                child: InkWell(
                  onTap: () => onTabChange('inbox'),
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.brandBg,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Text('$count in Inbox',
                          style: AppText.smallStrong().copyWith(
                              fontSize: 11, color: AppColors.brandDeep)),
                      const SizedBox(width: 4),
                      const Icon(Icons.arrow_forward_rounded,
                          size: 12, color: AppColors.brandDeep),
                    ]),
                  ),
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

class _CaptureTile extends StatelessWidget {
  final String label;
  final String sub;
  final IconData icon;
  final Color bg;
  final Color fg;
  final VoidCallback onTap;
  const _CaptureTile({
    required this.label,
    required this.sub,
    required this.icon,
    required this.bg,
    required this.fg,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.md),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              width: 40, height: 40,
              decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: Icon(icon, size: 18, color: fg),
            ),
            const SizedBox(height: 8),
            Text(label,
                style: AppText.smallStrong().copyWith(fontSize: 11),
                maxLines: 1, overflow: TextOverflow.ellipsis),
            Text(sub,
                style: AppText.small().copyWith(
                    fontSize: 10, color: AppColors.textSecondary),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab body dispatcher
// ─────────────────────────────────────────────────────────────────────────────

class _TabBody extends StatelessWidget {
  final String tab;
  final Future<LedgerSummary> summaryFuture;
  final Future<List<Revenue>>? revenueFuture;
  final Future<List<Expense>>? expensesFuture;
  final Future<List<Asset>>? assetsFuture;
  final Future<List<InventoryItem>>? inventoryFuture;
  const _TabBody({
    required this.tab,
    required this.summaryFuture,
    required this.revenueFuture,
    required this.expensesFuture,
    required this.assetsFuture,
    required this.inventoryFuture,
  });

  @override
  Widget build(BuildContext context) {
    switch (tab) {
      case 'overview':
        return _OverviewBody(summaryFuture: summaryFuture);
      case 'revenue':
        return _RevenueBody(future: revenueFuture!);
      case 'expenses':
        return _ExpensesBody(future: expensesFuture!);
      case 'assets':
        return _AssetsBody(future: assetsFuture!);
      case 'inventory':
        return _InventoryBody(future: inventoryFuture!);
      case 'inbox':
        return const _InboxPlaceholder();
    }
    return const SizedBox();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview — hero + 2x2 KPI + view-all + cash-flow panel
// ─────────────────────────────────────────────────────────────────────────────

String _rupee(double v) {
  final a = v.abs();
  final sign = v < 0 ? '-' : '';
  if (a >= 10000000) return '$sign₹${(a / 10000000).toStringAsFixed(1)}Cr';
  if (a >= 100000) return '$sign₹${(a / 100000).toStringAsFixed(1)}L';
  if (a >= 1000) return '$sign₹${(a / 1000).toStringAsFixed(1)}K';
  return '$sign₹${a.toStringAsFixed(0)}';
}

class _OverviewBody extends StatelessWidget {
  final Future<LedgerSummary> summaryFuture;
  const _OverviewBody({required this.summaryFuture});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<LedgerSummary>(
      future: summaryFuture,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Column(children: [
            LoadingCard(height: 100),
            SizedBox(height: 12),
            LoadingCard(height: 160),
          ]);
        }
        if (snap.hasError) {
          return const ErrorState(message: 'Could not load your ledger summary.');
        }
        final s = snap.data ?? LedgerSummary();
        final net = s.netProfit ?? 0;
        final monthly = s.monthlyNet;
        double trendPct = 0;
        if (monthly.length >= 2) {
          final prev = monthly[monthly.length - 2];
          final curr = monthly.last;
          if (prev != 0) trendPct = ((curr - prev) / prev.abs()) * 100;
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _NetProfitHero(net: net, monthly: monthly, trendPct: trendPct),
            const SizedBox(height: AppSpacing.md),
            _KpiGrid(s: s),
            const SizedBox(height: AppSpacing.md),
            _ViewAllButton(),
            if (s.overdueReceivables.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _CashFlowPanel(s: s),
            ],
            const SizedBox(height: AppSpacing.md),
            const _AskAiPanel(),
            const SizedBox(height: AppSpacing.md),
            const _AutoFlowFooter(),
          ],
        );
      },
    );
  }
}

class _NetProfitHero extends StatelessWidget {
  final double net;
  final List<double> monthly;
  final double trendPct;
  const _NetProfitHero({required this.net, required this.monthly, required this.trendPct});
  @override
  Widget build(BuildContext context) {
    final up = trendPct >= 0;
    // Fallback tiny series so the graph still reads as a shape when the
    // backend hasn't populated by_month yet. Not a chart — a decorative cue
    // that reflects the trend direction we already show as %.
    final series = monthly.length >= 2
        ? monthly
        : [1.0, 1.2, 0.9, 1.4, 1.1, 1.6];
    final green = const Color(0xFF16A34A);
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Stack(children: [
        // Green sparkline runs behind the number.
        Positioned(
          top: 12, right: 60,
          child: SizedBox(
            width: 130, height: 64,
            child: Sparkline(points: series, color: green, strokeWidth: 2.2),
          ),
        ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Net profit',
                      style: AppText.smallStrong().copyWith(fontSize: 13)),
                  const SizedBox(height: 8),
                  Text(_rupee(net),
                      style: AppText.display().copyWith(fontSize: 30, height: 1)),
                  const SizedBox(height: 8),
                  Row(children: [
                    Icon(up ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
                        size: 12,
                        color: up ? const Color(0xFF16A34A) : AppColors.brand),
                    const SizedBox(width: 2),
                    Text('${trendPct.abs().toStringAsFixed(1)}%',
                        style: AppText.smallStrong().copyWith(
                            fontSize: 11,
                            color: up ? const Color(0xFF16A34A) : AppColors.brand)),
                    const SizedBox(width: 6),
                    Text('this month',
                        style: AppText.small().copyWith(
                            fontSize: 11, color: AppColors.textSecondary)),
                  ]),
                ],
              ),
            ),
            Container(
              width: 36, height: 36,
              decoration: const BoxDecoration(
                color: AppColors.textPrimary,
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.arrow_forward_rounded,
                  size: 14, color: Colors.white),
            ),
          ],
        ),
      ]),
    );
  }
}

class _KpiGrid extends StatelessWidget {
  final LedgerSummary s;
  const _KpiGrid({required this.s});
  @override
  Widget build(BuildContext context) {
    // Trend for revenue: last month vs previous.
    double? trend;
    if (s.monthlyNet.length >= 2) {
      final curr = s.monthlyNet.last;
      final prev = s.monthlyNet[s.monthlyNet.length - 2];
      if (prev != 0) trend = ((curr - prev) / prev.abs()) * 100;
    }
    return Column(children: [
      Row(children: [
        Expanded(
          child: _KpiCard(
            label: 'Revenue',
            value: s.revenueBilled == null ? '—' : _rupee(s.revenueBilled!),
            icon: Icons.attach_money_rounded,
            bg: const Color(0xFFD3F5DF),
            fg: const Color(0xFF16A34A),
            trend: trend,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _KpiCard(
            label: 'Received',
            value: s.revenueReceived == null ? '—' : _rupee(s.revenueReceived!),
            icon: Icons.chat_bubble_outline_rounded,
            bg: const Color(0xFFDCE7F8),
            fg: const Color(0xFF2563EB),
          ),
        ),
      ]),
      const SizedBox(height: 10),
      Row(children: [
        Expanded(
          child: _KpiCard(
            label: 'Total spend',
            value: s.totalSpend == null ? '—' : _rupee(s.totalSpend!),
            icon: Icons.trending_up_rounded,
            bg: const Color(0xFFFDE1E5),
            fg: const Color(0xFFE11D48),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _KpiCard(
            label: 'Overdue amount',
            value: s.overdueAmount == null ? '₹0' : _rupee(s.overdueAmount!),
            icon: Icons.error_outline_rounded,
            bg: const Color(0xFFFDE5CC),
            fg: const Color(0xFFEA580C),
            note: s.overdueCount > 0
                ? '${s.overdueCount} overdue invoice${s.overdueCount == 1 ? '' : 's'}'
                : 'No overdue',
            urgent: (s.overdueAmount ?? 0) > 0,
          ),
        ),
      ]),
    ]);
  }
}

class _KpiCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color bg;
  final Color fg;
  final bool urgent;
  final double? trend;
  final String? note;
  const _KpiCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.bg,
    required this.fg,
    this.urgent = false,
    this.trend,
    this.note,
  });
  @override
  Widget build(BuildContext context) {
    final up = (trend ?? 0) >= 0;
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 34, height: 34,
              decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: Icon(icon, size: 16, color: fg),
            ),
            const Spacer(),
            const Icon(Icons.chevron_right_rounded,
                size: 16, color: AppColors.textTertiary),
          ]),
          const SizedBox(height: 12),
          Text(label,
              style: AppText.small().copyWith(fontSize: 12, color: AppColors.textSecondary),
              maxLines: 1, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 4),
          Text(value,
              style: AppText.h3().copyWith(
                fontSize: 18,
                height: 1.1,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
              maxLines: 1, overflow: TextOverflow.ellipsis),
          if (trend != null) ...[
            const SizedBox(height: 6),
            Row(children: [
              Icon(up ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
                  size: 11,
                  color: up ? const Color(0xFF16A34A) : AppColors.brand),
              const SizedBox(width: 2),
              Text('${trend!.abs().toStringAsFixed(1)}%',
                  style: AppText.smallStrong().copyWith(
                    fontSize: 11,
                    color: up ? const Color(0xFF16A34A) : AppColors.brand,
                  )),
              const SizedBox(width: 4),
              Text('this month',
                  style: AppText.small().copyWith(
                      fontSize: 10, color: AppColors.textSecondary)),
            ]),
          ],
          if (note != null) ...[
            const SizedBox(height: 6),
            Text(note!,
                style: AppText.small().copyWith(
                    fontSize: 11,
                    color: urgent ? AppColors.brand : AppColors.textSecondary),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ],
        ],
      ),
    );
  }
}

class _ViewAllButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.symmetric(vertical: 14),
      onTap: () {},
      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text('View all financials',
            style: AppText.smallStrong().copyWith(fontSize: 13)),
        const SizedBox(width: 6),
        const Icon(Icons.arrow_forward_rounded, size: 14, color: AppColors.textPrimary),
      ]),
    );
  }
}

class _CashFlowPanel extends StatelessWidget {
  final LedgerSummary s;
  const _CashFlowPanel({required this.s});
  @override
  Widget build(BuildContext context) {
    final double total = s.overdueAmount ??
        s.overdueReceivables.fold<double>(0.0, (a, r) => a + r.amount);
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.brand.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border(left: BorderSide(color: AppColors.brand, width: 3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(Icons.warning_amber_rounded,
                  size: 20, color: AppColors.brand),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Cash flow needs attention',
                        style: AppText.bodyStrong().copyWith(fontSize: 14)),
                    const SizedBox(height: 2),
                    Text('${_rupee(total)} is stuck outside',
                        style: AppText.small().copyWith(color: AppColors.textSecondary)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.06),
                      offset: const Offset(0, 1),
                      blurRadius: 2,
                    ),
                  ],
                ),
                child: Text('View all',
                    style: AppText.smallStrong().copyWith(fontSize: 11)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (final r in s.overdueReceivables.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                ),
                child: Row(children: [
                  Container(
                    width: 30, height: 30,
                    decoration: BoxDecoration(
                      color: AppColors.brandBg,
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: const Icon(Icons.apartment_rounded,
                        size: 14, color: AppColors.brand),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(r.name,
                            style: AppText.smallStrong().copyWith(fontSize: 13),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                        Text(
                          r.overdueDays != null
                              ? 'Overdue ${r.overdueDays}+ days'
                              : 'Outstanding',
                          style: AppText.small().copyWith(
                              fontSize: 11, color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(_rupee(r.amount),
                      style: AppText.smallStrong().copyWith(
                          color: AppColors.brand,
                          fontFeatures: const [FontFeature.tabularFigures()])),
                  const SizedBox(width: 6),
                  const Icon(Icons.chevron_right_rounded,
                      size: 14, color: AppColors.textTertiary),
                ]),
              ),
            ),
          // Footer link — "View all N+ action items →" in accent orange.
          if (s.overdueReceivables.length > 3 ||
              s.overdueReceivables.isNotEmpty) ...[
            const SizedBox(height: 6),
            Row(children: [
              Text(
                'View all ${s.overdueReceivables.length}+ action items',
                style: AppText.smallStrong().copyWith(
                    fontSize: 12, color: AppColors.brand),
              ),
              const SizedBox(width: 4),
              const Icon(Icons.arrow_forward_rounded,
                  size: 12, color: AppColors.brand),
            ]),
          ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Revenue tab
// ─────────────────────────────────────────────────────────────────────────────

class _RevenueBody extends StatelessWidget {
  final Future<List<Revenue>> future;
  const _RevenueBody({required this.future});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Revenue>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 120);
        }
        if (snap.hasError) return const ErrorState(message: 'Could not load revenue.');
        final items = snap.data ?? const <Revenue>[];
        if (items.isEmpty) {
          return const EmptyState(
            icon: Icons.attach_money_rounded,
            title: 'No revenue yet',
            subtitle: 'Invoices you send will show up here.',
          );
        }
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (final r in items)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                child: _MoneyRowCard(
                  title: r.title,
                  meta: r.date == null
                      ? null
                      : 'Due ${r.date!.day}/${r.date!.month}',
                  status: r.status,
                  amount: r.amount,
                  income: r.status.toLowerCase() != 'overdue',
                ),
              ),
          ],
        );
      },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expenses / Assets / Inventory / Inbox
// ─────────────────────────────────────────────────────────────────────────────

class _ExpensesBody extends StatelessWidget {
  final Future<List<Expense>> future;
  const _ExpensesBody({required this.future});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Expense>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 120);
        }
        if (snap.hasError) return const ErrorState(message: 'Could not load expenses.');
        final items = snap.data ?? const <Expense>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _AiInsightPlaceholder(scope: 'expenses'),
            const SizedBox(height: AppSpacing.md),
            if (items.isEmpty)
              const EmptyState(
                icon: Icons.receipt_long_outlined,
                title: 'No expenses yet',
                subtitle: 'Captured bills and expenses will appear here.',
              )
            else
              for (final e in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: _MoneyRowCard(
                    title: e.title,
                    meta: e.category,
                    amount: e.amount,
                    income: false,
                  ),
                ),
          ],
        );
      },
    );
  }
}

class _AssetsBody extends StatelessWidget {
  final Future<List<Asset>> future;
  const _AssetsBody({required this.future});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Asset>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const LoadingCard(height: 120);
        if (snap.hasError) return const ErrorState(message: 'Could not load assets.');
        final items = snap.data ?? const <Asset>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _AiInsightPlaceholder(scope: 'assets'),
            const SizedBox(height: AppSpacing.md),
            if (items.isEmpty)
              const EmptyState(
                icon: Icons.apartment_rounded,
                title: 'No assets yet',
                subtitle: 'Long-term purchases will appear here.',
              )
            else
              for (final a in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: _MoneyRowCard(
                    title: a.title,
                    meta: a.category,
                    amount: a.amount,
                    income: false,
                  ),
                ),
          ],
        );
      },
    );
  }
}

class _InventoryBody extends StatelessWidget {
  final Future<List<InventoryItem>> future;
  const _InventoryBody({required this.future});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<InventoryItem>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) return const LoadingCard(height: 120);
        if (snap.hasError) return const ErrorState(message: 'Could not load inventory.');
        final items = snap.data ?? const <InventoryItem>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const _AiInsightPlaceholder(scope: 'inventory'),
            const SizedBox(height: AppSpacing.md),
            if (items.isEmpty)
              const EmptyState(
                icon: Icons.inventory_2_outlined,
                title: 'No inventory yet',
                subtitle: 'Stock items will appear here.',
              )
            else
              for (final i in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: _MoneyRowCard(
                    title: i.title,
                    meta: 'Qty ${i.quantity.toStringAsFixed(0)}',
                    amount: (i.unitCost ?? 0) * i.quantity,
                    income: true,
                  ),
                ),
          ],
        );
      },
    );
  }
}

class _InboxPlaceholder extends StatelessWidget {
  const _InboxPlaceholder();
  @override
  Widget build(BuildContext context) {
    return const EmptyState(
      icon: Icons.inbox_outlined,
      title: 'Capture inbox',
      subtitle: 'Uploaded receipts land here for you to confirm before they hit the books.',
    );
  }
}

/// A generic finance row card. Used by Revenue / Expenses / Assets /
/// Inventory. Amount right-aligned, colour reflects income vs expense.
class _MoneyRowCard extends StatelessWidget {
  final String title;
  final String? meta;
  final String? status;
  final double amount;
  final bool income;
  const _MoneyRowCard({
    required this.title,
    this.meta,
    this.status,
    required this.amount,
    required this.income,
  });
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title,
                    style: AppText.bodyStrong().copyWith(fontSize: 14),
                    maxLines: 1, overflow: TextOverflow.ellipsis),
                if ((meta ?? '').isNotEmpty || status != null) ...[
                  const SizedBox(height: 4),
                  Row(children: [
                    if (status != null) ...[
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: status!.toLowerCase() == 'overdue'
                              ? AppColors.brandBg
                              : AppColors.surfaceMuted,
                          borderRadius: BorderRadius.circular(AppRadius.pill),
                        ),
                        child: Text(
                          status![0].toUpperCase() + status!.substring(1),
                          style: AppText.small().copyWith(
                            fontSize: 11,
                            color: status!.toLowerCase() == 'overdue'
                                ? AppColors.brand
                                : AppColors.textSecondary,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                    ],
                    if ((meta ?? '').isNotEmpty)
                      Flexible(
                        child: Text(meta!,
                            style: AppText.small().copyWith(
                                fontSize: 12, color: AppColors.textSecondary),
                            maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                  ]),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text('${income ? '+' : '−'} ${_rupee(amount)}',
              style: AppText.smallStrong().copyWith(
                fontSize: 13,
                color: income ? const Color(0xFF16A34A) : AppColors.brand,
                fontFeatures: const [FontFeature.tabularFigures()],
              )),
        ],
      ),
    );
  }
}

class _AiInsightPlaceholder extends StatelessWidget {
  final String scope;
  const _AiInsightPlaceholder({required this.scope});
  @override
  Widget build(BuildContext context) {
    return KrPressed(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(children: [
        Container(
          width: 32, height: 32,
          decoration: BoxDecoration(
            color: AppColors.brandBg,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: const Icon(Icons.auto_awesome_rounded,
              size: 15, color: AppColors.brand),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Dex insights',
                  style: AppText.smallStrong().copyWith(fontSize: 12)),
              Text('Ask Dex about your $scope',
                  style: AppText.small().copyWith(
                      fontSize: 11, color: AppColors.textSecondary)),
            ],
          ),
        ),
      ]),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ask AI + auto-flow footer
// ─────────────────────────────────────────────────────────────────────────────

class _AskAiPanel extends StatefulWidget {
  const _AskAiPanel();
  @override
  State<_AskAiPanel> createState() => _AskAiPanelState();
}

class _AskAiPanelState extends State<_AskAiPanel> {
  final _ctrl = TextEditingController();
  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 32, height: 32,
              decoration: BoxDecoration(
                color: const Color(0xFFEADFF9),
                shape: BoxShape.circle,
              ),
              alignment: Alignment.center,
              child: const Icon(Icons.auto_awesome_rounded,
                  size: 15, color: Color(0xFF7C3AED)),
            ),
            const SizedBox(width: 10),
            Text('Ask AI about your finances',
                style: AppText.bodyStrong().copyWith(fontSize: 14)),
          ]),
          const SizedBox(height: AppSpacing.md),
          // Text field + dark round send button.
          Container(
            padding: const EdgeInsets.only(left: 14, right: 4, top: 4, bottom: 4),
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              border: Border.all(color: AppColors.hairline),
            ),
            child: Row(children: [
              Expanded(
                child: TextField(
                  controller: _ctrl,
                  style: AppText.body().copyWith(fontSize: 13),
                  decoration: InputDecoration(
                    hintText: 'e.g. Which vendor did I spend the most on?',
                    hintStyle: AppText.small().copyWith(
                        fontSize: 12, color: AppColors.textTertiary),
                    border: InputBorder.none,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(vertical: 10),
                  ),
                ),
              ),
              Material(
                color: Colors.transparent,
                shape: const CircleBorder(),
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () {
                    if (_ctrl.text.trim().isEmpty) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Ask Dex — coming soon')),
                    );
                  },
                  child: Container(
                    width: 36, height: 36,
                    decoration: const BoxDecoration(
                      color: AppColors.textPrimary,
                      shape: BoxShape.circle,
                    ),
                    alignment: Alignment.center,
                    child: const Icon(Icons.send_rounded,
                        size: 15, color: Colors.white),
                  ),
                ),
              ),
            ]),
          ),
        ],
      ),
    );
  }
}

class _AutoFlowFooter extends StatelessWidget {
  const _AutoFlowFooter();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 1),
            child: Icon(Icons.account_balance_wallet_outlined,
                size: 13, color: AppColors.textTertiary),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              'Approved purchase bills & outgoing payments auto-flow into your Ledger and Company Brain.',
              style: AppText.small().copyWith(
                fontSize: 11,
                color: AppColors.textSecondary,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Expense bottom sheet — mobile port of AddExpenseDialog.
// ─────────────────────────────────────────────────────────────────────────────

class _AddExpenseSheet extends StatefulWidget {
  const _AddExpenseSheet();
  @override
  State<_AddExpenseSheet> createState() => _AddExpenseSheetState();
}

class _AddExpenseSheetState extends State<_AddExpenseSheet> {
  final _title = TextEditingController();
  final _vendor = TextEditingController();
  final _amount = TextEditingController();
  final _category = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _title.dispose();
    _vendor.dispose();
    _amount.dispose();
    _category.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Title is required.')),
      );
      return;
    }
    setState(() => _saving = true);
    try {
      await MoneyRepository().addExpense({
        'title': _title.text.trim(),
        if (_vendor.text.trim().isNotEmpty) 'vendor': _vendor.text.trim(),
        if (_amount.text.trim().isNotEmpty)
          'amount': double.tryParse(_amount.text.trim()),
        if (_category.text.trim().isNotEmpty)
          'category': _category.text.trim(),
      });
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Expense added')),
        );
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not add expense.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(String label, TextEditingController c,
      {String? hint, TextInputType? keyboard}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(label,
              style: AppText.small()
                  .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
        ),
        TextField(
          controller: c,
          keyboardType: keyboard,
          decoration: InputDecoration(
            hintText: hint,
            filled: true,
            fillColor: AppColors.surfaceMuted,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(AppRadius.md),
              borderSide: BorderSide.none,
            ),
            contentPadding: const EdgeInsets.symmetric(
                horizontal: 12, vertical: 12),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.only(bottom: bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Add Expense', style: AppText.h3()),
            const SizedBox(height: AppSpacing.md),
            _field('Title', _title, hint: 'What was this for?'),
            const SizedBox(height: 12),
            _field('Vendor', _vendor, hint: 'Vendor or payee'),
            const SizedBox(height: 12),
            _field('Amount', _amount,
                hint: '0',
                keyboard: const TextInputType.numberWithOptions(decimal: true)),
            const SizedBox(height: 12),
            _field('Category', _category, hint: 'Categorise (optional)'),
            const SizedBox(height: AppSpacing.lg),
            Align(
              alignment: Alignment.centerLeft,
              child: Material(
                color: AppColors.textPrimary,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: InkWell(
                  onTap: _saving ? null : _save,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg, vertical: 12),
                    child: Text(_saving ? 'Adding…' : 'Add Expense',
                        style: AppText.bodyStrong()
                            .copyWith(color: Colors.white)),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
