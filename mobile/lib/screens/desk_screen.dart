import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../app_shell.dart';
import '../data/repositories.dart';
import '../models/models.dart';
import '../theme/app_theme.dart';
import '../widgets/app_header.dart';
import '../widgets/score_gauge.dart';
import '../widgets/states.dart';

/// The Desk (/inbox) screen — ported from frontend/src/pages/Desk.js.
///
/// Data comes live from the backend (parallel fetches):
///   GET /api/desk?chip={key}       — one per section, 4 in flight
///   GET /api/desk/summary          — greeting, delayed, complaints, cash
///   GET /api/operating-score       — the score numeral + gauge
///   GET /api/ledger/summary        — net profit for the KPI grid
///
/// Layout mirrors the frontend mobile composition:
///   1) Minimal header  — wordmark left, bell chip right
///   2) Warm orange bloom sky
///   3) Greeting row + compact score + arc gauge
///   4) 2×2 KPI grid (Delayed / Complaints / Overdue / Net profit)
///   5) Insight well — Dex today's read
///   6) Dark band with a horizontal snap PageView of four sections. Each
///      section shows up to THREE stacked cards (minimized). Tapping the
///      "+N more" pill opens a modal bottom sheet with the section's full
///      list laid out as a 2-column grid.
class DeskScreen extends StatefulWidget {
  const DeskScreen({super.key});
  @override
  State<DeskScreen> createState() => _DeskScreenState();
}

class _DeskScreenState extends State<DeskScreen> {
  late Future<_DeskData> _future;

  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<_DeskData> _load() async {
    final desk = DeskRepository();
    // Parallel fetch — 6 requests, then compose. Any single failure falls back
    // to a friendly default in that one field.
    final futures = await Future.wait<Object?>([
      desk.chip('needs_decision').then<Object?>((v) => v).catchError((_) => null),
      desk.chip('on_fire').then<Object?>((v) => v).catchError((_) => null),
      desk.chip('due_today').then<Object?>((v) => v).catchError((_) => null),
      desk.chip('important').then<Object?>((v) => v).catchError((_) => null),
      desk.summary().then<Object?>((v) => v).catchError((_) => null),
      OpsRepository().score().then<Object?>((v) => v).catchError((_) => null),
      LedgerRepository().summary().then<Object?>((v) => v).catchError((_) => null),
    ]);
    return _DeskData(
      chips: {
        'needs_decision': futures[0] as DeskChipData?,
        'on_fire': futures[1] as DeskChipData?,
        'due_today': futures[2] as DeskChipData?,
        'important': futures[3] as DeskChipData?,
      },
      summary: futures[4] as DeskSummary?,
      ops: futures[5] as OperatingScore?,
      ledger: futures[6] as LedgerSummary?,
    );
  }

  Future<void> _reload() async {
    setState(() { _future = _load(); });
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<_DeskData>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState != ConnectionState.done) {
          return Stack(children: const [
            Positioned.fill(child: _BloomBackground()),
            Column(children: [AppHeader.minimal(), Expanded(child: _DeskSkeleton())]),
          ]);
        }
        final data = snap.data ?? _DeskData.empty();
        return _DeskLayout(data: data, onRefresh: _reload);
      },
    );
  }
}

/// The composed screen — static top layer, blur overlay driven by the sheet's
/// position, then the draggable bottom sheet on top. Owns the sheet
/// controller itself so its lifetime is tied to this layout's mount.
class _DeskLayout extends StatefulWidget {
  final _DeskData data;
  final Future<void> Function() onRefresh;
  const _DeskLayout({required this.data, required this.onRefresh});

  @override
  State<_DeskLayout> createState() => _DeskLayoutState();
}

class _DeskLayoutState extends State<_DeskLayout> {
  // Three snap points, chosen so each shows a specific number of cards:
  //   min  — notch + section header + 1 headline card
  //   mid  — notch + section header + 3 stacked cards
  //   max  — full-viewport; +N pill jumps here; content scrolls if needed
  // Sheet sits higher on rest so the first "Needs your decision" card
  // clears its own action pill before you drag — old 0.34 left the card's
  // Review chip cropped off the bottom.
  static const double _sheetMin = 0.44;
  static const double _sheetMid = 0.72;
  static const double _sheetMax = 1.0;
  final DraggableScrollableController _sheetCtrl = DraggableScrollableController();
  double _sheetPos = _sheetMin;

  @override
  void initState() {
    super.initState();
    _sheetCtrl.addListener(_onSheetMove);
  }

  @override
  void dispose() {
    _sheetCtrl.removeListener(_onSheetMove);
    _sheetCtrl.dispose();
    super.dispose();
  }

  void _onSheetMove() {
    if (!_sheetCtrl.isAttached) return;
    setState(() => _sheetPos = _sheetCtrl.size);
  }

  @override
  Widget build(BuildContext context) {
    // Blur intensity ramps 0 → 12 sigma as the sheet expands from min to max.
    final t = ((_sheetPos - _sheetMin) / (_sheetMax - _sheetMin)).clamp(0.0, 1.0);
    return Stack(
      children: [
        // Layer 1 — bloom sky, always painted.
        const Positioned.fill(child: _BloomBackground()),
        // Layer 2 — static top content (header + greeting + KPI + insight).
        // Doesn't scroll; the bottom sheet slides over it instead.
        Positioned(
          left: 0, right: 0, top: 0, bottom: 0,
          child: SafeArea(
            bottom: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const AppHeader.minimal(),
                _LightZone(data: widget.data),
              ],
            ),
          ),
        ),
        // Layer 3 — blur + dim overlay that fades in as the sheet rises.
        // ALWAYS in the tree (even at t=0 where the blur is invisible) so
        // Layer 4's Stack index never shifts — otherwise the sheet gets
        // re-mounted and tries to _attach twice on the same controller.
        Positioned.fill(
          child: IgnorePointer(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 12 * t, sigmaY: 12 * t),
              child: Container(color: Colors.black.withValues(alpha: 0.20 * t)),
            ),
          ),
        ),
        // Layer 4 — draggable dark band. Positioned.fill + a stable key so
        // the sheet Element is preserved across every rebuild.
        Positioned.fill(
          child: DraggableScrollableSheet(
            key: const ValueKey('desk-sheet'),
            controller: _sheetCtrl,
            initialChildSize: _sheetMin,
            minChildSize: _sheetMin,
            maxChildSize: _sheetMax,
            expand: true,
            snap: true,
            snapSizes: const [_sheetMin, _sheetMid, _sheetMax],
            builder: (context, scrollCtrl) {
              return _DarkBand(
                data: widget.data,
                scrollController: scrollCtrl,
                sheetController: _sheetCtrl,
                sheetMax: _sheetMax,
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Bundle passed down to every section of the desk. Any field can be null if
/// the backend request failed — screens read defensively.
class _DeskData {
  final Map<String, DeskChipData?> chips;
  final DeskSummary? summary;
  final OperatingScore? ops;
  final LedgerSummary? ledger;

  _DeskData({required this.chips, this.summary, this.ops, this.ledger});
  factory _DeskData.empty() => _DeskData(chips: const {});
  List<Decision> cards(String key) => chips[key]?.cards ?? const [];
  int count(String key) =>
      chips[key]?.counters[key] ?? chips.values.firstWhere(
        (c) => c != null && c.counters.containsKey(key),
        orElse: () => null,
      )?.counters[key] ?? 0;
}

/// Skeleton while the parallel fetches are in flight.
class _DeskSkeleton extends StatelessWidget {
  const _DeskSkeleton();
  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.all(AppSpacing.lg),
      child: Column(
        children: [
          LoadingCard(height: 60),
          SizedBox(height: AppSpacing.md),
          LoadingCard(height: 90),
          SizedBox(height: AppSpacing.md),
          LoadingCard(height: 172),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Background bloom
// ─────────────────────────────────────────────────────────────────────────────

class _BloomBackground extends StatelessWidget {
  const _BloomBackground();
  @override
  Widget build(BuildContext context) {
    // Warm cream paper first, then the orange radial bloom on top —
    // scaffold is neutral grey app-wide, so the desk paints its own
    // ground rather than borrowing the scaffold's.
    return Container(
      color: AppColors.deskCream,
      child: DecoratedBox(
        decoration: BoxDecoration(
          gradient: RadialGradient(
            center: const Alignment(0, -0.15),
            radius: 0.95,
            colors: [
              AppColors.brand.withValues(alpha: 0.32),
              AppColors.brand.withValues(alpha: 0.15),
              AppColors.deskCream.withValues(alpha: 0),
            ],
            stops: const [0.0, 0.38, 1.0],
          ),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Light zone — greeting, KPI grid, InsightWell
// ─────────────────────────────────────────────────────────────────────────────

class _LightZone extends StatelessWidget {
  final _DeskData data;
  const _LightZone({required this.data});
  @override
  Widget build(BuildContext context) {
    // Extra breathing room at the bottom pushes the Dex insight card up
    // off the sheet's rim — it was sitting flush with the dark band, so
    // the compositions felt cramped. `xl` bottom + `lg` KPI-to-insight
    // gives the block real air.
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.sm, AppSpacing.lg, AppSpacing.xxxl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _GreetingRow(summary: data.summary, ops: data.ops),
          const SizedBox(height: AppSpacing.lg),
          _KpiGrid(data: data),
          const SizedBox(height: AppSpacing.lg),
          _InsightWell(data: data),
        ],
      ),
    );
  }
}

class _GreetingRow extends StatelessWidget {
  final DeskSummary? summary;
  final OperatingScore? ops;
  const _GreetingRow({required this.summary, required this.ops});

  @override
  Widget build(BuildContext context) {
    final greeting = summary?.greeting.isNotEmpty == true
        ? summary!.greeting
        : 'Good evening, ';
    // Split greeting on the last comma so the name gets a lighter ink.
    final gi = greeting.lastIndexOf(',');
    final left = gi == -1 ? greeting : greeting.substring(0, gi + 1);
    final right = gi == -1 ? '' : greeting.substring(gi + 1).trim();

    final score = ops?.overall;
    final scoreReady = score != null && ops?.enough != false;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: RichText(
            text: TextSpan(
              style: AppText.h1().copyWith(fontSize: 26, height: 1.2),
              children: [
                TextSpan(text: '$left\n'),
                TextSpan(
                  text: right.isEmpty ? '' : '$right.',
                  style: AppText.h1().copyWith(
                    fontSize: 26, height: 1.2,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.md),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(scoreReady ? '$score' : '—',
                style: AppText.display().copyWith(fontSize: 48, height: 1)),
            const SizedBox(width: 4),
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text('/100',
                  style: AppText.small().copyWith(color: AppColors.textSecondary)),
            ),
            const SizedBox(width: 8),
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: ScoreGauge(score: scoreReady ? score : null, size: 96),
            ),
          ],
        ),
      ],
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI grid — live values from summary + ledger
// ─────────────────────────────────────────────────────────────────────────────

class _KpiGrid extends StatelessWidget {
  final _DeskData data;
  const _KpiGrid({required this.data});

  String _rupeeCompact(double v) {
    if (v.abs() >= 10000000) return '₹${(v / 10000000).toStringAsFixed(1)}Cr';
    if (v.abs() >= 100000) return '₹${(v / 100000).toStringAsFixed(1)}L';
    if (v.abs() >= 1000) return '₹${(v / 1000).toStringAsFixed(1)}K';
    return '₹${v.toStringAsFixed(0)}';
  }

  @override
  Widget build(BuildContext context) {
    final s = data.summary;
    final l = data.ledger;
    final delayed = s?.delayed ?? 0;
    final complaints = s?.complaintsValue ?? 0;
    final overdueCash = s?.overdueCashAmount;
    final profit = l?.netProfit;

    final items = [
      _KpiSpec(
        label: 'Delayed', icon: Icons.access_time_rounded,
        value: delayed == 0 ? '—' : '$delayed',
        urgent: delayed > 0,
      ),
      _KpiSpec(
        label: 'Complaints', icon: Icons.chat_bubble_outline_rounded,
        value: complaints == 0 ? '—' : '$complaints',
        urgent: (s?.complaintsNew7d ?? 0) > 0,
      ),
      _KpiSpec(
        label: 'Overdue', icon: Icons.currency_exchange_rounded,
        value: overdueCash == null ? '…' : _rupeeCompact(overdueCash),
        urgent: (overdueCash ?? 0) > 0,
      ),
      _KpiSpec(
        label: 'Net profit', icon: Icons.trending_up_rounded,
        value: profit == null ? '…' : _rupeeCompact(profit),
        urgent: (profit ?? 0) < 0,
      ),
    ];

    return Column(
      children: [
        Row(children: [
          Expanded(child: _KpiTile(spec: items[0])),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: _KpiTile(spec: items[1])),
        ]),
        const SizedBox(height: AppSpacing.sm),
        Row(children: [
          Expanded(child: _KpiTile(spec: items[2])),
          const SizedBox(width: AppSpacing.sm),
          Expanded(child: _KpiTile(spec: items[3])),
        ]),
      ],
    );
  }
}

class _KpiSpec {
  final String label;
  final String value;
  final IconData icon;
  final bool urgent;
  const _KpiSpec({required this.label, required this.value, required this.icon, this.urgent = false});
}

class _KpiTile extends StatelessWidget {
  final _KpiSpec spec;
  const _KpiTile({required this.spec});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.hairline),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 8, offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(spec.label,
                style: AppText.small().copyWith(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textPrimary.withValues(alpha: 0.8)),
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          const SizedBox(width: 6),
          Icon(spec.icon, size: 13, color: AppColors.textSecondary),
          const SizedBox(width: 6),
          Text(spec.value,
              style: AppText.h3().copyWith(
                  fontSize: 16, height: 1,
                  fontWeight: FontWeight.w700,
                  color: spec.urgent ? AppColors.brand : AppColors.textPrimary,
                  fontFeatures: const [FontFeature.tabularFigures()])),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Insight well — Dex today's read (neumorphic pit)
// ─────────────────────────────────────────────────────────────────────────────

class _InsightWell extends StatelessWidget {
  final _DeskData data;
  const _InsightWell({required this.data});
  @override
  Widget build(BuildContext context) {
    final cash = data.summary?.overdueCashAmount;
    final headline = cash != null && cash > 0
        ? '₹${_kLakh(cash)} is sitting in invoices already past due.'
        : 'Nothing dragging today — keep it clean.';

    return Container(
      constraints: const BoxConstraints(minHeight: 172),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            offset: const Offset(2, 2), blurRadius: 6, spreadRadius: -1,
            blurStyle: BlurStyle.inner,
          ),
          BoxShadow(
            color: Colors.white.withValues(alpha: 0.85),
            offset: const Offset(-3, -3), blurRadius: 6,
            blurStyle: BlurStyle.inner,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('Dex · today’s read',
              style: AppText.smallStrong().copyWith(
                  fontSize: 12,
                  color: AppColors.textPrimary.withValues(alpha: 0.75))),
          const SizedBox(height: AppSpacing.sm),
          Text(headline, style: AppText.h3().copyWith(fontSize: 18, height: 1.3)),
          const SizedBox(height: 28),
          // "Chase it" routes to Money — the overdue cash number Dex is
          // reading lives on the Revenue tab; that's the follow-up screen.
          Row(children: [
            // Switch the AppShell to its Money tab rather than routing to
            // `/money` as a standalone screen — that route mounts a fresh
            // MoneyScreen outside AppShell (no Scaffold ancestor, no dock,
            // no shared state) and errors out. Toggling the tab notifier
            // reuses the instance the bottom nav already renders.
            _PopPill(label: 'Chase it', onTap: () => appShellTab.value = 2),
            const Spacer(),
            _PopCircle(onTap: () => context.go('/dex')),
          ]),
        ],
      ),
    );
  }

  static String _kLakh(double v) {
    if (v >= 10000000) return '${(v / 10000000).toStringAsFixed(1)}Cr';
    if (v >= 100000) return '${(v / 100000).toStringAsFixed(1)}L';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}K';
    return v.toStringAsFixed(0);
  }
}

class _PopPill extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;
  const _PopPill({required this.label, this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(AppRadius.pill),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.06), offset: const Offset(2, 2), blurRadius: 5),
              BoxShadow(color: Colors.white.withValues(alpha: 0.9), offset: const Offset(-2, -2), blurRadius: 5),
            ],
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text(label, style: AppText.smallStrong().copyWith(fontSize: 12)),
            const SizedBox(width: 6),
            const Icon(Icons.arrow_forward_rounded, size: 14),
          ]),
        ),
      ),
    );
  }
}

class _PopCircle extends StatelessWidget {
  final VoidCallback? onTap;
  const _PopCircle({this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        child: Container(
          width: 44, height: 44,
          decoration: BoxDecoration(
            color: AppColors.surface, shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(color: Colors.black.withValues(alpha: 0.06), offset: const Offset(2, 2), blurRadius: 5),
              BoxShadow(color: Colors.white.withValues(alpha: 0.9), offset: const Offset(-2, -2), blurRadius: 5),
            ],
          ),
          child: const Icon(Icons.psychology_alt_rounded, size: 19),
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dark band — DecisionBento
// ─────────────────────────────────────────────────────────────────────────────

class _DarkBand extends StatelessWidget {
  final _DeskData data;
  final ScrollController scrollController;
  final DraggableScrollableController sheetController;
  final double sheetMax;
  const _DarkBand({
    required this.data,
    required this.scrollController,
    required this.sheetController,
    required this.sheetMax,
  });

  // The sheet's ScrollController MUST attach to a scrollable inside so
  // DraggableScrollableSheet can compose the drag: drag up first expands the
  // sheet, then scrolls content once sheet is at max.

  @override
  Widget build(BuildContext context) {
    // ONE sheet. The body is a plain Column — no outer CustomScrollView,
    // because putting a horizontal PageView inside a SliverFillRemaining
    // triggers "RenderViewport does not support intrinsic dimensions" (the
    // PageView contains a Viewport which is inherently lazy). The sheet's
    // own drag detector still moves the sheet from anywhere on the body,
    // and the "+N more" pill animates the sheet controller to max.
    return ClipPath(
      clipper: _NotchedTopClipper(),
      child: Container(
        color: AppColors.surfaceDark,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: 32), // clear the notch's deepest point
            Center(
              child: Container(
                width: 40, height: 4,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 14),
            Expanded(
              child: _DecisionBento(
                data: data,
                scrollController: scrollController,
                sheetController: sheetController,
                sheetMax: sheetMax,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Draws the dark band's silhouette: two rounded top corners plus a wide
/// concave dip in the middle — the "small notch" the founder asked for. It's
/// the same shape the frontend used to have before KR-14.4 flattened it.
class _NotchedTopClipper extends CustomClipper<Path> {
  static const double _corner = 24.0;
  static const double _notchWidth = 96.0;
  static const double _notchDepth = 14.0;

  @override
  Path getClip(Size size) {
    final w = size.width;
    final h = size.height;
    final path = Path();
    // Start at bottom-left, walk up and around the top edge with the notch.
    path.moveTo(0, h);
    path.lineTo(0, _corner);
    path.quadraticBezierTo(0, 0, _corner, 0);
    // Straight edge to the notch's start.
    final notchStart = (w - _notchWidth) / 2;
    path.lineTo(notchStart, 0);
    // Concave dip — a downward cubic curve then back up. The two control
    // points sit above the base line so the curve reads as a smooth "U".
    path.cubicTo(
      notchStart + _notchWidth * 0.25, 0,
      notchStart + _notchWidth * 0.15, _notchDepth,
      notchStart + _notchWidth * 0.50, _notchDepth,
    );
    path.cubicTo(
      notchStart + _notchWidth * 0.85, _notchDepth,
      notchStart + _notchWidth * 0.75, 0,
      notchStart + _notchWidth, 0,
    );
    // Continue the top edge and round the top-right corner.
    path.lineTo(w - _corner, 0);
    path.quadraticBezierTo(w, 0, w, _corner);
    path.lineTo(w, h);
    path.close();
    return path;
  }

  @override
  bool shouldReclip(covariant CustomClipper<Path> oldClipper) => false;
}

/// Horizontal-snap PageView with 4 sections inside the ONE sheet. Each page
/// stacks the whole section (header + 3 top cards + optional 2-col grid).
/// When the sheet is minimized only the top of the section fits; drag or
/// tap "+N more" and the same sheet grows to reveal the rest.
class _DecisionBento extends StatefulWidget {
  final _DeskData data;
  final ScrollController scrollController;
  final DraggableScrollableController sheetController;
  final double sheetMax;
  const _DecisionBento({
    required this.data,
    required this.scrollController,
    required this.sheetController,
    required this.sheetMax,
  });
  @override
  State<_DecisionBento> createState() => _DecisionBentoState();
}

class _DecisionBentoState extends State<_DecisionBento> {
  int _page = 0;
  late final PageController _controller = PageController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  static const _sectionSpecs = <_SectionSpec>[
    _SectionSpec(
      key: 'needs_decision', label: 'Needs your decision',
      dot: AppColors.sectionNeedsDot,
      gradA: AppColors.bentoNeedsA, gradB: AppColors.bentoNeedsB,
      empty: 'No decisions waiting on you',
    ),
    _SectionSpec(
      key: 'on_fire', label: 'On fire',
      dot: AppColors.sectionFireDot,
      gradA: AppColors.bentoFireA, gradB: AppColors.bentoFireB,
      empty: 'Nothing on fire',
    ),
    _SectionSpec(
      key: 'due_today', label: 'Due today',
      dot: AppColors.sectionTodayDot,
      gradA: AppColors.bentoTodayA, gradB: AppColors.bentoTodayB,
      empty: 'Nothing due today',
    ),
    _SectionSpec(
      key: 'important', label: 'Important',
      dot: AppColors.sectionFlagDot,
      gradA: AppColors.bentoFlagA, gradB: AppColors.bentoFlagB,
      empty: 'Nothing flagged',
    ),
  ];

  Future<void> _expand() async {
    // Guard: the sheet may not have finished mounting yet (rare, but the
    // assert fires hard if we call animateTo before then).
    if (!widget.sheetController.isAttached) return;
    // Smooth easeOut animation from wherever the sheet is to fully open.
    await widget.sheetController.animateTo(
      widget.sheetMax,
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: PageView.builder(
            controller: _controller,
            physics: const ClampingScrollPhysics(),
            onPageChanged: (i) => setState(() => _page = i),
            itemCount: _sectionSpecs.length,
            itemBuilder: (context, i) {
              final spec = _sectionSpecs[i];
              final cards = widget.data.cards(spec.key);
              final count = widget.data.count(spec.key);
              return _SectionPanel(
                spec: spec,
                cards: cards,
                count: count,
                onExpand: _expand,
                // Attach the sheet's ScrollController to the CURRENTLY-visible
                // section only. This lets DraggableScrollableSheet compose
                // vertical drag: drag up first expands the sheet through its
                // snap points, then scrolls the section content once the
                // sheet reaches max. Sharing across pages would throw the
                // "already attached" assertion.
                scrollController: i == _page ? widget.scrollController : null,
              );
            },
          ),
        ),
        const SizedBox(height: 10),
        _PageDots(active: _page, total: _sectionSpecs.length),
        const SizedBox(height: 20),
      ],
    );
  }
}

class _PageDots extends StatelessWidget {
  final int active;
  final int total;
  const _PageDots({required this.active, required this.total});
  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(total, (i) {
        final on = i == active;
        return Container(
          width: on ? 20 : 6, height: 6,
          margin: const EdgeInsets.symmetric(horizontal: 3),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: on ? 0.9 : 0.28),
            borderRadius: BorderRadius.circular(3),
          ),
        );
      }),
    );
  }
}

class _SectionSpec {
  final String key;
  final String label;
  final Color dot;
  final Color gradA;
  final Color gradB;
  final String empty;
  const _SectionSpec({
    required this.key,
    required this.label,
    required this.dot,
    required this.gradA,
    required this.gradB,
    required this.empty,
  });
}

class _SectionPanel extends StatelessWidget {
  final _SectionSpec spec;
  final List<Decision> cards;
  final int count;
  final VoidCallback onExpand;
  final ScrollController? scrollController;
  const _SectionPanel({
    required this.spec,
    required this.cards,
    required this.count,
    required this.onExpand,
    this.scrollController,
  });

  static const _shown = 3;

  @override
  Widget build(BuildContext context) {
    final top = cards.take(_shown).toList();
    final rest = cards.length > _shown ? cards.skip(_shown).toList() : const <Decision>[];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section header — dot + label + count pill + optional "+N more".
          // The pill animates THIS sheet to max; no new modal.
          Row(
            children: [
              Container(
                width: 10, height: 10,
                decoration: BoxDecoration(color: spec.dot, shape: BoxShape.circle),
              ),
              const SizedBox(width: 10),
              Text(spec.label,
                  style: AppText.bodyStrong().copyWith(color: AppColors.textOnDark)),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppRadius.pill),
                ),
                child: Text('$count',
                    style: AppText.small().copyWith(
                        color: AppColors.textOnDark,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        fontFeatures: const [FontFeature.tabularFigures()])),
              ),
              const Spacer(),
              if (rest.isNotEmpty)
                _MorePill(count: rest.length, onTap: onExpand),
            ],
          ),
          const SizedBox(height: 12),
          // Card stack — all cards in one vertical scroll:
          //   • first 3 as 1-per-row full-width bento boxes (headline first)
          //   • rest as a 2-per-row grid, seamlessly continuing the list
          // Wrapped in a SingleChildScrollView so a many-card section (28+
          // cards from the backend) doesn't overflow the panel's bounded
          // height. Different scroll axis from PageView (vertical vs
          // horizontal) so the two compose cleanly.
          Expanded(
            child: top.isEmpty
                ? _EmptyPanel(text: spec.empty)
                : SingleChildScrollView(
                    // Attach the sheet's ScrollController when this is the
                    // active page so vertical drag composes: expand sheet
                    // first, then scroll content once fully expanded.
                    controller: scrollController,
                    physics: const ClampingScrollPhysics(),
                    padding: const EdgeInsets.only(bottom: 20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        for (int i = 0; i < top.length; i++) ...[
                          _BentoBox(card: top[i], spec: spec, headline: i == 0),
                          if (i != top.length - 1) const SizedBox(height: 10),
                        ],
                        if (rest.isNotEmpty) ...[
                          const SizedBox(height: 10),
                          GridView.builder(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            itemCount: rest.length,
                            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 2,
                              mainAxisSpacing: 10,
                              crossAxisSpacing: 10,
                              childAspectRatio: 0.82,
                            ),
                            itemBuilder: (context, i) => _BentoBox(
                              card: rest[i], spec: spec, headline: false, compact: true,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
          ),
        ],
      ),
    );
  }
}

class _MorePill extends StatelessWidget {
  final int count;
  final VoidCallback onTap;
  const _MorePill({required this.count, required this.onTap});
  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppRadius.pill),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Text('+$count more',
                style: AppText.smallStrong().copyWith(
                    color: AppColors.textOnDark, fontSize: 12)),
            const SizedBox(width: 4),
            const Icon(Icons.expand_more_rounded, size: 14, color: AppColors.textOnDark),
          ]),
        ),
      ),
    );
  }
}

class _EmptyPanel extends StatelessWidget {
  final String text;
  const _EmptyPanel({required this.text});
  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.04),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      alignment: Alignment.center,
      child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        Icon(Icons.check_circle_outline_rounded,
            size: 18, color: Colors.white.withValues(alpha: 0.55)),
        const SizedBox(width: 8),
        Text(text, style: AppText.small().copyWith(
            color: AppColors.textOnDark.withValues(alpha: 0.65))),
      ]),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bento card
// ─────────────────────────────────────────────────────────────────────────────

class _BentoBox extends StatelessWidget {
  final Decision card;
  final _SectionSpec spec;
  final bool headline;
  final bool compact;
  const _BentoBox({
    required this.card,
    required this.spec,
    this.headline = false,
    this.compact = false,
  });

  static const _ctaLabels = {
    'review': 'Review',
    'chase': 'Chase',
    'respond': 'Respond',
    'nudge': 'Nudge',
  };
  static const _ctaIcons = {
    'review': Icons.balance_rounded,
    'chase': Icons.local_fire_department_rounded,
    'respond': Icons.chat_bubble_outline_rounded,
    'nudge': Icons.wb_sunny_outlined,
  };

  @override
  Widget build(BuildContext context) {
    final verb = _ctaLabels[card.cta] ?? 'Open';
    final icon = _ctaIcons[card.cta] ?? Icons.balance_rounded;
    // Whole card is tappable — pushes the decision detail route with the
    // model as `extra` (same shape /decision/:id already expects from Work).
    // Was unwired: user could see 33 decisions on the desk but couldn't
    // open one without hunting through Work.
    return InkWell(
      onTap: () => context.push('/decision/${card.id}', extra: card),
      borderRadius: BorderRadius.circular(AppRadius.lg),
      child: Container(
      padding: EdgeInsets.all(compact ? 12 : AppSpacing.lg),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft, end: Alignment.bottomRight,
          colors: [spec.gradA, spec.gradB],
        ),
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Container(
              width: compact ? 28 : 34, height: compact ? 28 : 34,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
              ),
              alignment: Alignment.center,
              child: Icon(icon, size: compact ? 13 : 15, color: AppColors.textOnDark),
            ),
            const Spacer(),
            if (card.amountFormatted != null)
              Flexible(
                child: Text(
                  card.amountFormatted!,
                  style: AppText.small().copyWith(
                    color: AppColors.textOnDark,
                    fontSize: headline ? 15 : 12,
                    fontWeight: FontWeight.w500,
                    fontFeatures: const [FontFeature.tabularFigures()],
                  ),
                  maxLines: 1, overflow: TextOverflow.ellipsis,
                ),
              ),
          ]),
          SizedBox(height: compact ? 10 : 16),
          Text(
            card.title,
            style: AppText.bodyStrong().copyWith(
              color: AppColors.textOnDark,
              fontSize: headline ? 19 : (compact ? 13 : 15),
              height: 1.25,
              fontWeight: FontWeight.w700,
            ),
            maxLines: compact ? 3 : (headline ? 3 : 2),
            overflow: TextOverflow.ellipsis,
          ),
          SizedBox(height: compact ? 8 : 12),
          if (!compact) ...[
            Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
              Expanded(
                child: Text(
                  card.contextLine,
                  style: AppText.small().copyWith(
                    color: AppColors.textOnDark.withValues(alpha: 0.7),
                    fontSize: 11, height: 1.3,
                  ),
                  maxLines: 2, overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
              _ActionPill(verb: verb),
            ]),
          ] else ...[
            Text(
              card.contextLine,
              style: AppText.small().copyWith(
                color: AppColors.textOnDark.withValues(alpha: 0.65),
                fontSize: 10, height: 1.3,
              ),
              maxLines: 2, overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 8),
            Align(alignment: Alignment.centerRight, child: _ActionPill(verb: verb, compact: true)),
          ],
        ],
      ),
      ),
    );
  }
}

class _ActionPill extends StatelessWidget {
  final String verb;
  final bool compact;
  const _ActionPill({required this.verb, this.compact = false});
  @override
  Widget build(BuildContext context) {
    return Container(
      height: compact ? 28 : 32,
      padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
      ),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Text(verb,
            style: AppText.smallStrong().copyWith(
                color: AppColors.textOnDark, fontSize: compact ? 11 : 12)),
        const SizedBox(width: 4),
        Icon(Icons.arrow_forward_ios_rounded,
            size: compact ? 9 : 10, color: AppColors.textOnDark),
      ]),
    );
  }
}
