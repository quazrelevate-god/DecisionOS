import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:file_picker/file_picker.dart';
import 'package:image_picker/image_picker.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_bloom.dart';
import '../widgets/app_header.dart';
import '../widgets/segment.dart';
import '../widgets/neumorphic.dart';
import '../widgets/sparkline.dart';
import '../widgets/states.dart';

/// The Money (Finance) screen — re-synced to the PWA mobile Finance design
/// (frontend/src/pages/Ledger.js + pages/finance/*).
///
///   • "Finance" title + a 6-tab strip (dark active pill): Overview / Revenue
///     / Expenses / Assets / Inventory / Inbox
///   • controls row: period pill (Overview) + dark "Add …" button
///   • Quick-capture card (2×2 upload grid + Ask input) on every tab
///   • Overview → 6-KPI grid w/ sparklines · AI Finance Brief (green highlight +
///     Action Items) · Spend-by-category donut · Top vendors · auto-flow note
///   • Revenue/Expenses/Assets/Inventory → AI Analysis card + record lists
///   • Inbox → capture-review queue with status sub-tabs
class MoneyScreen extends StatefulWidget {
  const MoneyScreen({super.key});
  @override
  State<MoneyScreen> createState() => _MoneyScreenState();
}

class _MoneyScreenState extends State<MoneyScreen> {
  static const _tabOrder = [
    'overview',
    'revenue',
    'expenses',
    'assets',
    'inventory',
    'inbox',
  ];

  String _tab = 'overview';
  int _slideDir = 1;

  // Overview period pill — days, or null for "All time". Defaults to 90 days
  // (the reference's selection); the flows are windowed client-side.
  int? _periodDays = 90;

  // Summary is all-time (the backend /ledger/summary has no period filter);
  // it supplies the asset/inventory HOLDINGS + currency. Revenue + expenses are
  // fetched eagerly so the Overview can window the money FLOWS client-side, the
  // way the PWA does — the period pill then re-filters in place with no refetch.
  late Future<LedgerSummary> _summaryFuture;
  late Future<List<Revenue>> _revenueFuture;
  late Future<List<Expense>> _expensesFuture;
  late Future<_OverviewData> _overviewFuture;
  Future<List<Asset>>? _assetsFuture;
  Future<List<InventoryItem>>? _inventoryFuture;
  Future<int>? _pendingFuture;

  // Lazily-built AI briefs keyed by scope (brief|revenue|expenses|…).
  final Map<String, Future<FinanceBrief>> _briefs = {};

  Future<FinanceBrief> _brief(String scope) =>
      _briefs[scope] ??= MoneyRepository().aiBrief(scope);

  Future<_OverviewData> _loadOverview() async => _OverviewData(
        await _summaryFuture,
        await _revenueFuture,
        await _expensesFuture,
      );

  @override
  void initState() {
    super.initState();
    _summaryFuture = MoneyRepository().summary();
    _revenueFuture = MoneyRepository().revenue();
    _expensesFuture = MoneyRepository().expenses();
    _overviewFuture = _loadOverview();
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
    switch (t) {
      case 'assets':
        _assetsFuture ??= MoneyRepository().assets();
        break;
      case 'inventory':
        _inventoryFuture ??= MoneyRepository().inventory();
        break;
    }
  }

  // A period change re-filters the already-loaded data in place — no refetch,
  // so it's instant and the numbers move.
  void _setPeriod(int? days) {
    if (days == _periodDays) return;
    setState(() => _periodDays = days);
  }

  /// Full refresh after a mutation — re-fetch everything and drop cached AI
  /// briefs so they recompute lazily.
  void _refresh() {
    setState(() {
      _summaryFuture = MoneyRepository().summary();
      _revenueFuture = MoneyRepository().revenue();
      _expensesFuture = MoneyRepository().expenses();
      _overviewFuture = _loadOverview();
      _pendingFuture = MoneyRepository().pendingCaptureCount();
      _assetsFuture = _tab == 'assets' ? MoneyRepository().assets() : null;
      _inventoryFuture =
          _tab == 'inventory' ? MoneyRepository().inventory() : null;
      _briefs.clear();
    });
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
                    const SizedBox(height: AppSpacing.md),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg),
                      child: _TabRail(
                        active: _tab,
                        onSelect: _setTab,
                        pendingFuture: _pendingFuture!,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg),
                      child: _ControlsRow(
                        tab: _tab,
                        periodDays: _periodDays,
                        onPeriod: _setPeriod,
                        onAdded: _refresh,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg),
                      child: _QuickCapture(
                        pendingFuture: _pendingFuture!,
                        onRefresh: _refresh,
                        onOpenInbox: () => _setTab('inbox'),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: AppSpacing.lg),
                      child: SlidingSwitcher(
                        tabKey: _tab,
                        direction: _slideDir,
                        child: _TabBody(
                          tab: _tab,
                          overviewFuture: _overviewFuture,
                          revenueFuture: _revenueFuture,
                          expensesFuture: _expensesFuture,
                          assetsFuture: _assetsFuture,
                          inventoryFuture: _inventoryFuture,
                          brief: _brief,
                          periodDays: _periodDays,
                          periodLabel: _periodLabel(_periodDays),
                          onTabChange: _setTab,
                          onRefresh: _refresh,
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
// Shared formatters + tokens
// ─────────────────────────────────────────────────────────────────────────────

/// ₹ with western thousands grouping and no decimals, e.g. ₹2,285,000.
String _rupeeFull(double v) {
  final n = v.round();
  final neg = n < 0;
  final s = n.abs().toString();
  final b = StringBuffer();
  for (int i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) b.write(',');
    b.write(s[i]);
  }
  return '${neg ? '-' : ''}₹$b';
}

/// Compact ₹ (lakh / crore), e.g. ₹7.4L, ₹1.2Cr — used for brief facts.
String _rupeeCompact(double v) {
  final a = v.abs();
  final sign = v < 0 ? '-' : '';
  if (a >= 10000000) return '$sign₹${(a / 10000000).toStringAsFixed(1)}Cr';
  if (a >= 100000) return '$sign₹${(a / 100000).toStringAsFixed(1)}L';
  if (a >= 1000) return '$sign₹${(a / 1000).toStringAsFixed(1)}K';
  return '$sign₹${a.toStringAsFixed(0)}';
}

const _periods = <(String, int?)>[
  ('Last 30 days', 30),
  ('Last 90 days', 90),
  ('Last 12 months', 365),
  ('All time', null),
];

String _periodLabel(int? days) =>
    _periods.firstWhere((p) => p.$2 == days, orElse: () => _periods.first).$1;

/// A tone pair for KPI/tile icon circles (light bg + saturated fg).
class _Tone {
  final Color bg;
  final Color fg;
  const _Tone(this.bg, this.fg);
}

const _tones = <String, _Tone>{
  'emerald': _Tone(Color(0xFFE7F7EE), Color(0xFF047857)),
  'sky': _Tone(Color(0xFFE6F2FB), Color(0xFF0369A1)),
  'orange': _Tone(Color(0xFFFFF1E6), Color(0xFFEA580C)),
  'slate': _Tone(Color(0xFFEEF1F5), Color(0xFF475569)),
  'violet': _Tone(Color(0xFFF1ECFD), Color(0xFF7C3AED)),
  'amber': _Tone(Color(0xFFFDF4E3), Color(0xFFB45309)),
  'rose': _Tone(Color(0xFFFDECEE), Color(0xFFE11D48)),
};

// Donut / vendor palette (financeKit CATEGORY_COLORS).
const _catColors = <Color>[
  Color(0xFF2F7A4F),
  Color(0xFF2A78D6),
  Color(0xFFA67C2E),
  Color(0xFFD9569A),
];
const _catOther = Color(0xFF9A9B95);
const _vendorBar = Color(0xFF2F7A4F);

// ─────────────────────────────────────────────────────────────────────────────
// Title
// ─────────────────────────────────────────────────────────────────────────────

class _Title extends StatelessWidget {
  const _Title();
  @override
  Widget build(BuildContext context) {
    return Text('Finance',
        style: AppText.display().copyWith(fontSize: 30, height: 1.05));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab rail — 6 equal cells, dark active pill (INK plate), icon over label
// ─────────────────────────────────────────────────────────────────────────────

class _TabRail extends StatelessWidget {
  final String active;
  final ValueChanged<String> onSelect;
  final Future<int> pendingFuture;
  const _TabRail({
    required this.active,
    required this.onSelect,
    required this.pendingFuture,
  });

  static const _tabs = <(String, String, IconData)>[
    ('overview', 'Overview', Icons.pie_chart_outline_rounded),
    ('revenue', 'Revenue', Icons.currency_rupee_rounded),
    ('expenses', 'Expenses', Icons.receipt_long_outlined),
    ('assets', 'Assets', Icons.apartment_rounded),
    ('inventory', 'Inventory', Icons.inventory_2_outlined),
    ('inbox', 'Inbox', Icons.inbox_outlined),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.75),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF2A3542).withValues(alpha: 0.14),
            offset: const Offset(0, 6),
            blurRadius: 16,
            spreadRadius: -8,
          ),
        ],
      ),
      child: Row(
        children: [
          for (final t in _tabs)
            Expanded(
              child: _TabCell(
                label: t.$2,
                icon: t.$3,
                active: t.$1 == active,
                showBadge: t.$1 == 'inbox',
                pendingFuture: pendingFuture,
                onTap: () => onSelect(t.$1),
              ),
            ),
        ],
      ),
    );
  }
}

class _TabCell extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool active;
  final bool showBadge;
  final Future<int> pendingFuture;
  final VoidCallback onTap;
  const _TabCell({
    required this.label,
    required this.icon,
    required this.active,
    required this.showBadge,
    required this.pendingFuture,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final fg = active ? Colors.white : const Color(0xFF64748B);
    final baseIcon = Icon(icon, size: 17, color: fg);
    Widget iconWidget = baseIcon;
    if (showBadge) {
      iconWidget = FutureBuilder<int>(
        future: pendingFuture,
        builder: (context, snap) {
          final count = snap.data ?? 0;
          if (count == 0) return baseIcon;
          return Stack(
            clipBehavior: Clip.none,
            children: [
              baseIcon,
              Positioned(
                right: -8,
                top: -6,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 15),
                  height: 15,
                  padding: const EdgeInsets.symmetric(horizontal: 3),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: active ? Colors.white : const Color(0xFFF97316),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text('$count',
                      style: TextStyle(
                        fontSize: 9,
                        height: 1,
                        fontWeight: FontWeight.w700,
                        color: active ? const Color(0xFF171717) : Colors.white,
                      )),
                ),
              ),
            ],
          );
        },
      );
    }
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
        decoration: active
            ? BoxDecoration(
                gradient: AppInk.plate,
                borderRadius: BorderRadius.circular(15),
              )
            : null,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            iconWidget,
            const SizedBox(height: 3),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              softWrap: false,
              style: TextStyle(
                fontSize: 10,
                height: 1.1,
                fontWeight: active ? FontWeight.w600 : FontWeight.w500,
                color: fg,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Controls row — period pill (Overview) + dark Add button
// ─────────────────────────────────────────────────────────────────────────────

class _ControlsRow extends StatelessWidget {
  final String tab;
  final int? periodDays;
  final ValueChanged<int?> onPeriod;
  final VoidCallback onAdded;
  const _ControlsRow({
    required this.tab,
    required this.periodDays,
    required this.onPeriod,
    required this.onAdded,
  });

  // The primary "Add X" per records tab; null on Overview/Inbox → "Add record".
  static const _primary = <String, (String, String)>{
    'revenue': ('Add income', 'income'),
    'expenses': ('Add Expense', 'expense'),
    'assets': ('Add Asset', 'asset'),
    'inventory': ('Add Item', 'inventory'),
  };

  @override
  Widget build(BuildContext context) {
    final primary = _primary[tab];
    final addBtn = _AddRecordButton(
      label: primary?.$1 ?? 'Add record',
      primaryKind: primary?.$2,
      onAdded: onAdded,
    );
    if (tab == 'overview') {
      return Row(
        children: [
          _PeriodPill(days: periodDays, onPick: onPeriod),
          const Spacer(),
          addBtn,
        ],
      );
    }
    return Align(alignment: Alignment.centerLeft, child: addBtn);
  }
}

class _PeriodPill extends StatelessWidget {
  final int? days;
  final ValueChanged<int?> onPick;
  const _PeriodPill({required this.days, required this.onPick});

  Future<void> _open(BuildContext context) async {
    // Rows pop a 1-element list so a barrier dismiss (null) is distinct from
    // the "All time" choice (a list holding null).
    final picked = await showModalBottomSheet<List<int?>>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            for (final p in _periods)
              ListTile(
                title: Text(p.$1),
                trailing: p.$2 == days
                    ? const Icon(Icons.check_rounded, color: AppColors.brand)
                    : null,
                onTap: () => Navigator.pop(ctx, <int?>[p.$2]),
              ),
          ],
        ),
      ),
    );
    if (picked != null) onPick(picked.first);
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.85),
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        onTap: () => _open(context),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          height: 40,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.calendar_today_rounded,
                  size: 14, color: AppColors.textSecondary),
              const SizedBox(width: 8),
              Text(_periodLabel(days),
                  style: AppText.smallStrong().copyWith(fontSize: 13)),
              const SizedBox(width: 4),
              const Icon(Icons.keyboard_arrow_down_rounded,
                  size: 18, color: AppColors.textSecondary),
            ],
          ),
        ),
      ),
    );
  }
}

/// The dark "Add …" button. On a records tab it is a split control: the label
/// opens that kind's form, the caret opens the full 4-kind menu. On Overview/
/// Inbox the whole pill opens the menu.
class _AddRecordButton extends StatelessWidget {
  final String label;
  final String? primaryKind; // income|expense|asset|inventory or null
  final VoidCallback onAdded;
  const _AddRecordButton({
    required this.label,
    required this.primaryKind,
    required this.onAdded,
  });

  Future<void> _openKind(BuildContext context, String kind) async {
    bool saved = false;
    if (kind == 'expense') {
      saved = await showModalBottomSheet<bool>(
            context: context,
            isScrollControlled: true,
            backgroundColor: AppColors.surface,
            shape: const RoundedRectangleBorder(
                borderRadius:
                    BorderRadius.vertical(top: Radius.circular(AppRadius.lg))),
            builder: (_) => const _AddExpenseSheet(),
          ) ??
          false;
    } else {
      saved = await showModalBottomSheet<bool>(
            context: context,
            isScrollControlled: true,
            backgroundColor: Colors.transparent,
            builder: (_) => _AddMoneySheet(kind: kind),
          ) ??
          false;
    }
    if (saved) onAdded();
  }

  Future<void> _openMenu(BuildContext context) async {
    final kind = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            _addMenuRow(ctx, Icons.currency_rupee_rounded, 'Income',
                'A sale or service invoice — money in from a customer', 'income'),
            _addMenuRow(ctx, Icons.receipt_long_outlined, 'Expense',
                'A bill or payment — money out to a vendor', 'expense'),
            _addMenuRow(ctx, Icons.apartment_rounded, 'Asset',
                'Machinery, equipment or property you own', 'asset'),
            _addMenuRow(ctx, Icons.inventory_2_outlined, 'Inventory item',
                'Stock on hand; value is quantity × unit cost', 'inventory'),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
    if (kind != null && context.mounted) await _openKind(context, kind);
  }

  Widget _addMenuRow(BuildContext ctx, IconData icon, String title,
      String hint, String kind) {
    return ListTile(
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppColors.textPrimary.withValues(alpha: 0.05),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Icon(icon, size: 18, color: AppColors.textPrimary),
      ),
      title: Text(title, style: AppText.bodyStrong().copyWith(fontSize: 14)),
      subtitle: Text(hint,
          style: AppText.small()
              .copyWith(fontSize: 11, color: AppColors.textSecondary)),
      onTap: () => Navigator.pop(ctx, kind),
    );
  }

  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    if (primaryKind == null) {
      return _inkPill(
        onTap: () => _openMenu(context),
        child: Row(mainAxisSize: MainAxisSize.min, children: const [
          Icon(Icons.add_rounded, size: 16, color: Colors.white),
          SizedBox(width: 6),
          Text('Add record',
              style: TextStyle(
                  color: Colors.white,
                  fontSize: 13,
                  fontWeight: FontWeight.w600)),
          SizedBox(width: 4),
          Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: Colors.white),
        ]),
      );
    }
    // Split control.
    return ClipRRect(
      borderRadius: r,
      child: DecoratedBox(
        decoration: BoxDecoration(gradient: AppInk.plate, borderRadius: r),
        child: IntrinsicHeight(
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            InkWell(
              onTap: () => _openKind(context, primaryKind!),
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  const Icon(Icons.add_rounded, size: 16, color: Colors.white),
                  const SizedBox(width: 6),
                  Text(label,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w600)),
                ]),
              ),
            ),
            Container(width: 1, color: Colors.white.withValues(alpha: 0.18)),
            InkWell(
              onTap: () => _openMenu(context),
              child: const Padding(
                padding: EdgeInsets.symmetric(horizontal: 8),
                child: Icon(Icons.keyboard_arrow_down_rounded,
                    size: 18, color: Colors.white),
              ),
            ),
          ]),
        ),
      ),
    );
  }

  Widget _inkPill({required Widget child, required VoidCallback onTap}) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: Colors.transparent,
      borderRadius: r,
      child: Ink(
        decoration: BoxDecoration(gradient: AppInk.plate, borderRadius: r),
        child: InkWell(
          onTap: onTap,
          borderRadius: r,
          child: Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
            child: child,
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick capture card
// ─────────────────────────────────────────────────────────────────────────────

class _QuickCapture extends StatelessWidget {
  final Future<int> pendingFuture;
  final VoidCallback onRefresh;
  final VoidCallback onOpenInbox;
  const _QuickCapture({
    required this.pendingFuture,
    required this.onRefresh,
    required this.onOpenInbox,
  });

  Future<void> _uploadDoc(BuildContext context, {required bool camera}) async {
    try {
      List<int>? bytes;
      String name = 'capture';
      if (camera) {
        final x = await ImagePicker()
            .pickImage(source: ImageSource.camera, imageQuality: 82);
        if (x == null) return;
        bytes = await x.readAsBytes();
        name = x.name;
      } else {
        final r = await FilePicker.platform.pickFiles(
          withData: true,
          type: FileType.custom,
          allowedExtensions: const ['pdf', 'png', 'jpg', 'jpeg', 'webp'],
        );
        if (r == null || r.files.isEmpty || r.files.single.bytes == null) return;
        bytes = r.files.single.bytes!;
        name = r.files.single.name;
      }
      if (!context.mounted) return;
      _snack(context, 'Extracting $name…');
      await MoneyRepository().ingestDocument(bytes: bytes, filename: name);
      onRefresh();
      if (context.mounted) {
        _snack(context, 'Extracted — review in Inbox');
        onOpenInbox();
      }
    } catch (_) {
      if (context.mounted) _snack(context, 'Could not read that file.');
    }
  }

  Future<void> _uploadCsv(BuildContext context) async {
    try {
      final r = await FilePicker.platform.pickFiles(
        withData: true,
        type: FileType.custom,
        allowedExtensions: const ['csv', 'xlsx', 'xls'],
      );
      if (r == null || r.files.isEmpty || r.files.single.bytes == null) return;
      if (!context.mounted) return;
      _snack(context, 'Importing ${r.files.single.name}…');
      await MoneyRepository()
          .ingestCsv(bytes: r.files.single.bytes!, filename: r.files.single.name);
      onRefresh();
      if (context.mounted) {
        _snack(context, 'Imported — review in Inbox');
        onOpenInbox();
      }
    } catch (_) {
      if (context.mounted) _snack(context, 'Could not import that sheet.');
    }
  }

  Future<void> _addExpense(BuildContext context) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg))),
      builder: (_) => const _AddExpenseSheet(),
    );
    if (saved == true) onRefresh();
  }

  Future<void> _ask(BuildContext context, String q) async {
    if (q.trim().isEmpty) return;
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg))),
      builder: (_) => _AskAnswerSheet(question: q.trim()),
    );
  }

  void _snack(BuildContext context, String m) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Quick capture',
                        style: AppText.bodyStrong().copyWith(fontSize: 15)),
                    const SizedBox(height: 2),
                    Text('Upload a bill or receipt and AI reads it for you.',
                        style: AppText.small().copyWith(
                            fontSize: 12, color: AppColors.textSecondary)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              _InboxRoundButton(
                  pendingFuture: pendingFuture, onTap: onOpenInbox),
            ],
          ),
          const SizedBox(height: 14),
          Row(children: [
            Expanded(
                child: _CaptureButton(
                    icon: Icons.picture_as_pdf_outlined,
                    label: 'Upload bill',
                    onTap: () => _uploadDoc(context, camera: false))),
            const SizedBox(width: 8),
            Expanded(
                child: _CaptureButton(
                    icon: Icons.photo_camera_outlined,
                    label: 'Photo',
                    onTap: () => _uploadDoc(context, camera: true))),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(
                child: _CaptureButton(
                    icon: Icons.add_rounded,
                    label: 'Add expense',
                    onTap: () => _addExpense(context))),
            const SizedBox(width: 8),
            Expanded(
                child: _CaptureButton(
                    icon: Icons.file_upload_outlined,
                    label: 'CSV / Excel',
                    onTap: () => _uploadCsv(context))),
          ]),
          const SizedBox(height: 14),
          _AskField(onSubmit: (q) => _ask(context, q)),
        ],
      ),
    );
  }
}

class _InboxRoundButton extends StatelessWidget {
  final Future<int> pendingFuture;
  final VoidCallback onTap;
  const _InboxRoundButton({required this.pendingFuture, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration:
                BoxDecoration(gradient: AppInk.plate, shape: BoxShape.circle),
            child: const Icon(Icons.inbox_outlined, size: 16, color: Colors.white),
          ),
          Positioned(
            right: -4,
            top: -4,
            child: FutureBuilder<int>(
              future: pendingFuture,
              builder: (context, snap) {
                final count = snap.data ?? 0;
                if (count == 0) return const SizedBox.shrink();
                return Container(
                  constraints: const BoxConstraints(minWidth: 18),
                  height: 18,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: const Color(0xFFF97316),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: Colors.white, width: 1.5),
                  ),
                  child: Text('$count',
                      style: const TextStyle(
                          fontSize: 10,
                          height: 1,
                          fontWeight: FontWeight.w700,
                          color: Colors.white)),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _CaptureButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _CaptureButton(
      {required this.icon, required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: Colors.white.withValues(alpha: 0.8),
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: r,
            border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 17, color: AppColors.textPrimary),
            const SizedBox(width: 8),
            Flexible(
              child: Text(label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.smallStrong().copyWith(fontSize: 13)),
            ),
          ]),
        ),
      ),
    );
  }
}

class _AskField extends StatefulWidget {
  final ValueChanged<String> onSubmit;
  const _AskField({required this.onSubmit});
  @override
  State<_AskField> createState() => _AskFieldState();
}

class _AskFieldState extends State<_AskField> {
  final _c = TextEditingController();
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  void _send() {
    widget.onSubmit(_c.text);
    _c.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.only(left: 14, right: 4),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.hairline),
      ),
      child: Row(children: [
        const Icon(Icons.chat_bubble_outline_rounded,
            size: 16, color: AppColors.textTertiary),
        const SizedBox(width: 8),
        Expanded(
          child: TextField(
            controller: _c,
            onSubmitted: (_) => _send(),
            style: AppText.body().copyWith(fontSize: 13),
            decoration: InputDecoration(
              hintText: 'Ask about your finances…',
              hintStyle: AppText.small()
                  .copyWith(fontSize: 12, color: AppColors.textTertiary),
              border: InputBorder.none,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
            ),
          ),
        ),
        Material(
          color: Colors.transparent,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: _send,
            child: Container(
              width: 34,
              height: 34,
              margin: const EdgeInsets.symmetric(vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white,
                shape: BoxShape.circle,
                border:
                    Border.all(color: AppColors.nmEdge.withValues(alpha: 0.6)),
              ),
              child: const Icon(Icons.arrow_forward_rounded,
                  size: 16, color: AppColors.textPrimary),
            ),
          ),
        ),
      ]),
    );
  }
}

/// A bottom sheet that answers a finance question via POST /ledger/ask.
class _AskAnswerSheet extends StatefulWidget {
  final String question;
  const _AskAnswerSheet({required this.question});
  @override
  State<_AskAnswerSheet> createState() => _AskAnswerSheetState();
}

class _AskAnswerSheetState extends State<_AskAnswerSheet> {
  String? _answer;
  @override
  void initState() {
    super.initState();
    MoneyRepository().ask(widget.question).then((a) {
      if (mounted) {
        setState(() => _answer =
            a.isEmpty ? "I couldn't find an answer — try rephrasing." : a);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 18, 20, 20 + bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 32,
              height: 32,
              decoration: const BoxDecoration(
                  color: Color(0xFFEADFF9), shape: BoxShape.circle),
              child: const Icon(Icons.auto_awesome_rounded,
                  size: 15, color: Color(0xFF7C3AED)),
            ),
            const SizedBox(width: 10),
            Expanded(
                child: Text(widget.question,
                    style: AppText.bodyStrong().copyWith(fontSize: 14))),
          ]),
          const SizedBox(height: 16),
          if (_answer == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Row(children: [
                SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2)),
                SizedBox(width: 12),
                Text('Thinking…'),
              ]),
            )
          else
            Text(_answer!,
                style: AppText.body().copyWith(fontSize: 14, height: 1.5)),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab body dispatch
// ─────────────────────────────────────────────────────────────────────────────

class _TabBody extends StatelessWidget {
  final String tab;
  final Future<_OverviewData> overviewFuture;
  final Future<List<Revenue>> revenueFuture;
  final Future<List<Expense>> expensesFuture;
  final Future<List<Asset>>? assetsFuture;
  final Future<List<InventoryItem>>? inventoryFuture;
  final Future<FinanceBrief> Function(String) brief;
  final int? periodDays;
  final String periodLabel;
  final ValueChanged<String> onTabChange;
  final VoidCallback onRefresh;
  const _TabBody({
    required this.tab,
    required this.overviewFuture,
    required this.revenueFuture,
    required this.expensesFuture,
    required this.assetsFuture,
    required this.inventoryFuture,
    required this.brief,
    required this.periodDays,
    required this.periodLabel,
    required this.onTabChange,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    switch (tab) {
      case 'overview':
        return _OverviewBody(
          future: overviewFuture,
          brief: brief,
          periodDays: periodDays,
          periodLabel: periodLabel,
          onTabChange: onTabChange,
        );
      case 'revenue':
        return _RevenueBody(
            future: revenueFuture, brief: brief, onRefresh: onRefresh);
      case 'expenses':
        return _ExpensesBody(
            future: expensesFuture, brief: brief, onRefresh: onRefresh);
      case 'assets':
        return _AssetsBody(
            future: assetsFuture!, brief: brief, onRefresh: onRefresh);
      case 'inventory':
        return _InventoryBody(
            future: inventoryFuture!, brief: brief, onRefresh: onRefresh);
      case 'inbox':
        return _InboxBody(onRefresh: onRefresh);
    }
    return const SizedBox();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

/// The Overview's three loaded sources (summary is all-time; revenue + expenses
/// are windowed client-side).
class _OverviewData {
  final LedgerSummary summary;
  final List<Revenue> invoices;
  final List<Expense> expenses;
  const _OverviewData(this.summary, this.invoices, this.expenses);
}

/// The period-windowed figures the Overview renders. Flows (billed, received,
/// spend, net, category, vendor) respect `days`; asset/inventory are all-time
/// holdings straight from the summary.
class _OverviewMetrics {
  final double revenueBilled;
  final double received;
  final double totalSpend;
  final double netProfit;
  final double outstanding;
  final int oldestOverdueDays;
  final double? assetValue;
  final double? inventoryValue;
  final List<CategorySpend> byCategory;
  final List<VendorSpend> byVendor;
  final List<double> monthlyNet;
  const _OverviewMetrics({
    required this.revenueBilled,
    required this.received,
    required this.totalSpend,
    required this.netProfit,
    required this.outstanding,
    required this.oldestOverdueDays,
    required this.assetValue,
    required this.inventoryValue,
    required this.byCategory,
    required this.byVendor,
    required this.monthlyNet,
  });

  factory _OverviewMetrics.from(_OverviewData d, int? days) {
    final s = d.summary;
    final cutoff =
        days == null ? null : DateTime.now().subtract(Duration(days: days));
    bool inWindow(DateTime? dt) =>
        cutoff == null || (dt != null && !dt.isBefore(cutoff));

    final now = DateTime.now();
    double billed = 0, received = 0, outstanding = 0, spend = 0;
    int oldest = 0;
    for (final i in d.invoices) {
      if (!inWindow(i.date)) continue;
      billed += i.amount;
      final st = i.status.toLowerCase();
      if (st == 'paid') {
        received += i.amount;
      } else {
        outstanding += i.amount;
        if (st == 'overdue' && i.date != null) {
          final days = now.difference(i.date!).inDays;
          if (days > oldest) oldest = days;
        }
      }
    }
    final cat = <String, double>{};
    final ven = <String, double>{};
    for (final e in d.expenses) {
      if (!inWindow(e.date)) continue;
      spend += e.amount;
      final c = (e.category ?? '').trim();
      cat[c.isEmpty ? 'Other' : c] = (cat[c.isEmpty ? 'Other' : c] ?? 0) + e.amount;
      final v = (e.vendor ?? '').trim();
      ven[v.isEmpty ? 'Unspecified' : v] =
          (ven[v.isEmpty ? 'Unspecified' : v] ?? 0) + e.amount;
    }
    final byCat = cat.entries
        .map((e) => CategorySpend(category: e.key, amount: e.value))
        .toList()
      ..sort((a, b) => b.amount.compareTo(a.amount));
    final byVen = (ven.entries
        .map((e) => VendorSpend(vendor: e.key, amount: e.value))
        .toList()
      ..sort((a, b) => b.amount.compareTo(a.amount)));
    // All-time received is more accurate straight from the summary (real
    // payments); windowed received is the paid-invoice proxy computed above.
    final recvd =
        days == null ? (s.revenueReceived ?? received) : received;
    return _OverviewMetrics(
      revenueBilled: billed,
      received: recvd,
      totalSpend: spend,
      netProfit: billed - spend,
      outstanding: outstanding,
      oldestOverdueDays: oldest,
      assetValue: s.assetValue,
      inventoryValue: s.inventoryValue,
      byCategory: byCat,
      byVendor: byVen.take(8).toList(),
      monthlyNet: s.monthlyNet,
    );
  }
}

class _OverviewBody extends StatelessWidget {
  final Future<_OverviewData> future;
  final Future<FinanceBrief> Function(String) brief;
  final int? periodDays;
  final String periodLabel;
  final ValueChanged<String> onTabChange;
  const _OverviewBody({
    required this.future,
    required this.brief,
    required this.periodDays,
    required this.periodLabel,
    required this.onTabChange,
  });

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_OverviewData>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const Column(children: [
            LoadingCard(height: 120),
            SizedBox(height: 12),
            LoadingCard(height: 200),
          ]);
        }
        if (snap.hasError || snap.data == null) {
          return const ErrorState(message: "Couldn't load your finances.");
        }
        final m = _OverviewMetrics.from(snap.data!, periodDays);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _KpiGrid(m: m, onTabChange: onTabChange),
            const SizedBox(height: AppSpacing.md),
            _AiPanel(
              scope: 'brief',
              variant: _AiVariant.brief,
              future: brief('brief'),
              profit: m.netProfit,
              outstanding: m.outstanding,
              oldestOverdueDays: m.oldestOverdueDays,
            ),
            const SizedBox(height: AppSpacing.md),
            _SpendDonut(categories: m.byCategory, periodLabel: periodLabel),
            const SizedBox(height: AppSpacing.md),
            _TopVendors(
                vendors: m.byVendor,
                periodLabel: periodLabel,
                onViewAll: () => onTabChange('expenses')),
            const SizedBox(height: AppSpacing.md),
            const _AutoFlowFooter(),
          ],
        );
      },
    );
  }
}

class _KpiSpec {
  final String label;
  final double? value;
  final IconData icon;
  final String tone;
  final bool spark;
  final String tab;
  const _KpiSpec(this.label, this.value, this.icon, this.tone, this.spark,
      this.tab);
}

class _KpiGrid extends StatelessWidget {
  final _OverviewMetrics m;
  final ValueChanged<String> onTabChange;
  const _KpiGrid({required this.m, required this.onTabChange});
  @override
  Widget build(BuildContext context) {
    final specs = <_KpiSpec>[
      _KpiSpec('Revenue billed', m.revenueBilled, Icons.currency_rupee_rounded,
          'emerald', true, 'revenue'),
      _KpiSpec('Received', m.received, Icons.download_rounded, 'sky', true,
          'revenue'),
      _KpiSpec('Net profit', m.netProfit, Icons.pie_chart_outline_rounded,
          'orange', true, 'expenses'),
      _KpiSpec('Total Spend', m.totalSpend, Icons.trending_up_rounded, 'slate',
          true, 'expenses'),
      _KpiSpec('Asset Value', m.assetValue, Icons.widgets_outlined, 'violet',
          false, 'assets'),
      _KpiSpec('Inventory Value', m.inventoryValue, Icons.inventory_2_outlined,
          'amber', false, 'inventory'),
    ];
    final rows = <Widget>[];
    for (int i = 0; i < specs.length; i += 2) {
      rows.add(IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
                child: _KpiCard(
                    spec: specs[i],
                    series: m.monthlyNet,
                    onTap: () => onTabChange(specs[i].tab))),
            const SizedBox(width: 10),
            Expanded(
                child: _KpiCard(
                    spec: specs[i + 1],
                    series: m.monthlyNet,
                    onTap: () => onTabChange(specs[i + 1].tab))),
          ],
        ),
      ));
      if (i + 2 < specs.length) rows.add(const SizedBox(height: 10));
    }
    return Column(children: rows);
  }
}

class _KpiCard extends StatelessWidget {
  final _KpiSpec spec;
  final List<double> series;
  final VoidCallback onTap;
  const _KpiCard(
      {required this.spec, required this.series, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final tone = _tones[spec.tone]!;
    final showSpark = spec.spark && series.length >= 2;
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(color: tone.bg, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: Icon(spec.icon, size: 19, color: tone.fg),
            ),
            const Spacer(),
            const _DeltaChip(),
          ]),
          const SizedBox(height: 14),
          Text(spec.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.small()
                  .copyWith(fontSize: 12.5, color: AppColors.textSecondary)),
          const SizedBox(height: 4),
          Text(spec.value == null ? '—' : _rupeeFull(spec.value!),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.h3().copyWith(
                fontSize: 20,
                height: 1.1,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                fontFeatures: const [FontFeature.tabularFigures()],
              )),
          const SizedBox(height: 10),
          SizedBox(
            height: 32,
            width: double.infinity,
            child: showSpark
                ? Sparkline(points: series, color: tone.fg, strokeWidth: 2.2)
                : const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}

/// The "↗ New" delta chip — every KPI here is a fresh (first-window) metric, so
/// it reads "New" exactly like the PWA's fresh case.
class _DeltaChip extends StatelessWidget {
  const _DeltaChip();
  @override
  Widget build(BuildContext context) {
    return Row(mainAxisSize: MainAxisSize.min, children: const [
      Icon(Icons.arrow_outward_rounded, size: 12, color: Color(0xFF64748B)),
      SizedBox(width: 2),
      Text('New',
          style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: Color(0xFF64748B))),
    ]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Finance Brief / Analysis
// ─────────────────────────────────────────────────────────────────────────────

enum _AiVariant { brief, inline }

class _AiPanel extends StatefulWidget {
  final String scope;
  final _AiVariant variant;
  final Future<FinanceBrief> future;
  // Brief-only facts.
  final double? profit;
  final double? outstanding;
  final int oldestOverdueDays;
  const _AiPanel({
    required this.scope,
    required this.variant,
    required this.future,
    this.profit,
    this.outstanding,
    this.oldestOverdueDays = 0,
  });
  @override
  State<_AiPanel> createState() => _AiPanelState();
}

class _AiPanelState extends State<_AiPanel> {
  late Future<FinanceBrief> _future = widget.future;
  bool _refreshing = false;
  int? _openInsight;

  String get _scopeLabel => switch (widget.scope) {
        'revenue' => 'revenue',
        'expenses' => 'expenses',
        'assets' => 'assets',
        'inventory' => 'inventory',
        _ => 'finances',
      };

  Future<void> _refresh() async {
    setState(() => _refreshing = true);
    try {
      final b = await MoneyRepository().refreshBrief(widget.scope);
      if (mounted) setState(() => _future = Future.value(b));
    } catch (_) {
      // keep the current brief
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  // Spin an Action Item into a real task (POST /tasks).
  Future<void> _createTask(FinanceInsight ins) async {
    final title = ins.action.isNotEmpty ? ins.action : ins.title;
    try {
      await TasksRepository().create({
        'title': title,
        if (ins.detail.isNotEmpty) 'description': ins.detail,
      });
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Task created')));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text("Couldn't create the task.")));
      }
    }
  }

  // Ask AI to expand on an Action Item.
  void _askInsight(FinanceInsight ins) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.lg))),
      builder: (_) => _AskAnswerSheet(question: ins.title),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isBrief = widget.variant == _AiVariant.brief;
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: FutureBuilder<FinanceBrief>(
        future: _future,
        builder: (context, snap) {
          final brief = snap.data ?? const FinanceBrief();
          final loading = snap.connectionState != ConnectionState.done;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFFFFF4E0), Color(0xFFFFE6D2)],
                    ),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: const Color(0xFFFFE0C2)),
                  ),
                  alignment: Alignment.center,
                  child: const Icon(Icons.auto_awesome_rounded,
                      size: 20, color: Color(0xFFF97316)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(children: [
                        Flexible(
                          child: Text(
                              isBrief ? 'AI Finance Brief' : 'AI Analysis',
                              style:
                                  AppText.h3().copyWith(fontSize: 17)),
                        ),
                        if (isBrief) ...[
                          const SizedBox(width: 8),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: const Color(0xFFE6F2FB),
                              borderRadius: BorderRadius.circular(999),
                            ),
                            child: const Text('Beta',
                                style: TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w600,
                                    color: Color(0xFF0369A1))),
                          ),
                        ],
                      ]),
                      const SizedBox(height: 2),
                      Text(
                          isBrief
                              ? 'Key insights, risks and opportunities from your financial data.'
                              : 'What stands out in your $_scopeLabel.',
                          style: AppText.small().copyWith(
                              fontSize: 12, color: AppColors.textSecondary)),
                    ],
                  ),
                ),
              ]),
              const SizedBox(height: 14),
              Align(
                alignment: Alignment.centerLeft,
                child: _RefreshPill(
                    busy: _refreshing || loading, onTap: _refresh),
              ),
              // Brief highlight card
              if (isBrief) ...[
                const SizedBox(height: 16),
                _BriefHighlight(
                  headline: brief.headline,
                  profit: widget.profit,
                  outstanding: widget.outstanding,
                  oldestOverdueDays: widget.oldestOverdueDays,
                ),
              ] else ...[
                const SizedBox(height: 14),
                Text(
                    brief.headline.isEmpty
                        ? 'No analysis yet — press Refresh.'
                        : brief.headline,
                    style: AppText.bodyStrong()
                        .copyWith(fontSize: 14, height: 1.45)),
              ],
              // Action items
              if (brief.insights.isNotEmpty) ...[
                const SizedBox(height: 18),
                Text('Action Items · most urgent first',
                    style: AppText.smallStrong().copyWith(
                        fontSize: 13, color: AppColors.textSecondary)),
                const SizedBox(height: 8),
                for (int i = 0; i < brief.insights.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: _InsightRow(
                      insight: brief.insights[i],
                      open: _openInsight == i,
                      onTap: () => setState(
                          () => _openInsight = _openInsight == i ? null : i),
                      onCreateTask: () => _createTask(brief.insights[i]),
                      onAskAI: () => _askInsight(brief.insights[i]),
                    ),
                  ),
              ],
              // Ask block
              const SizedBox(height: 18),
              const Divider(height: 1),
              const SizedBox(height: 16),
              Row(children: [
                const Icon(Icons.psychology_alt_outlined,
                    size: 18, color: AppColors.textSecondary),
                const SizedBox(width: 8),
                Text('Ask AI about your $_scopeLabel',
                    style: AppText.bodyStrong().copyWith(fontSize: 14)),
              ]),
              const SizedBox(height: 12),
              _AiAsk(scope: widget.scope == 'brief' ? 'brief' : widget.scope),
            ],
          );
        },
      ),
    );
  }
}

class _RefreshPill extends StatelessWidget {
  final bool busy;
  final VoidCallback onTap;
  const _RefreshPill({required this.busy, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: Colors.white.withValues(alpha: 0.8),
      borderRadius: r,
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: r,
        child: Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            borderRadius: r,
            border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            busy
                ? const SizedBox(
                    width: 13,
                    height: 13,
                    child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.refresh_rounded, size: 15),
            const SizedBox(width: 6),
            Text(busy ? 'Analysing…' : 'Refresh',
                style: AppText.smallStrong().copyWith(fontSize: 13)),
          ]),
        ),
      ),
    );
  }
}

class _BriefHighlight extends StatelessWidget {
  final String headline;
  final double? profit;
  final double? outstanding;
  final int oldestOverdueDays;
  const _BriefHighlight({
    required this.headline,
    required this.profit,
    required this.outstanding,
    required this.oldestOverdueDays,
  });

  @override
  Widget build(BuildContext context) {
    final positive = (profit ?? 0) >= 0;
    final tint = positive ? const Color(0xFF047857) : const Color(0xFFBE123C);
    final bg = positive ? const Color(0xFFECFDF3) : const Color(0xFFFFF1F2);
    final ring = positive ? const Color(0xFFC7EAD5) : const Color(0xFFFAD1D5);
    // Split the headline into a bold title (first sentence) + a lighter line.
    String title = headline;
    String line = '';
    if (headline.isNotEmpty) {
      final idx = headline.indexOf(RegExp(r'[.:—-]'));
      if (idx > 0 && idx < headline.length - 1) {
        title = headline.substring(0, idx).trim();
        line = headline.substring(idx + 1).trim();
      }
    } else {
      title = 'No brief yet — press Refresh to analyse your finances.';
    }
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: ring),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 44,
              height: 44,
              decoration:
                  const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
              alignment: Alignment.center,
              child: Icon(
                  positive
                      ? Icons.north_east_rounded
                      : Icons.south_east_rounded,
                  size: 20,
                  color: tint),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,
                      style: AppText.h3().copyWith(fontSize: 16, height: 1.25)),
                  if (line.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(line,
                        style: AppText.small().copyWith(
                            fontSize: 13, color: AppColors.textSecondary)),
                  ],
                ],
              ),
            ),
          ]),
          const SizedBox(height: 14),
          const Divider(height: 1),
          const SizedBox(height: 12),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _fact('Estimated profit',
                  profit == null ? '—' : _rupeeCompact(profit!)),
              _factDivider(),
              _fact('Outstanding receivables',
                  outstanding == null ? '—' : _rupeeCompact(outstanding!)),
              _factDivider(),
              _fact('Oldest overdue',
                  oldestOverdueDays > 0 ? '$oldestOverdueDays days' : 'None'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _fact(String label, String value) => Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value,
                style: AppText.h3().copyWith(fontSize: 17),
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            Text(label,
                style: AppText.small()
                    .copyWith(fontSize: 11, color: AppColors.textSecondary)),
          ],
        ),
      );

  Widget _factDivider() => Container(
        width: 1,
        height: 34,
        margin: const EdgeInsets.symmetric(horizontal: 10),
        color: Colors.black.withValues(alpha: 0.08),
      );
}

class _InsightMeta {
  final String pill;
  final Color bar;
  final Color rowBg;
  final Color chipBg;
  final Color chipFg;
  const _InsightMeta(
      this.pill, this.bar, this.rowBg, this.chipBg, this.chipFg);
}

const _insightMeta = <String, _InsightMeta>{
  'high': _InsightMeta('Urgent', Color(0xFFF43F5E), Color(0xFFFFF1F2),
      Color(0xFFFFE4E6), Color(0xFFBE123C)),
  'medium': _InsightMeta('Important', Color(0xFFFB923C), Color(0xFFFFF7ED),
      Color(0xFFFFEDD5), Color(0xFFC2410C)),
  'low': _InsightMeta('FYI', Color(0xFFCBD5E1), Color(0xFFF8FAFC),
      Color(0xFFEEF1F5), Color(0xFF64748B)),
};

class _InsightRow extends StatelessWidget {
  final FinanceInsight insight;
  final bool open;
  final VoidCallback onTap;
  final VoidCallback onCreateTask;
  final VoidCallback onAskAI;
  const _InsightRow({
    required this.insight,
    required this.open,
    required this.onTap,
    required this.onCreateTask,
    required this.onAskAI,
  });
  @override
  Widget build(BuildContext context) {
    final meta = _insightMeta[insight.level] ?? _insightMeta['medium']!;
    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: Container(
        decoration: BoxDecoration(
          color: meta.rowBg,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.black.withValues(alpha: 0.05)),
        ),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(width: 4, color: meta.bar),
              Expanded(
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: onTap,
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(12, 11, 12, 11),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(children: [
                            Container(
                              width: 8,
                              height: 8,
                              decoration: BoxDecoration(
                                  color: meta.bar, shape: BoxShape.circle),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(insight.title,
                                  maxLines: open ? 4 : 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.smallStrong()
                                      .copyWith(fontSize: 13, height: 1.3)),
                            ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(
                                color: meta.chipBg,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(meta.pill,
                                  style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: meta.chipFg)),
                            ),
                            const SizedBox(width: 4),
                            Icon(
                                open
                                    ? Icons.keyboard_arrow_up_rounded
                                    : Icons.chevron_right_rounded,
                                size: 18,
                                color: AppColors.textTertiary),
                          ]),
                          if (open) ...[
                            if (insight.detail.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              Padding(
                                padding: const EdgeInsets.only(left: 18),
                                child: Text(insight.detail,
                                    style: AppText.small().copyWith(
                                        fontSize: 12.5,
                                        height: 1.45,
                                        color: AppColors.textSecondary)),
                              ),
                            ],
                            if (insight.action.isNotEmpty &&
                                insight.action != insight.title) ...[
                              const SizedBox(height: 6),
                              Padding(
                                padding: const EdgeInsets.only(left: 18),
                                child: Text('Next step: ${insight.action}',
                                    style: AppText.smallStrong().copyWith(
                                        fontSize: 12.5, height: 1.4)),
                              ),
                            ],
                            const SizedBox(height: 10),
                            Padding(
                              padding: const EdgeInsets.only(left: 18),
                              child: Row(children: [
                                _InsightBtn(
                                    label: 'Create task',
                                    icon: Icons.playlist_add_rounded,
                                    filled: true,
                                    onTap: onCreateTask),
                                const SizedBox(width: 8),
                                _InsightBtn(
                                    label: 'Ask AI',
                                    icon: Icons.psychology_alt_outlined,
                                    filled: false,
                                    onTap: onAskAI),
                              ]),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A small action button on an expanded Action Item (Create task / Ask AI).
class _InsightBtn extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool filled;
  final VoidCallback onTap;
  const _InsightBtn({
    required this.label,
    required this.icon,
    required this.filled,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    final inner = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon,
            size: 14, color: filled ? Colors.white : AppColors.textPrimary),
        const SizedBox(width: 6),
        Text(label,
            style: AppText.smallStrong().copyWith(
                fontSize: 12,
                color: filled ? Colors.white : AppColors.textPrimary)),
      ]),
    );
    if (filled) {
      return Material(
        color: Colors.transparent,
        borderRadius: r,
        child: InkWell(
          onTap: onTap,
          borderRadius: r,
          child: Ink(
              decoration: BoxDecoration(gradient: AppInk.plate, borderRadius: r),
              child: inner),
        ),
      );
    }
    return Material(
      color: Colors.white.withValues(alpha: 0.85),
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: r,
            border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: inner,
        ),
      ),
    );
  }
}

class _AiAsk extends StatefulWidget {
  final String scope;
  const _AiAsk({required this.scope});
  @override
  State<_AiAsk> createState() => _AiAskState();
}

class _AiAskState extends State<_AiAsk> {
  final _c = TextEditingController();
  String? _answer;
  bool _asking = false;
  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final q = _c.text.trim();
    if (q.isEmpty || _asking) return;
    setState(() {
      _asking = true;
      _answer = null;
    });
    try {
      final a = await MoneyRepository().ask(q, scope: widget.scope);
      if (mounted) {
        setState(() =>
            _answer = a.isEmpty ? "I couldn't find an answer." : a);
      }
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.only(left: 14, right: 4),
          decoration: BoxDecoration(
            color: AppColors.surfaceMuted,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: AppColors.hairline),
          ),
          child: Row(children: [
            Expanded(
              child: TextField(
                controller: _c,
                onSubmitted: (_) => _submit(),
                style: AppText.body().copyWith(fontSize: 13),
                decoration: InputDecoration(
                  hintText: 'e.g. Which vendor did I spend most on?',
                  hintStyle: AppText.small()
                      .copyWith(fontSize: 12, color: AppColors.textTertiary),
                  border: InputBorder.none,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(AppRadius.pill),
                child: InkWell(
                  onTap: _submit,
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                  child: Ink(
                    decoration: BoxDecoration(
                        gradient: AppInk.plate,
                        borderRadius: BorderRadius.circular(AppRadius.pill)),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 8),
                      child: _asking
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                  strokeWidth: 2, color: Colors.white))
                          : Row(mainAxisSize: MainAxisSize.min, children: const [
                              Icon(Icons.send_rounded,
                                  size: 14, color: Colors.white),
                              SizedBox(width: 6),
                              Text('Ask',
                                  style: TextStyle(
                                      color: Colors.white,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600)),
                            ]),
                    ),
                  ),
                ),
              ),
            ),
          ]),
        ),
        if (_answer != null) ...[
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(AppRadius.md),
              border: Border.all(color: AppColors.hairline),
            ),
            child: Text(_answer!,
                style: AppText.body().copyWith(fontSize: 13, height: 1.5)),
          ),
        ],
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spend by category donut
// ─────────────────────────────────────────────────────────────────────────────

class _DonutSlice {
  final String label;
  final double amount;
  final Color color;
  const _DonutSlice(this.label, this.amount, this.color);
}

class _SpendDonut extends StatelessWidget {
  final List<CategorySpend> categories;
  final String periodLabel;
  const _SpendDonut(
      {required this.categories, required this.periodLabel});

  List<_DonutSlice> _slices() {
    final sorted = [...categories]..sort((a, b) => b.amount.compareTo(a.amount));
    final slices = <_DonutSlice>[];
    double other = 0;
    for (int i = 0; i < sorted.length; i++) {
      if (i < 4) {
        slices.add(_DonutSlice(sorted[i].category, sorted[i].amount,
            _catColors[i % _catColors.length]));
      } else {
        other += sorted[i].amount;
      }
    }
    if (other > 0) slices.add(_DonutSlice('Other', other, _catOther));
    return slices;
  }

  @override
  Widget build(BuildContext context) {
    final slices = _slices();
    final total = slices.fold<double>(0, (a, s) => a + s.amount);
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
                child: Text('Spend by category',
                    style: AppText.h3().copyWith(fontSize: 17))),
            Text(periodLabel,
                style: AppText.small()
                    .copyWith(fontSize: 11, color: AppColors.textSecondary)),
          ]),
          const SizedBox(height: 16),
          if (slices.isEmpty)
            _EmptyNote(
                icon: Icons.pie_chart_outline_rounded,
                text: 'No spend in this period')
          else ...[
            Center(
              child: SizedBox(
                width: 180,
                height: 180,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    CustomPaint(
                      size: const Size(180, 180),
                      painter: _DonutPainter(slices, total),
                    ),
                    Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text('Total',
                            style: AppText.small().copyWith(
                                fontSize: 11,
                                color: AppColors.textSecondary)),
                        Text(_rupeeFull(total),
                            style: AppText.h3().copyWith(fontSize: 17)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 18),
            for (final s in slices)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(children: [
                  Container(
                    width: 11,
                    height: 11,
                    decoration: BoxDecoration(
                        color: s.color,
                        borderRadius: BorderRadius.circular(3)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(s.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small().copyWith(fontSize: 13)),
                  ),
                  const SizedBox(width: 8),
                  Text(_rupeeFull(s.amount),
                      style: AppText.smallStrong().copyWith(
                          fontSize: 13,
                          fontFeatures: const [FontFeature.tabularFigures()])),
                  const SizedBox(width: 10),
                  SizedBox(
                    width: 36,
                    child: Text(
                      total <= 0
                          ? ''
                          : (s.amount / total * 100) < 1
                              ? '<1%'
                              : '${(s.amount / total * 100).round()}%',
                      textAlign: TextAlign.right,
                      style: AppText.small().copyWith(
                          fontSize: 12, color: AppColors.textSecondary),
                    ),
                  ),
                ]),
              ),
          ],
        ],
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  final List<_DonutSlice> slices;
  final double total;
  _DonutPainter(this.slices, this.total);
  @override
  void paint(Canvas canvas, Size size) {
    if (total <= 0) return;
    final center = size.center(Offset.zero);
    final outer = size.width / 2;
    final stroke = outer * 0.34; // ring thickness (inner ≈ 0.66 · outer)
    final radius = outer - stroke / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);
    const gap = 0.03; // radians of white gap between slices
    double start = -math.pi / 2;
    for (final s in slices) {
      final sweep = (s.amount / total) * 2 * math.pi;
      final paint = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..color = s.color;
      final g = slices.length > 1 ? gap : 0;
      canvas.drawArc(rect, start + g / 2, sweep - g, false, paint);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(_DonutPainter old) =>
      old.total != total || old.slices != slices;
}

// ─────────────────────────────────────────────────────────────────────────────
// Top vendors by spend
// ─────────────────────────────────────────────────────────────────────────────

class _TopVendors extends StatelessWidget {
  final List<VendorSpend> vendors;
  final String periodLabel;
  final VoidCallback onViewAll;
  const _TopVendors({
    required this.vendors,
    required this.periodLabel,
    required this.onViewAll,
  });
  @override
  Widget build(BuildContext context) {
    final max = vendors.isEmpty
        ? 1.0
        : vendors.map((v) => v.amount).fold<double>(0, math.max);
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Top vendors by spend',
                      style: AppText.h3().copyWith(fontSize: 17)),
                  Text(periodLabel,
                      style: AppText.small().copyWith(
                          fontSize: 11, color: AppColors.textSecondary)),
                ],
              ),
            ),
            _SmallPill(label: 'View all', onTap: onViewAll),
          ]),
          const SizedBox(height: 14),
          if (vendors.isEmpty)
            _EmptyNote(
                icon: Icons.storefront_outlined,
                text: 'No vendor spend in this period')
          else
            for (int i = 0; i < vendors.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(children: [
                  Container(
                    width: 24,
                    height: 24,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                        color: AppColors.textPrimary.withValues(alpha: 0.05),
                        shape: BoxShape.circle),
                    child: Text('${i + 1}',
                        style: AppText.smallStrong().copyWith(fontSize: 11)),
                  ),
                  const SizedBox(width: 10),
                  SizedBox(
                    width: 96,
                    child: Text(vendors[i].vendor,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small().copyWith(fontSize: 13)),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(999),
                      child: Container(
                        height: 8,
                        color: AppColors.textPrimary.withValues(alpha: 0.06),
                        child: FractionallySizedBox(
                          alignment: Alignment.centerLeft,
                          widthFactor:
                              math.max(0.02, vendors[i].amount / max),
                          child: Container(color: _vendorBar),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Text(_rupeeFull(vendors[i].amount),
                      style: AppText.smallStrong().copyWith(
                          fontSize: 12.5,
                          fontFeatures: const [FontFeature.tabularFigures()])),
                ]),
              ),
        ],
      ),
    );
  }
}

class _SmallPill extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _SmallPill({required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: Colors.white.withValues(alpha: 0.85),
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            borderRadius: r,
            border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: Text(label,
              style: AppText.smallStrong().copyWith(fontSize: 12)),
        ),
      ),
    );
  }
}

class _EmptyNote extends StatelessWidget {
  final IconData icon;
  final String text;
  const _EmptyNote({required this.icon, required this.text});
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(icon, size: 18, color: AppColors.textTertiary),
        const SizedBox(width: 8),
        Text(text,
            style: AppText.small()
                .copyWith(fontSize: 13, color: AppColors.textSecondary)),
      ]),
    );
  }
}

class _AutoFlowFooter extends StatelessWidget {
  const _AutoFlowFooter();
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Padding(
          padding: EdgeInsets.only(top: 1),
          child: Icon(Icons.smart_toy_outlined,
              size: 14, color: AppColors.textTertiary),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
              'Approved purchase bills & outgoing payments auto-flow into your Ledger and Company Brain.',
              style: AppText.small().copyWith(
                  fontSize: 11, color: AppColors.textSecondary, height: 1.4)),
        ),
      ]),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Records tabs — Revenue / Expenses / Assets / Inventory
// ─────────────────────────────────────────────────────────────────────────────

/// A full-width money tile (Revenue's Billed / Received / Outstanding).
class _MoneyTile extends StatelessWidget {
  final IconData icon;
  final String tone;
  final String label;
  final double amount;
  final String note;
  final bool urgent;
  const _MoneyTile({
    required this.icon,
    required this.tone,
    required this.label,
    required this.amount,
    required this.note,
    this.urgent = false,
  });
  @override
  Widget build(BuildContext context) {
    final t = _tones[tone]!;
    // Compact: icon on the left, the label/value/note stacked beside it — about
    // half the height of the old icon-on-top card.
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.md),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: t.bg, shape: BoxShape.circle),
            alignment: Alignment.center,
            child: Icon(icon, size: 18, color: t.fg),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label,
                    style: AppText.small().copyWith(
                        fontSize: 12, color: AppColors.textSecondary)),
                const SizedBox(height: 1),
                Text(_rupeeFull(amount),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.h3().copyWith(
                      fontSize: 19,
                      height: 1.15,
                      fontWeight: FontWeight.w700,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    )),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(note,
              style: AppText.small().copyWith(
                  fontSize: 11.5,
                  color: urgent ? AppColors.accent : AppColors.textTertiary)),
        ],
      ),
    );
  }
}

/// The three Revenue tiles, derived from the invoice list (billed / received
/// as paid-invoice sum / outstanding).
class _RevenueTiles extends StatelessWidget {
  final List<Revenue> invoices;
  const _RevenueTiles({required this.invoices});
  @override
  Widget build(BuildContext context) {
    double billed = 0, received = 0;
    int overdue = 0, paid = 0;
    for (final i in invoices) {
      billed += i.amount;
      final st = i.status.toLowerCase();
      if (st == 'paid') {
        received += i.amount;
        paid++;
      }
      if (st == 'overdue') overdue++;
    }
    final outstanding = billed - received;
    return Column(children: [
      _MoneyTile(
          icon: Icons.currency_rupee_rounded,
          tone: 'emerald',
          label: 'Billed',
          amount: billed,
          note: '${invoices.length} ${invoices.length == 1 ? 'invoice' : 'invoices'}'),
      const SizedBox(height: 10),
      _MoneyTile(
          icon: Icons.download_rounded,
          tone: 'sky',
          label: 'Received',
          amount: received,
          note: '$paid received'),
      const SizedBox(height: 10),
      _MoneyTile(
          icon: Icons.error_outline_rounded,
          tone: outstanding > 0 ? 'rose' : 'slate',
          label: 'Outstanding',
          amount: outstanding,
          note: overdue > 0
              ? '$overdue overdue'
              : 'Nothing overdue',
          urgent: overdue > 0),
    ]);
  }
}

/// A small pill on a record card (status / category / attachment).
class _CardChip {
  final String text;
  final Color bg;
  final Color fg;
  final IconData? icon;
  const _CardChip(this.text, this.bg, this.fg, {this.icon});
}

// Status → coloured chip (Received green, Unpaid amber, Overdue rose, …).
_CardChip? _statusChip(String? status) {
  final s = (status ?? '').toLowerCase();
  const green = Color(0xFF047857), greenBg = Color(0xFFE7F7EE);
  const amber = Color(0xFFB45309), amberBg = Color(0xFFFDF3E2);
  const rose = Color(0xFFBE123C), roseBg = Color(0xFFFDECEE);
  const slate = Color(0xFF64748B), slateBg = Color(0xFFEEF1F5);
  switch (s) {
    case 'paid':
      return const _CardChip('Paid', greenBg, green);
    case 'received':
      return const _CardChip('Received', greenBg, green);
    case 'unpaid':
      return const _CardChip('Unpaid', amberBg, amber);
    case 'awaiting':
    case 'awaiting_bill':
      return const _CardChip('Awaiting', slateBg, slate);
    case 'partial':
      return const _CardChip('Partial', amberBg, amber);
    case 'overdue':
      return const _CardChip('Overdue', roseBg, rose);
    case 'active':
      return const _CardChip('Active', greenBg, green);
    case 'maintenance':
      return const _CardChip('Maintenance', amberBg, amber);
    case 'disposed':
      return const _CardChip('Disposed', slateBg, slate);
    default:
      return null;
  }
}

Widget _chipWidget(_CardChip c) => Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration:
          BoxDecoration(color: c.bg, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        if (c.icon != null) ...[
          Icon(c.icon, size: 11, color: c.fg),
          const SizedBox(width: 4),
        ],
        Text(c.text,
            style: TextStyle(
                fontSize: 11, fontWeight: FontWeight.w600, color: c.fg)),
      ]),
    );

String _shortDate(DateTime? d) {
  if (d == null) return '';
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// The detailed record card shared by every records tab (invoice / expense /
/// asset / inventory), matching the PWA: an optional grey prefix + bold title
/// (+ an inline tag chip) and the amount on the first row; status / category
/// chips + an optional overdue badge on the second; a grey subtitle + a trash
/// button on the third.
class _RecordCard extends StatelessWidget {
  final String? prefix; // e.g. "#SBT/25-26/0455"
  final String title;
  final _CardChip? tag; // inline chip beside the title (attachment)
  final double amount;
  final List<_CardChip> chips; // status / category
  final String? overdue; // "42d overdue"
  final String? subtitle; // "Threads Boutique · 2026-08-12"
  final VoidCallback? onDelete;
  const _RecordCard({
    required this.title,
    required this.amount,
    this.prefix,
    this.tag,
    this.chips = const [],
    this.overdue,
    this.subtitle,
    this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final hasChips = chips.isNotEmpty || overdue != null;
    // A soft-UI raised card nested inside the _ListCard's recessed tray.
    return NeuRaised(
      palette: NeuPalette.from(AppColors.surfaceMuted),
      color: AppColors.surface,
      borderRadius: BorderRadius.circular(AppRadius.md),
      distance: 3,
      blur: 8,
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Row(children: [
                Flexible(
                  child: RichText(
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    text: TextSpan(children: [
                      if (prefix != null && prefix!.isNotEmpty)
                        TextSpan(
                            text: '$prefix ',
                            style: AppText.small().copyWith(
                                fontSize: 13,
                                color: AppColors.textTertiary)),
                      TextSpan(
                          text: title,
                          style: AppText.bodyStrong().copyWith(
                              fontSize: 15,
                              color: AppColors.textPrimary,
                              height: 1.3)),
                    ]),
                  ),
                ),
                if (tag != null) ...[
                  const SizedBox(width: 8),
                  _chipWidget(tag!),
                ],
              ]),
            ),
            const SizedBox(width: 10),
            Text(_rupeeFull(amount),
                style: AppText.bodyStrong().copyWith(
                  fontSize: 15,
                  fontFeatures: const [FontFeature.tabularFigures()],
                )),
          ]),
          if (hasChips) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final c in chips) _chipWidget(c),
              if (overdue != null)
                _chipWidget(_CardChip(overdue!, const Color(0xFFFDECEE),
                    const Color(0xFFBE123C),
                    icon: Icons.schedule_rounded)),
            ]),
          ],
          if (subtitle != null || onDelete != null) ...[
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: Text(subtitle ?? '',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.small().copyWith(
                        fontSize: 12, color: AppColors.textTertiary)),
              ),
              if (onDelete != null)
                GestureDetector(
                  onTap: onDelete,
                  behavior: HitTestBehavior.opaque,
                  child: const Padding(
                    padding: EdgeInsets.only(left: 8, top: 2, bottom: 2),
                    child: Icon(Icons.delete_outline_rounded,
                        size: 17, color: AppColors.textTertiary),
                  ),
                ),
            ]),
          ],
        ],
      ),
    );
  }
}

/// One white card that holds a whole list: a "Title (N)" header, optional
/// controls (the Revenue sort + filter), then the flat record rows separated by
/// hairlines — so the list reads as a single card, not a stack of floating
/// cards.
class _ListCard extends StatelessWidget {
  final String title;
  final int count;
  final Widget? controls;
  final List<Widget> rows;
  final Widget? empty;
  const _ListCard({
    required this.title,
    required this.count,
    this.controls,
    this.rows = const [],
    this.empty,
  });
  @override
  Widget build(BuildContext context) {
    // A muted "tray" card — its soft-grey ground is what lets the white
    // NeuRaised record cards inside read as raised (cards inside a card).
    return Container(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.lg, AppSpacing.lg, AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surfaceMuted,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(children: [
            Text(title, style: AppText.h3().copyWith(fontSize: 16)),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.textPrimary.withValues(alpha: 0.05),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text('$count',
                  style: AppText.smallStrong()
                      .copyWith(fontSize: 12, color: AppColors.textSecondary)),
            ),
          ]),
          if (controls != null) ...[
            const SizedBox(height: 14),
            controls!,
          ],
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 20),
              child: Center(
                child: empty ??
                    Text('Nothing here yet',
                        style: AppText.small()
                            .copyWith(color: AppColors.textSecondary)),
              ),
            )
          else
            for (int i = 0; i < rows.length; i++) ...[
              SizedBox(height: i == 0 ? 12 : 10),
              rows[i],
            ],
        ],
      ),
    );
  }
}

class _RevenueBody extends StatefulWidget {
  final Future<List<Revenue>> future;
  final Future<FinanceBrief> Function(String) brief;
  final VoidCallback onRefresh;
  const _RevenueBody(
      {required this.future, required this.brief, required this.onRefresh});
  @override
  State<_RevenueBody> createState() => _RevenueBodyState();
}

class _RevenueBodyState extends State<_RevenueBody> {
  String _sort = 'newest'; // newest | oldest | amount
  String _filter = 'all'; // all | awaiting | partial | received | overdue

  static const _sorts = <(String, String)>[
    ('newest', 'Newest first'),
    ('oldest', 'Oldest first'),
    ('amount', 'Amount (highest)'),
  ];

  bool _matches(Revenue r, String f) {
    final s = r.status.toLowerCase();
    switch (f) {
      case 'awaiting':
        return s == 'awaiting' || s == 'unpaid';
      case 'partial':
        return s == 'partial';
      case 'received':
        return s == 'paid' || s == 'received';
      case 'overdue':
        return s == 'overdue';
      default:
        return true;
    }
  }

  int _overdueDays(Revenue r) {
    if (r.date == null) return 0;
    final s = r.status.toLowerCase();
    if (s == 'paid' || s == 'received') return 0;
    final d = DateTime.now().difference(r.date!).inDays;
    return d > 0 ? d : 0;
  }

  Future<void> _pickSort() async {
    final picked = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        top: false,
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const SizedBox(height: 8),
          for (final s in _sorts)
            ListTile(
              title: Text(s.$2),
              trailing: s.$1 == _sort
                  ? const Icon(Icons.check_rounded, color: AppColors.brand)
                  : null,
              onTap: () => Navigator.pop(ctx, s.$1),
            ),
        ]),
      ),
    );
    if (picked != null) setState(() => _sort = picked);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Revenue>>(
      future: widget.future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 160);
        }
        if (snap.hasError) {
          return const ErrorState(message: 'Could not load revenue.');
        }
        final all = snap.data ?? const <Revenue>[];
        // Facet counts for the filter chips.
        int count(String f) => all.where((r) => _matches(r, f)).length;
        final facets = <(String, String)>[
          ('all', 'All'),
          ('awaiting', 'Awaiting'),
          ('partial', 'Partial'),
          ('received', 'Received'),
          ('overdue', 'Overdue'),
        ];
        final list = all.where((r) => _matches(r, _filter)).toList();
        list.sort((a, b) {
          switch (_sort) {
            case 'oldest':
              return (a.date ?? DateTime(2100))
                  .compareTo(b.date ?? DateTime(2100));
            case 'amount':
              return b.amount.compareTo(a.amount);
            default: // newest
              return (b.date ?? DateTime(0)).compareTo(a.date ?? DateTime(0));
          }
        });
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _RevenueTiles(invoices: all),
            const SizedBox(height: AppSpacing.md),
            _AiPanel(
                scope: 'revenue',
                variant: _AiVariant.inline,
                future: widget.brief('revenue')),
            const SizedBox(height: AppSpacing.md),
            _ListCard(
              title: 'Sales & service invoices',
              count: all.length,
              controls: all.isEmpty
                  ? null
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _SortButton(
                            label: _sorts.firstWhere((s) => s.$1 == _sort).$2,
                            onTap: _pickSort),
                        const SizedBox(height: 10),
                        _FilterChips(
                          facets: [
                            for (final f in facets) (f.$1, f.$2, count(f.$1))
                          ],
                          active: _filter,
                          onSelect: (f) => setState(() => _filter = f),
                        ),
                      ],
                    ),
              empty: Text(
                  all.isEmpty
                      ? 'No invoices yet — invoices you send show up here.'
                      : 'No invoices match this filter.',
                  textAlign: TextAlign.center,
                  style: AppText.small().copyWith(color: AppColors.textSecondary)),
              rows: [
                for (final r in list)
                  _RecordCard(
                    prefix: r.number.isEmpty ? null : '#${r.number}',
                    title: r.product,
                    tag: r.hasAttachment
                        ? const _CardChip('Bill', Color(0xFFEEF1F5),
                            Color(0xFF64748B),
                            icon: Icons.attach_file_rounded)
                        : null,
                    amount: r.amount,
                    chips: [
                      if (_statusChip(r.status) != null) _statusChip(r.status)!,
                    ],
                    overdue: _overdueDays(r) > 0
                        ? '${_overdueDays(r)}d overdue'
                        : null,
                    subtitle: [
                      if (r.contactName.isNotEmpty) r.contactName,
                      if (r.date != null) _shortDate(r.date),
                    ].join(' · '),
                    onDelete: () => _confirmDelete(context,
                        title: r.product,
                        run: () => MoneyRepository().deleteInvoice(r.id),
                        onDone: widget.onRefresh),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

/// The "Newest first ▾" sort control on the Revenue list.
class _SortButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _SortButton({required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.md);
    return Material(
      color: Colors.white.withValues(alpha: 0.85),
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            borderRadius: r,
            border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: Row(children: [
            Text(label, style: AppText.smallStrong().copyWith(fontSize: 13)),
            const Spacer(),
            const Icon(Icons.keyboard_arrow_down_rounded,
                size: 20, color: AppColors.textSecondary),
          ]),
        ),
      ),
    );
  }
}

/// The status filter track (All / Awaiting / Partial / Received / Overdue) with
/// live counts — a recessed track holding the chips, active = dark ink pill.
class _FilterChips extends StatelessWidget {
  final List<(String, String, int)> facets; // key, label, count
  final String active;
  final ValueChanged<String> onSelect;
  const _FilterChips(
      {required this.facets, required this.active, required this.onSelect});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(6),
      decoration: BoxDecoration(
        color: AppColors.textPrimary.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final f in facets)
            _FilterChip(
              label: f.$2,
              count: f.$3,
              active: active == f.$1,
              danger: f.$1 == 'overdue',
              onTap: () => onSelect(f.$1),
            ),
        ],
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  final String label;
  final int count;
  final bool active;
  final bool danger;
  final VoidCallback onTap;
  const _FilterChip({
    required this.label,
    required this.count,
    required this.active,
    required this.danger,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    final fg = active
        ? Colors.white
        : (danger ? const Color(0xFFBE123C) : AppColors.textSecondary);
    return Material(
      color: Colors.transparent,
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Ink(
          decoration: BoxDecoration(
            gradient: active && !danger ? AppInk.plate : null,
            color: active && danger ? const Color(0xFFE11D48) : null,
            borderRadius: r,
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Text(label,
                  style: AppText.smallStrong().copyWith(fontSize: 13, color: fg)),
              const SizedBox(width: 6),
              Text('$count',
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: active ? Colors.white : AppColors.textTertiary)),
            ]),
          ),
        ),
      ),
    );
  }
}

class _ExpensesBody extends StatelessWidget {
  final Future<List<Expense>> future;
  final Future<FinanceBrief> Function(String) brief;
  final VoidCallback onRefresh;
  const _ExpensesBody(
      {required this.future, required this.brief, required this.onRefresh});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Expense>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 160);
        }
        if (snap.hasError) {
          return const ErrorState(message: 'Could not load expenses.');
        }
        final items = snap.data ?? const <Expense>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _AiPanel(
                scope: 'expenses',
                variant: _AiVariant.inline,
                future: brief('expenses')),
            const SizedBox(height: AppSpacing.md),
            _ListCard(
              title: 'Expenses',
              count: items.length,
              empty: Text('Captured bills and expenses will appear here.',
                  textAlign: TextAlign.center,
                  style:
                      AppText.small().copyWith(color: AppColors.textSecondary)),
              rows: [
                for (final e in items)
                  _RecordCard(
                    title: e.title,
                    tag: e.hasAttachment
                        ? const _CardChip('Bill', Color(0xFFEEF1F5),
                            Color(0xFF64748B),
                            icon: Icons.attach_file_rounded)
                        : null,
                    amount: e.amount,
                    chips: [
                      if ((e.category ?? '').isNotEmpty)
                        _CardChip(e.category!, const Color(0xFFEEF1F5),
                            const Color(0xFF64748B)),
                      if (_statusChip(e.status) != null) _statusChip(e.status)!,
                    ],
                    subtitle: [
                      if ((e.vendor ?? '').isNotEmpty) e.vendor!,
                      if (e.date != null) _shortDate(e.date),
                    ].join(' · '),
                    onDelete: () => _confirmDelete(context,
                        title: e.title,
                        run: () => MoneyRepository().deleteExpense(e.id),
                        onDone: onRefresh),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _AssetsBody extends StatelessWidget {
  final Future<List<Asset>> future;
  final Future<FinanceBrief> Function(String) brief;
  final VoidCallback onRefresh;
  const _AssetsBody(
      {required this.future, required this.brief, required this.onRefresh});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<Asset>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 160);
        }
        if (snap.hasError) {
          return const ErrorState(message: 'Could not load assets.');
        }
        final items = snap.data ?? const <Asset>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _AiPanel(
                scope: 'assets',
                variant: _AiVariant.inline,
                future: brief('assets')),
            const SizedBox(height: AppSpacing.md),
            _ListCard(
              title: 'Assets',
              count: items.length,
              empty: Text('Long-term purchases will appear here.',
                  textAlign: TextAlign.center,
                  style:
                      AppText.small().copyWith(color: AppColors.textSecondary)),
              rows: [
                for (final a in items)
                  _RecordCard(
                    title: a.title,
                    tag: a.hasAttachment
                        ? const _CardChip('Bill', Color(0xFFEEF1F5),
                            Color(0xFF64748B),
                            icon: Icons.attach_file_rounded)
                        : null,
                    amount: a.amount,
                    chips: [
                      if ((a.category ?? '').isNotEmpty)
                        _CardChip(a.category!, const Color(0xFFEEF1F5),
                            const Color(0xFF64748B)),
                      if (_statusChip(a.status) != null) _statusChip(a.status)!,
                    ],
                    subtitle: [
                      if ((a.vendor ?? '').isNotEmpty) a.vendor!,
                      if (a.boughtDate != null)
                        'Bought ${_shortDate(a.boughtDate)}',
                    ].join(' · '),
                    onDelete: () => _confirmDelete(context,
                        title: a.title,
                        run: () => MoneyRepository().deleteAsset(a.id),
                        onDone: onRefresh),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _InventoryBody extends StatelessWidget {
  final Future<List<InventoryItem>> future;
  final Future<FinanceBrief> Function(String) brief;
  final VoidCallback onRefresh;
  const _InventoryBody(
      {required this.future, required this.brief, required this.onRefresh});
  @override
  Widget build(BuildContext context) {
    return FutureBuilder<List<InventoryItem>>(
      future: future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return const LoadingCard(height: 160);
        }
        if (snap.hasError) {
          return const ErrorState(message: 'Could not load inventory.');
        }
        final items = snap.data ?? const <InventoryItem>[];
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _AiPanel(
                scope: 'inventory',
                variant: _AiVariant.inline,
                future: brief('inventory')),
            const SizedBox(height: AppSpacing.md),
            _ListCard(
              title: 'Inventory',
              count: items.length,
              empty: Text('Stock items will appear here.',
                  textAlign: TextAlign.center,
                  style:
                      AppText.small().copyWith(color: AppColors.textSecondary)),
              rows: [
                for (final it in items)
                  _RecordCard(
                    title: it.title,
                    amount: it.lineValue,
                    chips: [
                      if ((it.sku ?? '').isNotEmpty)
                        _CardChip('SKU ${it.sku}', const Color(0xFFEEF1F5),
                            const Color(0xFF64748B)),
                    ],
                    subtitle: [
                      'Qty ${it.quantity.toStringAsFixed(0)}${(it.unit ?? '').isNotEmpty ? ' ${it.unit}' : ''}',
                      if (it.unitCost != null)
                        '₹${it.unitCost!.toStringAsFixed(0)}/unit',
                      if ((it.vendor ?? '').isNotEmpty) it.vendor!,
                    ].join(' · '),
                    onDelete: () => _confirmDelete(context,
                        title: it.title,
                        run: () => MoneyRepository().deleteInventory(it.id),
                        onDone: onRefresh),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// INBOX — capture review queue
// ─────────────────────────────────────────────────────────────────────────────

class _InboxBody extends StatefulWidget {
  final VoidCallback onRefresh;
  const _InboxBody({required this.onRefresh});
  @override
  State<_InboxBody> createState() => _InboxBodyState();
}

class _InboxBodyState extends State<_InboxBody> {
  static const _statuses = <(String, String)>[
    ('pending_review', 'Pending'),
    ('needs_attention', 'Needs attention'),
    ('clarification_requested', 'Clarification'),
    ('executed', 'Filed'),
    ('rejected', 'Rejected'),
  ];

  String _status = 'pending_review';
  final Map<String, Future<List<Capture>>> _futures = {};

  Future<List<Capture>> _future(String s) =>
      _futures[s] ??= MoneyRepository().captures(s);

  void _reload() {
    setState(() => _futures.remove(_status));
    widget.onRefresh();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        // Status sub-tab track (horizontally scrollable pill row).
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(children: [
            for (final s in _statuses)
              Padding(
                padding: const EdgeInsets.only(right: 8),
                child: _StatusChip(
                  label: s.$2,
                  active: _status == s.$1,
                  onTap: () => setState(() => _status = s.$1),
                ),
              ),
          ]),
        ),
        const SizedBox(height: AppSpacing.md),
        FutureBuilder<List<Capture>>(
          future: _future(_status),
          builder: (context, snap) {
            if (snap.connectionState != ConnectionState.done) {
              return const LoadingCard(height: 140);
            }
            if (snap.hasError) {
              return const ErrorState(message: 'Could not load your inbox.');
            }
            final items = snap.data ?? const <Capture>[];
            if (items.isEmpty) {
              return const EmptyState(
                icon: Icons.inbox_outlined,
                title: 'Nothing here',
                subtitle:
                    'Uploaded receipts land here for review before anything is created.',
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final c in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.md),
                    child: _CaptureCard(capture: c, onChanged: _reload),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _StatusChip(
      {required this.label, required this.active, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    return Material(
      color: active ? Colors.transparent : Colors.white.withValues(alpha: 0.7),
      borderRadius: r,
      child: InkWell(
        onTap: onTap,
        borderRadius: r,
        child: Ink(
          decoration: BoxDecoration(
            gradient: active ? AppInk.plate : null,
            borderRadius: r,
            border: active
                ? null
                : Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            child: Text(label,
                style: AppText.smallStrong().copyWith(
                    fontSize: 13,
                    color: active ? Colors.white : AppColors.textSecondary)),
          ),
        ),
      ),
    );
  }
}

class _CaptureCard extends StatefulWidget {
  final Capture capture;
  final VoidCallback onChanged;
  const _CaptureCard({required this.capture, required this.onChanged});
  @override
  State<_CaptureCard> createState() => _CaptureCardState();
}

class _CaptureCardState extends State<_CaptureCard> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      widget.onChanged();
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(done)));
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text("Couldn't update.")));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clarify() async {
    final controller = TextEditingController();
    final q = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Ask for clarification'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
              hintText: 'What do you need clarified?'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(ctx, controller.text),
              child: const Text('Send')),
        ],
      ),
    );
    if (q != null && q.trim().isNotEmpty) {
      await _run(
          () => MoneyRepository().clarifyCapture(widget.capture.id,
              question: q.trim()),
          'Clarification requested');
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.capture;
    final isImage = (c.docType ?? '').contains('image') ||
        (c.filename ?? '').toLowerCase().endsWith('.jpg') ||
        (c.filename ?? '').toLowerCase().endsWith('.png');
    final pending = c.status == 'pending_review' ||
        c.status == 'needs_attention' ||
        c.status == 'clarification_requested';
    return KrPop(
      borderRadius: BorderRadius.circular(AppRadius.lg),
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                  color: const Color(0xFFE7F7EE),
                  borderRadius: BorderRadius.circular(12)),
              alignment: Alignment.center,
              child: Icon(
                  isImage
                      ? Icons.image_outlined
                      : Icons.description_outlined,
                  size: 18,
                  color: const Color(0xFF047857)),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Wrap(spacing: 6, runSpacing: 6, children: [
                    if (c.classification.isNotEmpty)
                      _tag(c.classification, AppColors.surfaceMuted,
                          AppColors.textSecondary),
                    if (c.needsOwner)
                      _tag('Owner approval', const Color(0xFFFFF1F2),
                          const Color(0xFFBE123C)),
                    if (c.confidence != null)
                      _tag('AI ${c.confidence}%', const Color(0xFFE6F2FB),
                          const Color(0xFF0369A1)),
                  ]),
                  if (c.summary.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(c.summary,
                        style:
                            AppText.bodyStrong().copyWith(fontSize: 14)),
                  ],
                ],
              ),
            ),
          ]),
          if (c.explainer != null && c.explainer!.isNotEmpty) ...[
            const SizedBox(height: 10),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: AppColors.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadius.sm),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Why AI routed this:',
                      style: AppText.smallStrong().copyWith(
                          fontSize: 11, color: AppColors.textSecondary)),
                  const SizedBox(height: 2),
                  Text(c.explainer!,
                      style: AppText.small().copyWith(fontSize: 12.5, height: 1.4)),
                ],
              ),
            ),
          ],
          if (c.text != null && c.text!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text('“${c.text!}”',
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: AppText.small().copyWith(
                    fontSize: 12.5,
                    height: 1.4,
                    fontStyle: FontStyle.italic,
                    color: AppColors.textSecondary)),
          ],
          if (c.amount != null) ...[
            const SizedBox(height: 10),
            Text(_rupeeFull(c.amount!),
                style: AppText.h3().copyWith(fontSize: 18)),
          ],
          if (pending) ...[
            const SizedBox(height: 14),
            Row(children: [
              _CaptureAction(
                label: 'Approve',
                filled: true,
                busy: _busy,
                onTap: () => _run(
                    () => MoneyRepository().approveCapture(c.id), 'Approved'),
              ),
              const SizedBox(width: 8),
              _CaptureAction(
                label: 'Clarify',
                filled: false,
                busy: _busy,
                onTap: _clarify,
              ),
              const Spacer(),
              TextButton(
                onPressed: _busy
                    ? null
                    : () => _run(
                        () => MoneyRepository().rejectCapture(c.id), 'Rejected'),
                child: Text('Reject',
                    style: TextStyle(color: AppColors.danger)),
              ),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _tag(String text, Color bg, Color fg) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration:
            BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
        child: Text(text,
            style: TextStyle(
                fontSize: 11, fontWeight: FontWeight.w600, color: fg)),
      );
}

class _CaptureAction extends StatelessWidget {
  final String label;
  final bool filled;
  final bool busy;
  final VoidCallback onTap;
  const _CaptureAction({
    required this.label,
    required this.filled,
    required this.busy,
    required this.onTap,
  });
  @override
  Widget build(BuildContext context) {
    final r = BorderRadius.circular(AppRadius.pill);
    final child = Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(filled ? Icons.check_circle_outline_rounded : Icons.help_outline_rounded,
            size: 15, color: filled ? Colors.white : AppColors.textPrimary),
        const SizedBox(width: 6),
        Text(label,
            style: AppText.smallStrong().copyWith(
                fontSize: 13,
                color: filled ? Colors.white : AppColors.textPrimary)),
      ]),
    );
    if (filled) {
      return Material(
        color: Colors.transparent,
        borderRadius: r,
        child: InkWell(
          onTap: busy ? null : onTap,
          borderRadius: r,
          child: Ink(
              decoration: BoxDecoration(gradient: AppInk.plate, borderRadius: r),
              child: child),
        ),
      );
    }
    return Material(
      color: Colors.white.withValues(alpha: 0.85),
      borderRadius: r,
      child: InkWell(
        onTap: busy ? null : onTap,
        borderRadius: r,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: r,
            border: Border.all(color: AppColors.nmEdge.withValues(alpha: 0.5)),
          ),
          child: child,
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete confirm + Add sheets (reused)
// ─────────────────────────────────────────────────────────────────────────────

Future<void> _confirmDelete(
  BuildContext context, {
  required String title,
  required Future<void> Function() run,
  VoidCallback? onDone,
}) async {
  final go = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Delete?'),
      content: Text('"$title" will be permanently removed.'),
      actions: [
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel')),
        TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Delete')),
      ],
    ),
  );
  if (go != true) return;
  try {
    await run();
    onDone?.call();
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Deleted')));
    }
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Could not delete.')));
    }
  }
}

/// One sheet for Add Income / Asset / Inventory.
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
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Title is required.')));
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
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Could not save.')));
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
          padding: const EdgeInsets.only(bottom: 6, top: 4),
          child: Text(label,
              style: AppText.small()
                  .copyWith(fontWeight: FontWeight.w600, fontSize: 12)),
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
      padding: EdgeInsets.fromLTRB(AppSpacing.lg, AppSpacing.xxl, AppSpacing.lg,
          AppSpacing.lg + mq.viewInsets.bottom),
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
                Row(children: [
                  Text(_heading, style: AppText.h3()),
                  const Spacer(),
                  InkWell(
                    onTap: () => Navigator.of(context).pop(),
                    borderRadius: BorderRadius.circular(999),
                    child: const Padding(
                        padding: EdgeInsets.all(4),
                        child: Icon(Icons.close_rounded, size: 20)),
                  ),
                ]),
                const SizedBox(height: AppSpacing.md),
                _field('Title', _title, hint: 'What is this?'),
                _field(widget.kind == 'income' ? 'Customer' : 'Vendor', _party,
                    hint: widget.kind == 'income'
                        ? 'Customer name'
                        : 'Vendor name'),
                if (widget.kind == 'inventory')
                  _field('Quantity', _qty,
                      hint: '0',
                      keyboard: const TextInputType.numberWithOptions()),
                _field(widget.kind == 'inventory' ? 'Unit cost' : 'Amount',
                    _amount,
                    hint: '0',
                    keyboard:
                        const TextInputType.numberWithOptions(decimal: true)),
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
                      child: Text(_saving ? 'Saving…' : 'Save',
                          style: AppText.bodyStrong()
                              .copyWith(color: Colors.white)),
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

/// Add Expense bottom sheet.
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
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Title is required.')));
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
      if (mounted) Navigator.of(context).pop(true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not add expense.')));
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
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
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
                        style:
                            AppText.bodyStrong().copyWith(color: Colors.white)),
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
