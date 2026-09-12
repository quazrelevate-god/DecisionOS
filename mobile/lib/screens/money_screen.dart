import 'package:flutter/material.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/editorial_icons.dart';
import '../widgets/segment.dart';
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
  // Canonical tab order — mirrors _TabRail._tabs. Used to compute slide
  // direction when the user swaps tabs.
  static const _tabOrder = [
    'overview',
    'revenue',
    'expenses',
    'assets',
    'inventory',
    'inbox',
  ];

  String _tab = 'overview';
  // +1 = new tab comes in from the right (moving forward through the rail)
  // -1 = new tab comes in from the left (moving back). AnimatedSwitcher
  // reads this via a closure in transitionBuilder.
  int _slideDir = 1;

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
    final oldIdx = _tabOrder.indexOf(_tab);
    final newIdx = _tabOrder.indexOf(t);
    setState(() {
      _slideDir = newIdx > oldIdx ? 1 : -1;
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
    return Stack(
      children: [
        const Positioned.fill(child: AppBloom(tint: BloomTint.smoke)),
        Column(
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
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg,
                      ),
                      child: _CaptureHero(
                        pendingFuture: _pendingFuture!,
                        onRefresh: _refresh,
                        onTabChange: _setTab,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.lg,
                      ),
                      child: SlidingSwitcher(
                        tabKey: _tab,
                        direction: _slideDir,
                        child: _TabBody(
                          tab: _tab,
                          summaryFuture: _summaryFuture,
                          revenueFuture: _revenueFuture,
                          expensesFuture: _expensesFuture,
                          assetsFuture: _assetsFuture,
                          inventoryFuture: _inventoryFuture,
                          onTabChange: _setTab,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
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
        Text(
          'Finance',
          style: AppText.display().copyWith(fontSize: 30, height: 1.05),
        ),
        const SizedBox(height: 6),
        Text(
          'Money in one place',
          style: AppText.small().copyWith(color: AppColors.textSecondary),
        ),
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
    final activeIndex = _tabs.indexWhere((t) => t.$1 == active);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: RaisedPillSegment(
        active: activeIndex < 0 ? 0 : activeIndex,
        count: _tabs.length,
        onSelect: (i) => onSelect(_tabs[i].$1),
        // KM-56 — the reference HTML's three materials: recessed track,
        // ONE raised content-sized pill, flat inactive slots. The palette
        // is derived from the page's own smoke ground, which already sits
        // within a shade of the reference's #e9e6e0.
        palette: NeuPalette.from(trackColorFor(BloomTint.smoke)),
        // Reference is 7 x 9 inside the slot and 5 all round the track.
        // Roomier here on both, and the icon sits OVER the label rather
        // than beside it: six tabs plus icons never fit on one line at a
        // readable size, and stacking buys the height back.
        //
        // Horizontal stays at 7 on purpose. It is the only axis the
        // six-tab fit is sensitive to — at 7 all six still spread on a
        // 360 pt phone, and vertical padding is free.
        trackPadding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
        slotPadding: const EdgeInsets.symmetric(horizontal: 7, vertical: 9),
        // Stacked content makes the pill nearly as tall as it is wide, and
        // a stadium would round the short labels (Assets, Inbox) into
        // ovals. 20 keeps them rounded rectangles.
        pillRadius: 20,
        slotBuilder: (context, i, isActive) {
          final t = _tabs[i];
          // Reference ink: active #1F2430, inactive #9AA0AE, applied to
          // icon and label alike.
          final fg = isActive
              ? const Color(0xFF1F2430)
              : const Color(0xFF9AA0AE);
          return Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(t.$3, size: 15, color: fg),
              const SizedBox(height: 4),
              AnimatedDefaultTextStyle(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeOutCubic,
                style: AppText.small().copyWith(
                  fontSize: 10,
                  fontWeight: isActive ? FontWeight.w600 : FontWeight.w500,
                  color: fg,
                  height: 1.25,
                ),
                child: Text(t.$2, maxLines: 1, softWrap: false),
              ),
            ],
          );
        },
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
    final radius = BorderRadius.circular(AppRadius.pill);
    final child = Padding(
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
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
        ],
      ),
    );
    if (active) {
      return KrPressed(
        borderRadius: radius,
        onTap: onTap,
        color: AppColors.surface,
        child: child,
      );
    }
    return Material(
      color: Colors.transparent,
      borderRadius: radius,
      child: InkWell(onTap: onTap, borderRadius: radius, child: child),
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

  // KM-59 — the capture row now carries custom editorial line
  // illustrations rather than tinted circles around Material glyphs. One
  // ink colour, one stroke weight, drawn as a set.
  static const _tiles = <(String, EditorialIcon)>[
    ('Upload bill', EditorialIcon.uploadBill),
    ('Scan receipt', EditorialIcon.scanReceipt),
    ('Add expense', EditorialIcon.addExpense),
    ('CSV / Excel', EditorialIcon.exportSheet),
  ];

  Future<void> _onTileTap(BuildContext context, int i) async {
    switch (i) {
      case 0: // Upload bill / receipt (PDF or image)
        try {
          final r = await FilePicker.platform.pickFiles(
            withData: true,
            allowMultiple: false,
            type: FileType.custom,
            allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
          );
          if (r == null || r.files.isEmpty) return;
          final f = r.files.single;
          if (f.bytes == null) return;
          await _ingestDoc(context, f.bytes!, f.name);
        } catch (_) {
          _err(context, 'Could not pick a file.');
        }
        break;
      case 1: // Scan receipt via camera
        try {
          final x = await ImagePicker().pickImage(
            source: ImageSource.camera,
            imageQuality: 82,
          );
          if (x == null) return;
          final bytes = await x.readAsBytes();
          await _ingestDoc(context, bytes, x.name);
        } catch (_) {
          _err(context, 'Could not open camera.');
        }
        break;
      case 2: // Add expense — real form
        final saved = await showModalBottomSheet<bool>(
          context: context,
          isScrollControlled: true,
          backgroundColor: AppColors.surface,
          shape: const RoundedRectangleBorder(
            borderRadius: BorderRadius.vertical(
              top: Radius.circular(AppRadius.lg),
            ),
          ),
          builder: (_) => const _AddExpenseSheet(),
        );
        if (saved == true) onRefresh();
        break;
      case 3: // CSV/Excel import
        try {
          final r = await FilePicker.platform.pickFiles(
            withData: true,
            allowMultiple: false,
            type: FileType.custom,
            allowedExtensions: const ['csv', 'xlsx', 'xls'],
          );
          if (r == null || r.files.isEmpty) return;
          final f = r.files.single;
          if (f.bytes == null) return;
          await _ingestCsv(context, f.bytes!, f.name);
        } catch (_) {
          _err(context, 'Could not pick the spreadsheet.');
        }
        break;
    }
  }

  Future<void> _ingestDoc(
    BuildContext context,
    List<int> bytes,
    String filename,
  ) async {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Uploading $filename…')));
    try {
      await MoneyRepository().ingestDocument(bytes: bytes, filename: filename);
      onRefresh();
      onTabChange('inbox');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Uploaded — review in Inbox')),
        );
      }
    } catch (_) {
      _err(context, 'Upload failed.');
    }
  }

  Future<void> _ingestCsv(
    BuildContext context,
    List<int> bytes,
    String filename,
  ) async {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Importing $filename…')));
    try {
      await MoneyRepository().ingestCsv(bytes: bytes, filename: filename);
      onRefresh();
      onTabChange('inbox');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('CSV imported — review in Inbox')),
        );
      }
    } catch (_) {
      _err(context, 'Import failed.');
    }
  }

  void _err(BuildContext context, String msg) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        KrPop(
          borderRadius: BorderRadius.circular(AppRadius.lg),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.lg,
          ),
          child: Row(
            children: [
              for (int i = 0; i < _tiles.length; i++)
                Expanded(
                  child: _CaptureTile(
                    label: _tiles[i].$1,
                    icon: _tiles[i].$2,
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
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.brandBg,
                      borderRadius: BorderRadius.circular(AppRadius.pill),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '$count in Inbox',
                          style: AppText.smallStrong().copyWith(
                            fontSize: 11,
                            color: AppColors.brandDeep,
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(
                          Icons.arrow_forward_rounded,
                          size: 12,
                          color: AppColors.brandDeep,
                        ),
                      ],
                    ),
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
  final EditorialIcon icon;
  final VoidCallback onTap;
  const _CaptureTile({
    required this.label,
    required this.icon,
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
          padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Editorial cutout: ink glyph over a pale cut-paper shape.
              // The tint belongs to the illustration, so the tile passes
              // nothing but the size.
              EditorialIllustration(icon: icon, size: 52),
              const SizedBox(height: 10),
              Text(
                label,
                style: AppText.smallStrong().copyWith(fontSize: 11),
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
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
  final ValueChanged<String> onTabChange;
  const _TabBody({
    required this.tab,
    required this.summaryFuture,
    required this.revenueFuture,
    required this.expensesFuture,
    required this.assetsFuture,
    required this.inventoryFuture,
    required this.onTabChange,
  });

  @override
  Widget build(BuildContext context) {
    switch (tab) {
      case 'overview':
        return _OverviewBody(
          summaryFuture: summaryFuture,
          onTabChange: onTabChange,
        );
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
  final ValueChanged<String> onTabChange;
  const _OverviewBody({required this.summaryFuture, required this.onTabChange});

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<LedgerSummary>(
      future: summaryFuture,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Column(
            children: [
              LoadingCard(height: 100),
              SizedBox(height: 12),
              LoadingCard(height: 160),
            ],
          );
        }
        if (snap.hasError) {
          return const ErrorState(
            message: 'Could not load your ledger summary.',
          );
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
            _NetProfitHero(
              net: net,
              monthly: monthly,
              trendPct: trendPct,
              onTap: () => onTabChange('revenue'),
            ),
            const SizedBox(height: AppSpacing.md),
            _KpiGrid(s: s, onTabChange: onTabChange),
            const SizedBox(height: AppSpacing.md),
            _ViewAllButton(onTap: () => onTabChange('revenue')),
            if (s.overdueReceivables.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _CashFlowPanel(s: s, onViewAll: () => onTabChange('revenue')),
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
  final VoidCallback? onTap;
  const _NetProfitHero({
    required this.net,
    required this.monthly,
    required this.trendPct,
    this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final up = trendPct >= 0;
    final series = monthly.length >= 2
        ? monthly
        : [1.0, 1.2, 0.9, 1.4, 1.1, 1.6];
    final green = const Color(0xFF16A34A);
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.lg),
      onTap: onTap,
      child: Stack(
        children: [
          // Green sparkline runs behind the number.
          Positioned(
            top: 12,
            right: 60,
            child: SizedBox(
              width: 130,
              height: 64,
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
                    Text(
                      'Net profit',
                      style: AppText.smallStrong().copyWith(fontSize: 13),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _rupee(net),
                      style: AppText.display().copyWith(
                        fontSize: 30,
                        height: 1,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Icon(
                          up
                              ? Icons.arrow_upward_rounded
                              : Icons.arrow_downward_rounded,
                          size: 12,
                          color: up ? const Color(0xFF16A34A) : AppColors.brand,
                        ),
                        const SizedBox(width: 2),
                        Text(
                          '${trendPct.abs().toStringAsFixed(1)}%',
                          style: AppText.smallStrong().copyWith(
                            fontSize: 11,
                            color: up
                                ? const Color(0xFF16A34A)
                                : AppColors.brand,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          'this month',
                          style: AppText.small().copyWith(
                            fontSize: 11,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(
                  color: AppColors.textPrimary,
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(
                  Icons.arrow_forward_rounded,
                  size: 14,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _KpiGrid extends StatelessWidget {
  final LedgerSummary s;
  final ValueChanged<String> onTabChange;
  const _KpiGrid({required this.s, required this.onTabChange});
  @override
  Widget build(BuildContext context) {
    double? trend;
    if (s.monthlyNet.length >= 2) {
      final curr = s.monthlyNet.last;
      final prev = s.monthlyNet[s.monthlyNet.length - 2];
      if (prev != 0) trend = ((curr - prev) / prev.abs()) * 100;
    }
    return Column(
      children: [
        // IntrinsicHeight + stretch so the pair in a row is always the
        // same height, even if a value or label ever needs two lines.
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _KpiCard(
                  label: 'Revenue',
                  value: s.revenueBilled == null
                      ? '—'
                      : _rupee(s.revenueBilled!),
                  icon: Icons.attach_money_rounded,
                  bg: const Color(0xFFD3F5DF),
                  fg: const Color(0xFF16A34A),
                  trend: trend,
                  onTap: () => onTabChange('revenue'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiCard(
                  label: 'Received',
                  value: s.revenueReceived == null
                      ? '—'
                      : _rupee(s.revenueReceived!),
                  icon: Icons.chat_bubble_outline_rounded,
                  bg: const Color(0xFFDCE7F8),
                  fg: const Color(0xFF2563EB),
                  onTap: () => onTabChange('revenue'),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 10),
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _KpiCard(
                  label: 'Total spend',
                  value: s.totalSpend == null ? '—' : _rupee(s.totalSpend!),
                  icon: Icons.trending_up_rounded,
                  bg: const Color(0xFFFDE1E5),
                  fg: const Color(0xFFE11D48),
                  onTap: () => onTabChange('expenses'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _KpiCard(
                  label: 'Overdue amount',
                  value: s.overdueAmount == null
                      ? '₹0'
                      : _rupee(s.overdueAmount!),
                  icon: Icons.error_outline_rounded,
                  bg: const Color(0xFFFDE5CC),
                  fg: const Color(0xFFEA580C),
                  note: s.overdueCount > 0
                      ? '${s.overdueCount} overdue invoice${s.overdueCount == 1 ? '' : 's'}'
                      : 'No overdue',
                  urgent: (s.overdueAmount ?? 0) > 0,
                  onTap: () => onTabChange('revenue'),
                ),
              ),
            ],
          ),
        ),
      ],
    );
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
  final VoidCallback? onTap;
  const _KpiCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.bg,
    required this.fg,
    this.urgent = false,
    this.trend,
    this.note,
    this.onTap,
  });

  /// What goes in the reserved footer slot: a trend delta, a note, or
  /// deliberately nothing.
  Widget _footer(bool up) {
    if (trend != null) {
      final tint = up ? const Color(0xFF16A34A) : AppColors.brand;
      return Row(
        children: [
          Icon(
            up ? Icons.arrow_upward_rounded : Icons.arrow_downward_rounded,
            size: 11,
            color: tint,
          ),
          const SizedBox(width: 2),
          Text(
            '${trend!.abs().toStringAsFixed(1)}%',
            style: AppText.smallStrong().copyWith(fontSize: 11, color: tint),
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              'this month',
              style: AppText.small().copyWith(
                fontSize: 10,
                color: AppColors.textSecondary,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      );
    }
    if (note != null) {
      return Text(
        note!,
        style: AppText.small().copyWith(
          fontSize: 11,
          color: urgent ? AppColors.brand : AppColors.textSecondary,
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      );
    }
    return const SizedBox.shrink();
  }

  @override
  Widget build(BuildContext context) {
    final up = (trend ?? 0) >= 0;
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
                alignment: Alignment.center,
                child: Icon(icon, size: 16, color: fg),
              ),
              const Spacer(),
              const Icon(
                Icons.chevron_right_rounded,
                size: 16,
                color: AppColors.textTertiary,
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            label,
            style: AppText.small().copyWith(
              fontSize: 12,
              color: AppColors.textSecondary,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: AppText.h3().copyWith(
              fontSize: 18,
              height: 1.1,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 6),
          // The footer slot is ALWAYS laid out, even on a card with
          // nothing to put in it. Only two of these four carry a delta
          // line, and letting the slot collapse on the other two is what
          // made the grid uneven.
          SizedBox(height: 15, child: _footer(up)),
        ],
      ),
    );
  }
}

class _ViewAllButton extends StatelessWidget {
  final VoidCallback onTap;
  const _ViewAllButton({required this.onTap});
  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.symmetric(vertical: 14),
      onTap: onTap,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            'View all financials',
            style: AppText.smallStrong().copyWith(fontSize: 13),
          ),
          const SizedBox(width: 6),
          const Icon(
            Icons.arrow_forward_rounded,
            size: 14,
            color: AppColors.textPrimary,
          ),
        ],
      ),
    );
  }
}

class _CashFlowPanel extends StatelessWidget {
  final LedgerSummary s;
  final VoidCallback onViewAll;
  const _CashFlowPanel({required this.s, required this.onViewAll});
  @override
  Widget build(BuildContext context) {
    final double total =
        s.overdueAmount ??
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
              const Icon(
                Icons.warning_amber_rounded,
                size: 20,
                color: AppColors.brand,
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Cash flow needs attention',
                      style: AppText.bodyStrong().copyWith(fontSize: 14),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${_rupee(total)} is stuck outside',
                      style: AppText.small().copyWith(
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: InkWell(
                  onTap: onViewAll,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
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
                    child: Text(
                      'View all',
                      style: AppText.smallStrong().copyWith(fontSize: 11),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (final r in s.overdueReceivables.take(3))
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              // Row is tappable — routes to Revenue tab. Model has no
              // contact_id yet, so we can't push straight to /contact/:id;
              // this is the closest existing surface.
              child: Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(AppRadius.md),
                child: InkWell(
                  onTap: onViewAll,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(AppRadius.md),
                    ),
                    child: Row(
                      children: [
                        Container(
                          width: 30,
                          height: 30,
                          decoration: BoxDecoration(
                            color: AppColors.brandBg,
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: const Icon(
                            Icons.apartment_rounded,
                            size: 14,
                            color: AppColors.brand,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                r.name,
                                style: AppText.smallStrong().copyWith(
                                  fontSize: 13,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                              Text(
                                r.overdueDays != null
                                    ? 'Overdue ${r.overdueDays}+ days'
                                    : 'Outstanding',
                                style: AppText.small().copyWith(
                                  fontSize: 11,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        Text(
                          _rupee(r.amount),
                          style: AppText.smallStrong().copyWith(
                            color: AppColors.brand,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                        ),
                        const SizedBox(width: 6),
                        const Icon(
                          Icons.chevron_right_rounded,
                          size: 14,
                          color: AppColors.textTertiary,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          if (s.overdueReceivables.length > 3 ||
              s.overdueReceivables.isNotEmpty) ...[
            const SizedBox(height: 6),
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onViewAll,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      Text(
                        'View all ${s.overdueReceivables.length}+ action items',
                        style: AppText.smallStrong().copyWith(
                          fontSize: 12,
                          color: AppColors.brand,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(
                        Icons.arrow_forward_rounded,
                        size: 12,
                        color: AppColors.brand,
                      ),
                    ],
                  ),
                ),
              ),
            ),
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
        if (snap.hasError)
          return const ErrorState(message: 'Could not load revenue.');
        final items = snap.data ?? const <Revenue>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _AddPill(
              label: 'Add income',
              onTap: () => _openAdd(context, 'income'),
            ),
            const SizedBox(height: AppSpacing.md),
            if (items.isEmpty)
              const EmptyState(
                icon: Icons.attach_money_rounded,
                title: 'No revenue yet',
                subtitle: 'Invoices you send will show up here.',
              )
            else
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
                    onDelete: () => _confirmDelete(
                      context,
                      title: r.title,
                      run: () => MoneyRepository().deleteInvoice(r.id),
                    ),
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
        if (snap.hasError)
          return const ErrorState(message: 'Could not load expenses.');
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
                    onDelete: () => _confirmDelete(
                      context,
                      title: e.title,
                      run: () => MoneyRepository().deleteExpense(e.id),
                    ),
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
        if (snap.connectionState != ConnectionState.done)
          return const LoadingCard(height: 120);
        if (snap.hasError)
          return const ErrorState(message: 'Could not load assets.');
        final items = snap.data ?? const <Asset>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _AddPill(
              label: 'Add asset',
              onTap: () => _openAdd(context, 'asset'),
            ),
            const SizedBox(height: AppSpacing.md),
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
                    onDelete: () => _confirmDelete(
                      context,
                      title: a.title,
                      run: () => MoneyRepository().deleteAsset(a.id),
                    ),
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
        if (snap.connectionState != ConnectionState.done)
          return const LoadingCard(height: 120);
        if (snap.hasError)
          return const ErrorState(message: 'Could not load inventory.');
        final items = snap.data ?? const <InventoryItem>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _AddPill(
              label: 'Add item',
              onTap: () => _openAdd(context, 'inventory'),
            ),
            const SizedBox(height: AppSpacing.md),
            const _AiInsightPlaceholder(scope: 'inventory'),
            const SizedBox(height: AppSpacing.md),
            if (items.isEmpty)
              const EmptyState(
                icon: Icons.inventory_2_outlined,
                title: 'No inventory yet',
                subtitle: 'Stock items will appear here.',
              )
            else
              for (final it in items)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: _MoneyRowCard(
                    title: it.title,
                    meta: 'Qty ${it.quantity.toStringAsFixed(0)}',
                    amount: (it.unitCost ?? 0) * it.quantity,
                    income: true,
                    onDelete: () => _confirmDelete(
                      context,
                      title: it.title,
                      run: () => MoneyRepository().deleteInventory(it.id),
                    ),
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
      subtitle:
          'Uploaded receipts land here for you to confirm before they hit the books.',
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
  final VoidCallback? onDelete;
  const _MoneyRowCard({
    required this.title,
    this.meta,
    this.status,
    required this.amount,
    required this.income,
    this.onDelete,
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
                Text(
                  title,
                  style: AppText.bodyStrong().copyWith(fontSize: 14),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                if ((meta ?? '').isNotEmpty || status != null) ...[
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (status != null) ...[
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
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
                          child: Text(
                            meta!,
                            style: AppText.small().copyWith(
                              fontSize: 12,
                              color: AppColors.textSecondary,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '${income ? '+' : '−'} ${_rupee(amount)}',
            style: AppText.smallStrong().copyWith(
              fontSize: 13,
              color: income ? const Color(0xFF16A34A) : AppColors.brand,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          if (onDelete != null) ...[
            const SizedBox(width: 4),
            InkWell(
              onTap: onDelete,
              borderRadius: BorderRadius.circular(999),
              child: const Padding(
                padding: EdgeInsets.all(6),
                child: Icon(
                  Icons.delete_outline_rounded,
                  size: 18,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared money-list helpers.
// ─────────────────────────────────────────────────────────────────────────────

class _AddPill extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _AddPill({required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Material(
        color: AppColors.textPrimary,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadius.pill),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md,
              vertical: 10,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.add_rounded, size: 16, color: Colors.white),
                const SizedBox(width: 6),
                Text(
                  label,
                  style: AppText.bodyStrong().copyWith(
                    color: Colors.white,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Future<void> _openAdd(BuildContext context, String kind) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _AddMoneySheet(kind: kind),
  );
  if (saved == true) {
    // Bubble a soft "please refresh" signal — the Money screen's own
    // FutureBuilders don't auto-refetch, but rebuilds happen when the user
    // switches tabs. Snack keeps the user informed.
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Added — pull the tab to refresh.')),
      );
    }
  }
}

Future<void> _confirmDelete(
  BuildContext context, {
  required String title,
  required Future<void> Function() run,
}) async {
  final go = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Delete?'),
      content: Text('"$title" will be permanently removed.'),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );
  if (go != true) return;
  try {
    await run();
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Deleted — pull the tab to refresh.')),
      );
    }
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Could not delete.')));
    }
  }
}

/// One sheet for Add Income / Asset / Inventory. Small text form → the
/// existing `MoneyRepository.addRevenue|addAsset|addInventory` (which hit
/// the frontend's `/*/with-file` endpoint with no file leg).
class _AddMoneySheet extends StatefulWidget {
  final String kind; // 'income' | 'asset' | 'inventory'
  const _AddMoneySheet({required this.kind});
  @override
  State<_AddMoneySheet> createState() => _AddMoneySheetState();
}

class _AddMoneySheetState extends State<_AddMoneySheet> {
  final _title = TextEditingController();
  final _party = TextEditingController();
  final _amount = TextEditingController();
  final _category = TextEditingController();
  final _qty = TextEditingController();
  bool _saving = false;

  String get _heading => switch (widget.kind) {
    'income' => 'Add income',
    'asset' => 'Add asset',
    _ => 'Add inventory item',
  };

  Future<void> _submit() async {
    if (_title.text.trim().isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Title is required.')));
      return;
    }
    setState(() => _saving = true);
    try {
      final amount = double.tryParse(_amount.text.trim());
      switch (widget.kind) {
        case 'income':
          await MoneyRepository().addRevenue({
            'title': _title.text.trim(),
            if (_party.text.trim().isNotEmpty)
              'customer_name': _party.text.trim(),
            if (amount != null) 'amount': amount,
          });
          break;
        case 'asset':
          await MoneyRepository().addAsset({
            'name': _title.text.trim(),
            if (_party.text.trim().isNotEmpty) 'vendor': _party.text.trim(),
            if (amount != null) 'amount': amount,
            if (_category.text.trim().isNotEmpty)
              'category': _category.text.trim(),
          });
          break;
        default:
          await MoneyRepository().addInventory({
            'item': _title.text.trim(),
            if (_party.text.trim().isNotEmpty) 'vendor': _party.text.trim(),
            if (double.tryParse(_qty.text.trim()) != null)
              'quantity': double.parse(_qty.text.trim()),
            if (amount != null) 'unit_cost': amount,
          });
      }
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Could not save.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(
    String label,
    TextEditingController c, {
    String? hint,
    TextInputType? keyboard,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6, top: 4),
          child: Text(
            label,
            style: AppText.small().copyWith(
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
        ),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surfaceMuted,
            borderRadius: BorderRadius.circular(AppRadius.md),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: TextField(
            controller: c,
            keyboardType: keyboard,
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: AppText.body().copyWith(color: AppColors.textTertiary),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final mq = MediaQuery.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.xxl,
        AppSpacing.lg,
        AppSpacing.lg + mq.viewInsets.bottom,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: mq.size.height * 0.82),
        child: Material(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(AppRadius.xl),
          elevation: 24,
          shadowColor: Colors.black.withValues(alpha: 0.35),
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(_heading, style: AppText.h3()),
                    const Spacer(),
                    InkWell(
                      onTap: () => Navigator.of(context).pop(),
                      borderRadius: BorderRadius.circular(999),
                      child: const Padding(
                        padding: EdgeInsets.all(4),
                        child: Icon(Icons.close_rounded, size: 20),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                _field('Title', _title, hint: 'What is this?'),
                _field(
                  widget.kind == 'income' ? 'Customer' : 'Vendor',
                  _party,
                  hint: widget.kind == 'income'
                      ? 'Customer name'
                      : 'Vendor name',
                ),
                if (widget.kind == 'inventory')
                  _field(
                    'Quantity',
                    _qty,
                    hint: '0',
                    keyboard: const TextInputType.numberWithOptions(),
                  ),
                _field(
                  widget.kind == 'inventory' ? 'Unit cost' : 'Amount',
                  _amount,
                  hint: '0',
                  keyboard: const TextInputType.numberWithOptions(
                    decimal: true,
                  ),
                ),
                if (widget.kind == 'asset')
                  _field('Category', _category, hint: 'Category (optional)'),
                const SizedBox(height: AppSpacing.lg),
                Material(
                  color: AppColors.textPrimary,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: InkWell(
                    onTap: _saving ? null : _submit,
                    borderRadius: BorderRadius.circular(AppRadius.pill),
                    child: Container(
                      alignment: Alignment.center,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Text(
                        _saving ? 'Saving…' : 'Save',
                        style: AppText.bodyStrong().copyWith(
                          color: Colors.white,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _title.dispose();
    _party.dispose();
    _amount.dispose();
    _category.dispose();
    _qty.dispose();
    super.dispose();
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
      color: AppColors.surface,
      child: Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: AppColors.brandBg,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: const Icon(
              Icons.auto_awesome_rounded,
              size: 15,
              color: AppColors.brand,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Dex insights',
                  style: AppText.smallStrong().copyWith(fontSize: 12),
                ),
                Text(
                  'Ask Dex about your $scope',
                  style: AppText.small().copyWith(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
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
  String? _answer;
  bool _asking = false;

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final q = _ctrl.text.trim();
    if (q.isEmpty || _asking) return;
    setState(() {
      _asking = true;
      _answer = null;
    });
    try {
      final answer = await MoneyRepository().ask(q);
      if (mounted) {
        setState(() {
          _answer = answer.isEmpty
              ? "I couldn't find an answer — try rephrasing."
              : answer;
        });
      }
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: const Color(0xFFEADFF9),
                  shape: BoxShape.circle,
                ),
                alignment: Alignment.center,
                child: const Icon(
                  Icons.auto_awesome_rounded,
                  size: 15,
                  color: Color(0xFF7C3AED),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                'Ask AI about your finances',
                style: AppText.bodyStrong().copyWith(fontSize: 14),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          // Text field + dark round send button.
          Container(
            padding: const EdgeInsets.only(
              left: 14,
              right: 4,
              top: 4,
              bottom: 4,
            ),
            decoration: BoxDecoration(
              color: AppColors.surfaceMuted,
              borderRadius: BorderRadius.circular(AppRadius.pill),
              border: Border.all(color: AppColors.hairline),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _ctrl,
                    onSubmitted: (_) => _submit(),
                    style: AppText.body().copyWith(fontSize: 13),
                    decoration: InputDecoration(
                      hintText: 'e.g. Which vendor did I spend the most on?',
                      hintStyle: AppText.small().copyWith(
                        fontSize: 12,
                        color: AppColors.textTertiary,
                      ),
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
                    onTap: _submit,
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: const BoxDecoration(
                        color: AppColors.textPrimary,
                        shape: BoxShape.circle,
                      ),
                      alignment: Alignment.center,
                      child: _asking
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(
                              Icons.send_rounded,
                              size: 15,
                              color: Colors.white,
                            ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          if (_answer != null) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 4, 12),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(top: 4, right: 4),
                      child: Text(
                        _answer!,
                        style: AppText.body().copyWith(
                          fontSize: 13,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ),
                  // Dismiss the answer so the panel collapses back to the
                  // input-only state. Doesn't clear the input text — user
                  // can edit and re-submit.
                  Material(
                    color: Colors.transparent,
                    shape: const CircleBorder(),
                    child: InkWell(
                      customBorder: const CircleBorder(),
                      onTap: () => setState(() => _answer = null),
                      child: const Padding(
                        padding: EdgeInsets.all(6),
                        child: Icon(
                          Icons.close_rounded,
                          size: 16,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
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
            child: Icon(
              Icons.account_balance_wallet_outlined,
              size: 13,
              color: AppColors.textTertiary,
            ),
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
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Title is required.')));
      return;
    }
    setState(() => _saving = true);
    try {
      await MoneyRepository().addExpense({
        'title': _title.text.trim(),
        if (_vendor.text.trim().isNotEmpty) 'vendor': _vendor.text.trim(),
        if (_amount.text.trim().isNotEmpty)
          'amount': double.tryParse(_amount.text.trim()),
        if (_category.text.trim().isNotEmpty) 'category': _category.text.trim(),
      });
      if (mounted) {
        Navigator.of(context).pop(true);
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Expense added')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Could not add expense.')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(
    String label,
    TextEditingController c, {
    String? hint,
    TextInputType? keyboard,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(
            label,
            style: AppText.small().copyWith(
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
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
              horizontal: 12,
              vertical: 12,
            ),
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
            _field(
              'Amount',
              _amount,
              hint: '0',
              keyboard: const TextInputType.numberWithOptions(decimal: true),
            ),
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
                      horizontal: AppSpacing.lg,
                      vertical: 12,
                    ),
                    child: Text(
                      _saving ? 'Adding…' : 'Add Expense',
                      style: AppText.bodyStrong().copyWith(color: Colors.white),
                    ),
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
